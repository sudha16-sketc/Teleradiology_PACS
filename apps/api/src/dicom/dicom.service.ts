import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { readFile } from 'fs/promises';
import AdmZip from 'adm-zip';
import type { Modality, StudyPriority, Subspecialty, UserRole } from '@prisma/client';
import { extractDicomArchive, type ExtractedArchive } from './zip-archive.js';
import { parseDicomBuffer, validateDicomIdentifiers, type ParsedDicom } from './dicom.parser.js';

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

@Injectable()
export class DicomService {
  private readonly logger = new Logger(DicomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private orthancBase(): string {
    return (process.env.ORTHANC_URL ?? 'http://localhost:8042').replace(/\/+$/, '');
  }

  private orthancAuthHeader(): string | undefined {
    const username = process.env.ORTHANC_USERNAME;
    const password = process.env.ORTHANC_PASSWORD;
    if (!username || !password) return undefined;
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  private async orthancFetch(path: string, options: RequestInit = {}) {
    const url = `${this.orthancBase()}${path}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
    };
    const auth = this.orthancAuthHeader();
    if (auth) headers.Authorization = auth;

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Orthanc returned ${res.status} for ${path}`);
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
        `Orthanc rejected DICOM instance (${body?.Message ?? 'unknown error'})`,
      );
    }
    if (!body.ParentStudy || !body.ParentSeries || !body.ID) {
      throw new ServiceUnavailableException('Orthanc did not return exact study/series/instance identifiers');
    }
    return {
      parsed,
      orthancInstanceId: body.ID,
      orthancSeriesId: body.ParentSeries,
      orthancStudyId: body.ParentStudy,
      orthancPatientId: body.ParentPatient,
    };
  }

  private async auditEntry(
    user: IngestUser,
    action: 'STUDY_UPLOADED' | 'DICOM_IMPORTED' | 'DICOM_IMPORT_FAILED',
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

    // Normalise the upload into a single ZIP buffer so the hardened extraction
    // pipeline is always used:
    //   - a single already-zipped archive is passed through untouched;
    //   - one or more raw DICOM instances (folder/multi-file drag, or a single
    //     .dcm) are bundled into an in-memory ZIP first.
    let uploadBuffer: Buffer;
    if (files.length === 1 && isZip(files[0].buffer)) {
      uploadBuffer = files[0].buffer;
    } else {
      const zip = new AdmZip();
      files.forEach((f, i) => {
        const base = (f.originalname || `instance`).split(/[\\/]/).pop() || `instance`;
        const ext = /\.(dcm|dicom)$/i.test(base) ? '' : '.dcm';
        const safeName = `${i + 1}_${base.replace(/\.[^.]*$/, '') || 'dicom'}${ext}`;
        zip.addFile(safeName, f.buffer);
      });
      uploadBuffer = zip.toBuffer();
    }
    const fileBuffer = uploadBuffer;

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
        study = await this.prisma.study.update({
          where: { id: existingStudy.id },
          data: {
            ...baseStudyData,
            patientId: baseStudyData.patientId,
            status: 'RECEIVING',
          },
          include: { patient: true, hospital: true },
        });
      } else {
        study = await this.prisma.study.create({
          data: {
            ...baseStudyData,
            studyInstanceUid: studyUid,
            status: 'RECEIVING',
            deliveredAt: null,
          },
          include: { patient: true, hospital: true },
        });
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
}
