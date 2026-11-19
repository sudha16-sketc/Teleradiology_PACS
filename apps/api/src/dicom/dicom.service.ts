import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { orthancBaseUrl } from '../common/config/orthanc-url.js';
import { readFile } from 'fs/promises';
import AdmZip from 'adm-zip';
import { Prisma } from '@prisma/client';
import type { Modality, StudyPriority, Subspecialty, UserRole } from '@prisma/client';
import { extractDicomArchive, type ExtractedArchive } from './zip-archive.js';
import { parseDicomBuffer, validateDicomIdentifiers, type ParsedDicom } from './dicom.parser.js';
import { isValidDicomUid } from './dicom.constants.js';
import { DicomWebService } from '../dicomweb/dicomweb.service.js';
import type { ImagingAvailabilityResult } from '@axis/types';

export interface IngestUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  hospitalId?: string | null;
}

export interface IngestResult {
  study: any;
  orthancStudyId: string;
  orthancPatientId?: string;
  instanceCount: number;
  skipped: number;
}

interface OrthancStored {
  parsed: ParsedDicom;
  orthancInstanceId: string;
  orthancSeriesId: string;
  orthancStudyId: string;
  orthancPatientId: string;
}

const MODALITY_MAP: Record<string, Modality> = {
  CT: 'CT',
  MR: 'MRI',
  MRI: 'MRI',
  XR: 'XR',
  US: 'US',
  NM: 'NM',
  PT: 'PET',
  PET: 'PET',
  MG: 'MG',
  DX: 'DX',
  CR: 'CR',
  RF: 'Fluoro',
  ES: 'US',
  OT: 'CT',
};

function isZip(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function normalizeUid(uid: string | null | undefined): string {
  return (uid ?? '').replace(/[\u0000\s]+/g, '');
}

@Injectable()
export class DicomService {
  private readonly logger = new Logger(DicomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dicomweb: DicomWebService,
  ) {}

  private orthancBase(): string {
    return orthancBaseUrl();
  }

  private orthancAuthHeader(): string | undefined {
    const username = process.env.ORTHANC_USERNAME;
    const password = process.env.ORTHANC_PASSWORD;
    if (!username || !password) return undefined;
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  private orthancTimeoutMs(): number {
    const raw = process.env.AXIS_ORTHANC_TIMEOUT_MS;
    if (!raw) return 30000;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
  }

  private async orthancFetch(path: string, options: RequestInit = {}) {
    const url = `${this.orthancBase()}${path}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
    };
    const auth = this.orthancAuthHeader();
    if (auth) headers.Authorization = auth;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.orthancTimeoutMs());
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, { ...options, headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      // Never leak internal Orthanc URL/endpoint details (C27) or hang a
      // worker forever while Orthanc is unhealthy (C15).
      const timedOut = (err as Error)?.name === 'AbortError';
      throw new ServiceUnavailableException(
        timedOut
          ? 'The imaging backend timed out'
          : 'The imaging backend is temporarily unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new ServiceUnavailableException(
        'The imaging backend could not fulfil the request',
      );
    }
    return res;
  }

  private parseDate(s?: string): Date | undefined {
    if (!s) return undefined;
    const cleaned = s.replace(/[^0-9]/g, '').slice(0, 8);
    if (cleaned.length < 8) return undefined;
    const year = parseInt(cleaned.slice(0, 4), 10);
    const month = parseInt(cleaned.slice(4, 6), 10);
    const day = parseInt(cleaned.slice(6, 8), 10);
    if (!year || !month || !day) return undefined;
    return new Date(Date.UTC(year, month - 1, day));
  }

  private parseTime(s?: string): string {
    if (!s) return '';
    return s.replace(/[^0-9:.]/g, '').slice(0, 8);
  }

  private mapModality(raw?: string): Modality {
    const key = (raw || '').trim().toUpperCase();
    return MODALITY_MAP[key] ?? 'CT';
  }

  private computeSlaDeadline(priority: StudyPriority | undefined): Date | undefined {
    if (!priority) return undefined;
    const now = new Date();
    const hours = priority === 'STAT' ? 4 : priority === 'URGENT' ? 12 : 24;
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
  }

  private genderFromParsed(p?: ParsedDicom): 'M' | 'F' | 'O' | 'U' | undefined {
    const s = (p?.patientSex || '').trim().toUpperCase();
    if (s === 'M' || s === 'F' || s === 'O') return s as 'M' | 'F' | 'O';
    return 'U';
  }

  /**
   * Stores a single DICOM instance in Orthanc via the REST C-STORE endpoint
   * and returns the exact Orthanc resource identifiers for the instance and
   * its ancestors. This eliminates the previous (fragile) "find new study"
   * heuristic completely.
   */
  private async storeRawInstance(buffer: Buffer, parsed: ParsedDicom): Promise<OrthancStored> {
    const res = await this.orthancFetch('/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/dicom' },
      body: new Uint8Array(buffer) as unknown as BodyInit,
    });
    const body = (await res.json()) as any;
    // Orthanc is idempotent by SOP Instance UID: an already-stored instance
    // returns Status "AlreadyStored" (with the exact identifiers) instead of
    // "Success". Both are successful outcomes we can rely on for the mapping.
    const accepted = body && (body.Status === 'Success' || body.Status === 'AlreadyStored');
    if (!accepted || !body.ID) {
      throw new ServiceUnavailableException(
        'The imaging backend rejected the DICOM instance',
      );
    }
    if (!body.ParentStudy || !body.ParentSeries || !body.ID) {
      throw new ServiceUnavailableException(
        'The imaging backend did not return study/series/instance identifiers',
      );
    }
    return {
      parsed,
      orthancInstanceId: body.ID,
      orthancSeriesId: body.ParentSeries,
      orthancStudyId: body.ParentStudy,
      orthancPatientId: body.ParentPatient,
    };
  }

  private async assertOrthancHierarchy(stored: OrthancStored, studyUid: string): Promise<void> {
    const expectedStudyUid = normalizeUid(studyUid);
    const expectedSeriesUid = normalizeUid(stored.parsed.seriesInstanceUid);
    const expectedInstanceUid = normalizeUid(stored.parsed.sopInstanceUid);

    const [studyRes, seriesRes, instanceRes] = await Promise.all([
      this.orthancFetch(`/studies/${encodeURIComponent(stored.orthancStudyId)}`),
      this.orthancFetch(`/series/${encodeURIComponent(stored.orthancSeriesId)}`),
      this.orthancFetch(`/instances/${encodeURIComponent(stored.orthancInstanceId)}`),
    ]);
    const [study, series, instance] = await Promise.all([
      studyRes.json() as Promise<any>,
      seriesRes.json() as Promise<any>,
      instanceRes.json() as Promise<any>,
    ]);

    if (normalizeUid(study?.MainDicomTags?.StudyInstanceUID) !== expectedStudyUid ||
        normalizeUid(series?.MainDicomTags?.SeriesInstanceUID) !== expectedSeriesUid ||
        normalizeUid(instance?.MainDicomTags?.SOPInstanceUID) !== expectedInstanceUid) {
      throw new ServiceUnavailableException(
        'DICOM instance did not map to the expected PACS study, series, and instance',
      );
    }
  }

  private async auditEntry(
    user: IngestUser,
    action: 'STUDY_UPLOADED' | 'DICOM_IMPORTED' | 'DICOM_IMPORT_FAILED' | 'DICOM_REINGEST',
    resourceId: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.audit.create({
      actorId: user.id,
      actorName: user.displayName,
      actorRole: user.role,
      action,
      resource: 'STUDY',
      resourceId,
      metadata,
    });
  }

  async ingestDicom(files: Express.Multer.File[], originalName: string, user: IngestUser): Promise<IngestResult> {
    const hospitalId = user?.hospitalId;
    if (!hospitalId) {
      throw new ForbiddenException('Your account is not linked to a hospital');
    }

    let archive: ExtractedArchive | null = null;
    let study: any = null;

    // Read the uploaded bytes from the disk-backed staging area (multer
    // diskStorage) rather than an in-memory buffer, so studies up to the 1 GiB
    // per-file limit can be ingested without holding the whole request in heap.
    // Files are read back one at a time; the controller removes the staging
    // directory in finally.
    const readUpload = async (f: Express.Multer.File): Promise<Buffer> =>
      f.path ? readFile(f.path) : Promise.resolve(f.buffer as Buffer);

    let fileBuffer: Buffer;
    if (files.length === 1) {
      // A single upload: if it is a ZIP it is passed to the hardened
      // extraction pipeline untouched; if it is a raw DICOM instance it is
      // validated and ingested directly (no in-memory re-zip round-trip).
      fileBuffer = await readUpload(files[0]);
    } else {
      // Multiple raw instances (folder/multi-file drag) are bundled into a
      // single ZIP so the hardened extraction/validation pipeline is reused.
      const zip = new AdmZip();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const base = (f.originalname || `instance`).split(/[\\/]/).pop() || `instance`;
        const ext = /\.(dcm|dicom)$/i.test(base) ? '' : '.dcm';
        const safeName = `${i + 1}_${base.replace(/\.[^.]*$/, '') || 'dicom'}${ext}`;
        zip.addFile(safeName, await readUpload(f));
      }
      fileBuffer = zip.toBuffer();
    }

    try {
      // 1. Collect the raw DICOM instances (single file or safely extracted ZIP).
      const rawBuffers: Buffer[] = [];
      if (isZip(fileBuffer)) {
        archive = await extractDicomArchive(fileBuffer);
        for (const f of archive.files) {
          rawBuffers.push(await readFile(f));
        }
      } else {
        rawBuffers.push(fileBuffer);
      }

      if (rawBuffers.length === 0) {
        throw new BadRequestException('No DICOM files found in the upload');
      }

      // 2. Parse and validate every instance.
      const parsedByBuffer = new Map<Buffer, ParsedDicom>();
      const parsedList: ParsedDicom[] = [];
      for (const buf of rawBuffers) {
        const parsed = parseDicomBuffer(buf);
        const err = validateDicomIdentifiers(parsed, { unknownSyntaxOk: true });
        if (err) {
          throw new BadRequestException(`Invalid or unsupported DICOM file: ${err}`);
        }
        parsedByBuffer.set(buf, parsed);
        parsedList.push(parsed);
      }

      // 3. Hierarchy consistency: a single upload must map to a single study.
      const studyUid = parsedList[0].studyInstanceUid as string;
      for (const p of parsedList) {
        if (p.studyInstanceUid !== studyUid) {
          throw new BadRequestException(
            'Archive contains instances from multiple studies; please upload one study at a time',
          );
        }
      }

      const first = parsedList[0];
      const modality = this.mapModality(first.modality);

      // 4. Resolve / create the Patient and Study rows (status RECEIVING).
      const patientIdStr = first.patientId || `AXS-${Date.now()}`;
      const patient = await this.prisma.patient.upsert({
        where: { patientId: `${hospitalId}:${patientIdStr}` },
        update: {
          displayName: first.patientName || 'Unknown Patient',
          gender: this.genderFromParsed(first),
        },
        create: {
          hospitalId,
          patientId: `${hospitalId}:${patientIdStr}`,
          displayName: first.patientName || 'Unknown Patient',
          gender: this.genderFromParsed(first),
        },
      });

      const studyDate = this.parseDate(first.studyDate) ?? new Date();
      const accessionNumber = first.accessionNumber
        ? first.accessionNumber
        : `AX-${studyDate.toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now()}`;

      const existingStudy = await this.prisma.study.findUnique({
        where: { studyInstanceUid: studyUid },
      });

      const seriesSet = new Set(parsedList.map((p) => p.seriesInstanceUid));
      const baseStudyData = {
        orthancPatientId: null as string | null,
        orthancStudyId: null as string | null,
        patientId: existingStudy?.patientId ?? patient.id,
        accessionNumber: existingStudy?.accessionNumber ?? accessionNumber,
        studyDate,
        studyTime: this.parseTime(first.studyTime),
        modality,
        bodyPart: first.bodyPart || '',
        hospitalId,
        studyDescription: first.studyDescription || '',
        priority: 'ROUTINE' as StudyPriority,
        subspecialty: 'GENERAL' as Subspecialty,
        receivedAt: new Date(),
        seriesCount: seriesSet.size,
        instanceCount: parsedList.length,
        uploadedFileName: originalName,
        slaDeadline: this.computeSlaDeadline('ROUTINE' as StudyPriority),
      };

      if (existingStudy) {
        // A5: a StudyInstanceUID is unique system-wide. Only the owning hospital
        // may append to / re-ingest it; a different hospital forging the same UID
        // must never silently take the study over.
        if (existingStudy.hospitalId !== hospitalId) {
          throw new ForbiddenException(
            'A study with this StudyInstanceUID already belongs to another hospital and cannot be modified',
          );
        }
        study = await this.prisma.study.update({
          where: { id: existingStudy.id },
          data: {
            ...baseStudyData,
            hospitalId: existingStudy.hospitalId,
            status: 'RECEIVING',
          },
          include: { patient: true, hospital: true },
        });
      } else {
        try {
          study = await this.prisma.study.create({
            data: {
              ...baseStudyData,
              studyInstanceUid: studyUid,
              status: 'RECEIVING',
              deliveredAt: null,
            },
            include: { patient: true, hospital: true },
          });
        } catch (err) {
          // Concurrent first-time uploads of the same UID race the unique
          // constraint (P2002). Resolve in favor of the existing row instead of
          // surfacing a 500, still enforcing hospital ownership.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            const raced = await this.prisma.study.findUnique({
              where: { studyInstanceUid: studyUid },
            });
            if (!raced) throw err;
            if (raced.hospitalId !== hospitalId) {
              throw new ForbiddenException(
                'A study with this StudyInstanceUID already belongs to another hospital and cannot be modified',
              );
            }
            study = await this.prisma.study.update({
              where: { id: raced.id },
              data: {
                ...baseStudyData,
                hospitalId: raced.hospitalId,
                status: 'RECEIVING',
              },
              include: { patient: true, hospital: true },
            });
          } else {
            throw err;
          }
        }
      }

      // 5. Audit: study uploaded (validated, before DICOM import).
      await this.auditEntry(user, 'STUDY_UPLOADED', study.id, {
        instanceCount: parsedList.length,
        seriesCount: seriesSet.size,
        modality,
      });

      // 6. Send each instance to Orthanc, capturing exact identifiers.
      const stored: OrthancStored[] = [];
      for (const buf of rawBuffers) {
        const parsed = parsedByBuffer.get(buf) as ParsedDicom;
        const r = await this.storeRawInstance(buf, parsed);
        stored.push(r);
      }

      if (stored.length !== parsedList.length) {
        throw new ServiceUnavailableException('Not all DICOM instances were stored in the PACS');
      }

      const orthancStudyId = stored[0].orthancStudyId;
      const orthancPatientId = stored[0].orthancPatientId;
      if (stored.some((s) => s.orthancStudyId !== orthancStudyId)) {
        throw new ServiceUnavailableException('DICOM instances did not map to a single PACS study');
      }
      await this.assertOrthancHierarchy(stored[0], studyUid);

      // 7. Persist the complete Patient > Study > Series > Instance hierarchy,
      //    mapping real PACS identifiers back to PostgreSQL rows.
      const seriesGroups = new Map<string, OrthancStored[]>();
      for (const s of stored) {
        const key = s.parsed.seriesInstanceUid as string;
        if (!seriesGroups.has(key)) seriesGroups.set(key, []);
        seriesGroups.get(key)!.push(s);
      }

      for (const [seriesUid, group] of seriesGroups) {
        const firstInSeries = group[0].parsed;
        const series = await this.prisma.series.upsert({
          where: { seriesInstanceUid: seriesUid },
          update: {
            orthancSeriesId: group[0].orthancSeriesId,
            modality: this.mapModality(firstInSeries.modality),
            seriesNumber: firstInSeries.seriesNumber ?? 1,
            seriesDescription: firstInSeries.seriesDescription || '',
            instanceCount: group.length,
            bodyPart: firstInSeries.bodyPart || '',
          },
          create: {
            seriesInstanceUid: seriesUid,
            orthancSeriesId: group[0].orthancSeriesId,
            studyId: study.id,
            modality: this.mapModality(firstInSeries.modality),
            seriesNumber: firstInSeries.seriesNumber ?? 1,
            seriesDescription: firstInSeries.seriesDescription || '',
            instanceCount: group.length,
            bodyPart: firstInSeries.bodyPart || '',
          },
        });

        for (const inst of group) {
          const sopUid = inst.parsed.sopInstanceUid as string;
          await this.prisma.instance.upsert({
            where: { sopInstanceUid: sopUid },
            update: {
              orthancInstanceId: inst.orthancInstanceId,
              seriesId: series.id,
              studyId: study.id,
              instanceNumber: inst.parsed.instanceNumber ?? 1,
              sopClassUid: inst.parsed.sopClassUid || '',
            },
            create: {
              sopInstanceUid: sopUid,
              orthancInstanceId: inst.orthancInstanceId,
              seriesId: series.id,
              studyId: study.id,
              instanceNumber: inst.parsed.instanceNumber ?? 1,
              sopClassUid: inst.parsed.sopClassUid || '',
            },
          });
        }
      }

      const availability = await this.dicomweb.verifyStudyAvailability(
        user,
        studyUid,
        { persist: true, audit: false },
      );
      if (availability.state !== 'AVAILABLE') {
        throw availability.state === 'UNAVAILABLE'
          ? new ServiceUnavailableException(
              'The imaging backend could not verify the imported DICOM study',
            )
          : new BadRequestException(
              `Imported DICOM study verification returned ${availability.state}: ${availability.reason}`,
            );
      }

      // 8. Finalize the study as an UNASSIGNED case for the manager worklist.
      study = await this.prisma.study.update({
        where: { id: study.id },
        data: {
          orthancStudyId,
          orthancPatientId,
          seriesCount: seriesGroups.size,
          instanceCount: stored.length,
          status: 'UNASSIGNED',
          completedAt: null,
        },
        include: { patient: true, hospital: true },
      });

      await this.prisma.worklistItem.upsert({
        where: { studyId: study.id },
        update: { assignedAt: null },
        create: { studyId: study.id, assignedAt: null },
      });

      // 9. Audit: DICOM import succeeded.
      await this.auditEntry(user, 'DICOM_IMPORTED', study.id, {
        orthancStudyId,
        orthancPatientId,
        seriesCount: seriesGroups.size,
        instanceCount: stored.length,
        transferSyntax: first.transferSyntaxName,
        availability: availability.state,
      });

      return {
        study,
        orthancStudyId,
        orthancPatientId,
        instanceCount: stored.length,
        skipped: 0,
      };
    } catch (err) {
      // Emit a DICOM_IMPORT_FAILED audit if we already created a study record.
      if (study?.id) {
        await this.auditEntry(user, 'DICOM_IMPORT_FAILED', study.id, {
          reason: (err as Error).message,
        }).catch(() => undefined);
        await this.prisma.study
          .update({ where: { id: study.id }, data: { status: 'CANCELLED' } })
          .catch(() => undefined);
      }
      if (err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.error(`DICOM ingest failed: ${(err as Error).message}`);
      throw err;
    } finally {
      if (archive) {
        await archive.cleanup();
      }
    }
  }

  async reingestDicom(
    files: Express.Multer.File[],
    studyInstanceUid: string,
    user: IngestUser,
  ): Promise<{ study: unknown; availability: ImagingAvailabilityResult; storedCount: number }> {
    if (!isValidDicomUid(studyInstanceUid)) {
      throw new BadRequestException('Invalid StudyInstanceUID');
    }
    if (
      user.role !== 'ADMIN' &&
      user.role !== 'MANAGER' &&
      user.role !== 'HOSPITAL'
    ) {
      throw new ForbiddenException('You are not permitted to recover DICOM data');
    }

    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid },
      include: { series: true, instances: true },
    });
    if (!study) throw new NotFoundException('Study not found');
    if (user.role === 'HOSPITAL' && user.hospitalId !== study.hospitalId) {
      throw new ForbiddenException(
        'You do not have access to studies from this hospital',
      );
    }

    let archive: ExtractedArchive | null = null;
    const readUpload = async (file: Express.Multer.File): Promise<Buffer> =>
      file.path ? readFile(file.path) : Promise.resolve(file.buffer as Buffer);

    try {
      let fileBuffer: Buffer;
      if (files.length === 1) {
        fileBuffer = await readUpload(files[0]);
      } else {
        const zip = new AdmZip();
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const base = (file.originalname || 'instance').split(/[\\/]/).pop() || 'instance';
          const ext = /\.(dcm|dicom)$/i.test(base) ? '' : '.dcm';
          const safeName = `${i + 1}_${base.replace(/\.[^.]*$/, '') || 'dicom'}${ext}`;
          zip.addFile(safeName, await readUpload(file));
        }
        fileBuffer = zip.toBuffer();
      }

      const rawBuffers: Buffer[] = [];
      if (isZip(fileBuffer)) {
        archive = await extractDicomArchive(fileBuffer);
        for (const file of archive.files) rawBuffers.push(await readFile(file));
      } else {
        rawBuffers.push(fileBuffer);
      }
      if (rawBuffers.length === 0) {
        throw new BadRequestException('No DICOM files found in the upload');
      }

      const parsedByBuffer = new Map<Buffer, ParsedDicom>();
      const parsedList: ParsedDicom[] = [];
      for (const buffer of rawBuffers) {
        const parsed = parseDicomBuffer(buffer);
        const error = validateDicomIdentifiers(parsed, { unknownSyntaxOk: true });
        if (error) {
          throw new BadRequestException(`Invalid or unsupported DICOM file: ${error}`);
        }
        parsedByBuffer.set(buffer, parsed);
        parsedList.push(parsed);
      }

      for (const parsed of parsedList) {
        if (normalizeUid(parsed.studyInstanceUid) !== normalizeUid(studyInstanceUid)) {
          throw new BadRequestException(
            'An uploaded file belongs to a different StudyInstanceUID',
          );
        }
      }

      const seriesUids = [...new Set(parsedList.map((p) => normalizeUid(p.seriesInstanceUid)))];
      const sopUids = [...new Set(parsedList.map((p) => normalizeUid(p.sopInstanceUid)))];
      if (sopUids.length !== parsedList.length) {
        throw new BadRequestException('The upload contains duplicate SOP Instance UIDs');
      }

      const [dbSeries, dbInstances] = await Promise.all([
        this.prisma.series.findMany({
          where: { seriesInstanceUid: { in: seriesUids } },
          select: { id: true, studyId: true, seriesInstanceUid: true },
        }),
        this.prisma.instance.findMany({
          where: { sopInstanceUid: { in: sopUids } },
          select: { id: true, studyId: true, sopInstanceUid: true },
        }),
      ]);
      for (const row of dbSeries) {
        if (seriesUids.includes(normalizeUid(row.seriesInstanceUid)) &&
            row.studyId !== study.id) {
          throw new ForbiddenException(
            'An uploaded series belongs to a different study',
          );
        }
      }
      for (const row of dbInstances) {
        if (sopUids.includes(normalizeUid(row.sopInstanceUid)) &&
            row.studyId !== study.id) {
          throw new ForbiddenException(
            'An uploaded instance belongs to a different study',
          );
        }
      }

      const stored: OrthancStored[] = [];
      for (const buffer of rawBuffers) {
        const parsed = parsedByBuffer.get(buffer) as ParsedDicom;
        stored.push(await this.storeRawInstance(buffer, parsed));
      }
      const orthancStudyId = stored[0].orthancStudyId;
      const orthancPatientId = stored[0].orthancPatientId;
      if (stored.some((item) => item.orthancStudyId !== orthancStudyId)) {
        throw new ServiceUnavailableException(
          'The recovered instances did not map to a single Orthanc study',
        );
      }
      await this.assertOrthancHierarchy(stored[0], studyInstanceUid);

      const seriesByUid = new Map(
        study.series.map((row) => [normalizeUid(row.seriesInstanceUid), row]),
      );
      const instanceByUid = new Map(
        study.instances.map((row) => [normalizeUid(row.sopInstanceUid), row]),
      );
      const groups = new Map<string, OrthancStored[]>();
      for (const item of stored) {
        const uid = normalizeUid(item.parsed.seriesInstanceUid);
        if (!groups.has(uid)) groups.set(uid, []);
        groups.get(uid)!.push(item);
      }

      for (const [seriesUid, group] of groups) {
        const parsed = group[0].parsed;
        const data = {
          orthancSeriesId: group[0].orthancSeriesId,
          modality: this.mapModality(parsed.modality),
          seriesNumber: parsed.seriesNumber ?? 1,
          seriesDescription: parsed.seriesDescription || '',
          instanceCount: group.length,
          bodyPart: parsed.bodyPart || '',
        };
        const existingSeries = seriesByUid.get(seriesUid);
        const series = existingSeries
          ? await this.prisma.series.update({ where: { id: existingSeries.id }, data })
          : await this.prisma.series.create({
              data: { seriesInstanceUid: seriesUid, studyId: study.id, ...data },
            });
        seriesByUid.set(seriesUid, series);

        for (const item of group) {
          const sopUid = normalizeUid(item.parsed.sopInstanceUid);
          const instanceData = {
            orthancInstanceId: item.orthancInstanceId,
            seriesId: series.id,
            studyId: study.id,
            instanceNumber: item.parsed.instanceNumber ?? 1,
            sopClassUid: item.parsed.sopClassUid || '',
          };
          const existingInstance = instanceByUid.get(sopUid);
          const instance = existingInstance
            ? await this.prisma.instance.update({
                where: { id: existingInstance.id },
                data: instanceData,
              })
            : await this.prisma.instance.create({
                data: { sopInstanceUid: sopUid, ...instanceData },
              });
          instanceByUid.set(sopUid, instance);
        }
      }

      const [seriesCount, instanceCount] = await Promise.all([
        this.prisma.series.count({ where: { studyId: study.id } }),
        this.prisma.instance.count({ where: { studyId: study.id } }),
      ]);
      const updatedStudy = await this.prisma.study.update({
        where: { id: study.id },
        data: { orthancStudyId, orthancPatientId, seriesCount, instanceCount },
        include: { patient: true, hospital: true },
      });

      const availability = await this.dicomweb.verifyStudyAvailability(
        user,
        studyInstanceUid,
        { persist: true, audit: false },
      );
      if (availability.state !== 'AVAILABLE') {
        throw availability.state === 'UNAVAILABLE'
          ? new ServiceUnavailableException(
              'The imaging service was unavailable while verifying recovery',
            )
          : new BadRequestException(
              `Re-ingestion verification returned ${availability.state}: ${availability.reason}`,
            );
      }

      await this.auditEntry(user, 'DICOM_REINGEST', study.id, {
        storedCount: stored.length,
        seriesCount,
        instanceCount,
        availability: availability.state,
      });
      return { study: updatedStudy, availability, storedCount: stored.length };
    } catch (err) {
      await this.auditEntry(user, 'DICOM_REINGEST', study.id, {
        status: 'FAILED',
        reason: (err as Error).message,
      }).catch(() => undefined);
      if (err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.error(`DICOM re-ingest failed: ${(err as Error).message}`);
      throw err;
    } finally {
      if (archive) await archive.cleanup();
    }
  }
}
