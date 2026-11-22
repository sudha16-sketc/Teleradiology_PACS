import { createHash } from 'crypto';
import { promises as fs, createReadStream, createWriteStream } from 'fs';
import { once } from 'events';
import { PassThrough, Readable, Writable } from 'stream';
import { createGunzip, createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import type { BackupEnv, ArtifactResult } from './backup-ops.js';
import { sha256File, verifyChecksum } from './backup-ops.js';
import { parseDicomBuffer, validateDicomIdentifiers } from '../dicom/dicom.parser.js';
import { compressDicomBuffer } from '../dicom/dicom-compression.js';

interface DicomManifest {
  version: number;
  generatedAt: string;
  source: 'dicomweb';
  studyCount: number;
  seriesCount: number;
  instanceCount: number;
  studies: Array<{
    studyInstanceUid: string;
    series: Array<{
      seriesInstanceUid: string;
      instances: Array<{ sopInstanceUid: string; file: string; sha256: string }>;
    }>;
  }>;
}

const STUDY_UID_TAG = '0020000D';
const SERIES_UID_TAG = '0020000E';
const SOP_UID_TAG = '00080018';
const PAGE_SIZE = 200;

function normalizeUid(uid: string | null | undefined): string {
  return (uid ?? '').split('\u0000').join('').replace(/\s+/g, '');
}

function dicomJsonFirstValue(item: unknown, tag: string): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const element = (item as Record<string, unknown>)[tag] as { Value?: unknown[] } | undefined;
  const value = element?.Value?.[0];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function writeChunk(stream: Writable, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

function tarHeader(name: string, size: number): Buffer {
  if (Buffer.byteLength(name) > 100) {
    throw new Error(`Backup archive entry name is too long: ${name}`);
  }
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('000644\0', 100, 8, 'utf8');
  header.write('000000\0', 108, 8, 'utf8');
  header.write('000000\0', 116, 8, 'utf8');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return header;
}

class TarWriter {
  constructor(private readonly output: Writable) {}

  async write(name: string, data: Buffer): Promise<void> {
    await writeChunk(this.output, tarHeader(name, data.length));
    await writeChunk(this.output, data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) await writeChunk(this.output, Buffer.alloc(padding, 0));
  }

  async finalize(): Promise<void> {
    await writeChunk(this.output, Buffer.alloc(1024, 0));
  }
}

function safeArchivePath(root: string, name: string): string {
  if (path.isAbsolute(name) || name.split(/[\\/]+/).includes('..')) {
    throw new Error('DICOM backup archive contains an unsafe entry path');
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, name);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('DICOM backup archive contains an unsafe entry path');
  }
  return target;
}

async function tarByteReader(stream: Readable): Promise<(size: number) => Promise<Buffer | null>> {
  const iterator = stream[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  return async (size: number) => {
    while (pending.length < size) {
      const next = await iterator.next();
      if (next.done) {
        if (pending.length) throw new Error('Truncated DICOM backup archive');
        return null;
      }
      pending = Buffer.concat([pending, Buffer.from(next.value)]);
    }
    const chunk = pending.subarray(0, size);
    pending = pending.subarray(size);
    return chunk;
  };
}

async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const read = await tarByteReader(createReadStream(archivePath).pipe(createGunzip()));
  for (;;) {
    const header = await read(512);
    if (!header) break;
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8);
    if (!name || !Number.isFinite(size) || size < 0) {
      throw new Error('Invalid DICOM backup archive entry');
    }
    const target = safeArchivePath(targetDir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await pipeline(
      Readable.from(
        (async function* () {
          let remaining = size;
          while (remaining > 0) {
            const chunk = await read(Math.min(remaining, 64 * 1024));
            if (!chunk) throw new Error('Truncated DICOM backup archive');
            remaining -= chunk.length;
            yield chunk;
          }
        })(),
      ),
      createWriteStream(target),
    );
    const padding = (512 - (size % 512)) % 512;
    if (padding && !(await read(padding))) {
      throw new Error('Truncated DICOM backup archive');
    }
  }
}

function parseMultipartDicom(contentType: string, body: Buffer): Buffer {
  const boundaryMatch = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) throw new Error('WADO-RS response did not include a multipart boundary');
  const marker = Buffer.from(`--${boundary}`);
  const first = body.indexOf(marker);
  if (first < 0) throw new Error('WADO-RS response did not include a DICOM part');
  const next = body.indexOf(marker, first + marker.length);
  let part = body.subarray(first + marker.length, next < 0 ? body.length : next);
  while (part.length && (part[0] === 0x0d || part[0] === 0x0a)) part = part.subarray(1);
  while (part.length && (part[part.length - 1] === 0x0d || part[part.length - 1] === 0x0a)) {
    part = part.subarray(0, part.length - 1);
  }
  const separator = part.indexOf('\r\n\r\n');
  if (separator >= 0) part = part.subarray(separator + 4);
  if (!part.length) throw new Error('WADO-RS response contained an empty DICOM part');
  return part;
}

class OrthancBackupClient {
  private readonly baseUrl: string;
  private readonly authorization?: string;

  constructor(private readonly env: BackupEnv) {
    let parsed: URL;
    try {
      parsed = new URL(env.orthancUrl);
    } catch {
      throw new Error('ORTHANC_URL must be a valid URL for DICOM backups');
    }
    this.baseUrl = parsed.origin;
    if (!env.orthancUsername || !env.orthancPassword) {
      throw new Error(
        'ORTHANC_USERNAME and ORTHANC_PASSWORD are required for DICOMweb backups',
      );
    }
    this.authorization = `Basic ${Buffer.from(`${env.orthancUsername}:${env.orthancPassword}`).toString('base64')}`;
  }

  private timeoutMs(): number {
    const parsed = Number.parseInt(process.env.AXIS_ORTHANC_TIMEOUT_MS ?? '30000', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const headers: Record<string, string> = {
        ...(init.headers as Record<string, string> | undefined),
      };
      headers.Authorization = this.authorization as string;
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Orthanc request failed with status ${response.status}`);
      }
      return response;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error('Orthanc request timed out during backup operation');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async qido(path: string, filters: Record<string, string> = {}): Promise<unknown[]> {
    const query = new URLSearchParams({ ...filters, limit: String(PAGE_SIZE) });
    const response = await this.request(`${path}?${query.toString()}`, {
      headers: { Accept: 'application/dicom+json' },
    });
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) throw new Error('Orthanc QIDO-RS response was not an array');
    return body;
  }

  async wadoInstance(
    studyUid: string,
    seriesUid: string,
    sopUid: string,
  ): Promise<Buffer> {
    const path = `/dicom-web/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUid)}/instances/${encodeURIComponent(sopUid)}`;
    const response = await this.request(path, {
      headers: { Accept: 'multipart/related; type="application/dicom"' },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const buffer = parseMultipartDicom(response.headers.get('content-type') ?? '', bytes);
    const parsed = parseDicomBuffer(buffer);
    const error = validateDicomIdentifiers(parsed, { unknownSyntaxOk: true });
    if (error) throw new Error(`WADO-RS instance failed DICOM validation: ${error}`);
    if (
      normalizeUid(parsed.studyInstanceUid) !== normalizeUid(studyUid) ||
      normalizeUid(parsed.seriesInstanceUid) !== normalizeUid(seriesUid) ||
      normalizeUid(parsed.sopInstanceUid) !== normalizeUid(sopUid)
    ) {
      throw new Error('WADO-RS instance UIDs did not match the QIDO-RS hierarchy');
    }
    return buffer;
  }

  async storeInstance(buffer: Buffer): Promise<{
    orthancInstanceId: string;
    orthancSeriesId: string;
    orthancStudyId: string;
    orthancPatientId: string;
  }> {
    const compressed = await compressDicomBuffer(buffer);
    const response = await this.request('/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/dicom' },
      body: new Uint8Array(compressed) as unknown as BodyInit,
    });
    const body = (await response.json()) as {
      Status?: string;
      ID?: string;
      ParentStudy?: string;
      ParentSeries?: string;
      ParentPatient?: string;
    };
    if (
      !['Success', 'AlreadyStored'].includes(body.Status ?? '') ||
      !body.ID ||
      !body.ParentStudy ||
      !body.ParentSeries ||
      !body.ParentPatient
    ) {
      throw new Error('Orthanc rejected a restored DICOM instance');
    }
    return {
      orthancInstanceId: body.ID,
      orthancSeriesId: body.ParentSeries,
      orthancStudyId: body.ParentStudy,
      orthancPatientId: body.ParentPatient,
    };
  }

  async assertHierarchy(
    orthancStudyId: string,
    orthancSeriesId: string,
    orthancInstanceId: string,
    expectedStudyUid: string,
    expectedSeriesUid: string,
    expectedSopUid: string,
  ): Promise<void> {
    const [study, series, instance] = await Promise.all([
      this.request(`/studies/${encodeURIComponent(orthancStudyId)}`).then((r) => r.json()),
      this.request(`/series/${encodeURIComponent(orthancSeriesId)}`).then((r) => r.json()),
      this.request(`/instances/${encodeURIComponent(orthancInstanceId)}`).then((r) => r.json()),
    ]);
    const studyUid = dicomJsonFirstValue(study, STUDY_UID_TAG) ??
      (study as { MainDicomTags?: Record<string, string> }).MainDicomTags?.StudyInstanceUID;
    const seriesUid = dicomJsonFirstValue(series, SERIES_UID_TAG) ??
      (series as { MainDicomTags?: Record<string, string> }).MainDicomTags?.SeriesInstanceUID;
    const sopUid = dicomJsonFirstValue(instance, SOP_UID_TAG) ??
      (instance as { MainDicomTags?: Record<string, string> }).MainDicomTags?.SOPInstanceUID;
    if (
      normalizeUid(studyUid) !== normalizeUid(expectedStudyUid) ||
      normalizeUid(seriesUid) !== normalizeUid(expectedSeriesUid) ||
      normalizeUid(sopUid) !== normalizeUid(expectedSopUid)
    ) {
      throw new Error('Restored DICOM instance mapped to an unexpected hierarchy');
    }
  }
}

async function qidoAll(
  client: OrthancBackupClient,
  path: string,
  extract: (item: unknown) => string | undefined,
  filters: Record<string, string> = {},
): Promise<string[]> {
  const values = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await client.qido(path, { ...filters, offset: String(offset) });
    for (const item of page) {
      const value = extract(item);
      if (value) values.add(value);
    }
    if (page.length < PAGE_SIZE) break;
  }
  return [...values];
}

export async function createDicomWebArchive(
  outFile: string,
  env: BackupEnv,
  studyUid?: string,
): Promise<ArtifactResult> {
  const client = new OrthancBackupClient(env);
  const filters: Record<string, string> = studyUid ? { StudyInstanceUID: studyUid } : {};
  const studyUids = await qidoAll(
    client,
    '/dicom-web/studies',
    (item) => dicomJsonFirstValue(item, STUDY_UID_TAG),
    filters,
  );
  if (!studyUids.length) {
    throw new Error(
      'Orthanc DICOMweb returned no studies; refusing to create an empty DICOM backup',
    );
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const tmpFile = `${outFile}.${process.pid}.tmp`;
  const output = new PassThrough();
  const fileStream = createWriteStream(tmpFile);
  const archive = new TarWriter(output);
  const pipelineDone = pipeline(output, createGzip(), fileStream);
  const manifest: DicomManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'dicomweb',
    studyCount: studyUids.length,
    seriesCount: 0,
    instanceCount: 0,
    studies: [],
  };
  const seenSopUids = new Set<string>();

  try {
    for (const studyUid of studyUids) {
      const seriesUids = await qidoAll(
        client,
        `/dicom-web/studies/${encodeURIComponent(studyUid)}/series`,
        (item) => dicomJsonFirstValue(item, SERIES_UID_TAG),
      );
      const studyEntry: DicomManifest['studies'][number] = {
        studyInstanceUid: studyUid,
        series: [],
      };
      for (const seriesUid of seriesUids) {
        const sopUids = await qidoAll(
          client,
          `/dicom-web/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUid)}/instances`,
          (item) => dicomJsonFirstValue(item, SOP_UID_TAG),
        );
        const seriesEntry: DicomManifest['studies'][number]['series'][number] = {
          seriesInstanceUid: seriesUid,
          instances: [],
        };
        for (const sopUid of sopUids) {
          if (seenSopUids.has(sopUid)) continue;
          seenSopUids.add(sopUid);
          const buffer = await client.wadoInstance(studyUid, seriesUid, sopUid);
          const file = `instances/${String(manifest.instanceCount + 1).padStart(8, '0')}.dcm`;
          const checksum = createHash('sha256').update(buffer).digest('hex');
          await archive.write(file, buffer);
          seriesEntry.instances.push({ sopInstanceUid: sopUid, file, sha256: checksum });
          manifest.instanceCount += 1;
        }
        if (seriesEntry.instances.length) studyEntry.series.push(seriesEntry);
      }
      if (studyEntry.series.length) manifest.studies.push(studyEntry);
    }
    if (!manifest.instanceCount) {
      throw new Error(
        'Orthanc DICOMweb returned no DICOM instances; refusing to create an empty DICOM backup',
      );
    }
    manifest.seriesCount = manifest.studies.reduce((sum, study) => sum + study.series.length, 0);
    await archive.write('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    await archive.finalize();
    output.end();
    await pipelineDone;
  } catch (err) {
    output.destroy();
    fileStream.destroy();
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
    throw err;
  }

  await fs.rename(tmpFile, outFile);
  const stat = await fs.stat(outFile);
  return {
    filePath: outFile,
    sizeBytes: String(stat.size),
    checksum: await sha256File(outFile),
  };
}

export async function deleteOrthancStudy(
  orthancStudyId: string,
  env: BackupEnv,
): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(orthancStudyId)) {
    throw new Error('Orthanc study id failed validation before deletion');
  }
  const client = new OrthancBackupClient(env);
  await client.request(`/studies/${encodeURIComponent(orthancStudyId)}`, {
    method: 'DELETE',
  });
}

export interface DicomRestoreResult {
  studyCount: number;
  seriesCount: number;
  instanceCount: number;
}

export async function restoreDicomArchive(
  archivePath: string,
  expectedChecksum: string,
  env: BackupEnv,
  prisma: PrismaClient,
): Promise<DicomRestoreResult> {
  if (!(await verifyChecksum(archivePath, expectedChecksum))) {
    throw new Error('DICOM restore archive checksum mismatch');
  }
  const client = new OrthancBackupClient(env);
  const scratchDir = await fs.mkdtemp(path.join(env.backupDir, 'dicom-restore-'));
  try {
    await extractTarGz(archivePath, scratchDir);
    const manifestRaw = await fs.readFile(safeArchivePath(scratchDir, 'manifest.json'));
    const manifest = JSON.parse(manifestRaw.toString('utf8')) as DicomManifest;
    if (manifest.version !== 1 || manifest.source !== 'dicomweb') {
      throw new Error('Unsupported DICOM backup archive manifest');
    }

    let instanceCount = 0;
    let seriesCount = 0;
    const restoredStudies = new Set<string>();
    for (const study of manifest.studies) {
      const dbStudy = await prisma.study.findUnique({
        where: { studyInstanceUid: study.studyInstanceUid },
        select: { id: true },
      });
      if (!dbStudy) {
        throw new Error(
          `DICOM restore requires study ${study.studyInstanceUid} to exist in the PostgreSQL database`,
        );
      }
      for (const series of study.series) {
        const dbSeries = await prisma.series.findUnique({
          where: { seriesInstanceUid: series.seriesInstanceUid },
          select: { id: true },
        });
        if (!dbSeries) {
          throw new Error(
            `DICOM restore requires series ${series.seriesInstanceUid} to exist in the PostgreSQL database`,
          );
        }
        for (const item of series.instances) {
          const buffer = await fs.readFile(safeArchivePath(scratchDir, item.file));
          if (createHash('sha256').update(buffer).digest('hex') !== item.sha256) {
            throw new Error(`DICOM restore instance checksum mismatch for ${item.file}`);
          }
          const parsed = parseDicomBuffer(buffer);
          const validationError = validateDicomIdentifiers(parsed, { unknownSyntaxOk: true });
          if (validationError) {
            throw new Error(`Restored DICOM file failed validation: ${validationError}`);
          }
          if (
            normalizeUid(parsed.studyInstanceUid) !== normalizeUid(study.studyInstanceUid) ||
            normalizeUid(parsed.seriesInstanceUid) !== normalizeUid(series.seriesInstanceUid) ||
            normalizeUid(parsed.sopInstanceUid) !== normalizeUid(item.sopInstanceUid)
          ) {
            throw new Error('Restored DICOM file UIDs did not match the archive manifest');
          }
          const dbInstance = await prisma.instance.findUnique({
            where: { sopInstanceUid: item.sopInstanceUid },
            select: { id: true },
          });
          if (!dbInstance) {
            throw new Error(
              `DICOM restore requires instance ${item.sopInstanceUid} to exist in the PostgreSQL database`,
            );
          }
          const stored = await client.storeInstance(buffer);
          await client.assertHierarchy(
            stored.orthancStudyId,
            stored.orthancSeriesId,
            stored.orthancInstanceId,
            study.studyInstanceUid,
            series.seriesInstanceUid,
            item.sopInstanceUid,
          );
          await prisma.study.update({
            where: { id: dbStudy.id },
            data: {
              orthancStudyId: stored.orthancStudyId,
              orthancPatientId: stored.orthancPatientId,
            },
          });
          await prisma.series.update({
            where: { id: dbSeries.id },
            data: { orthancSeriesId: stored.orthancSeriesId },
          });
          await prisma.instance.update({
            where: { id: dbInstance.id },
            data: { orthancInstanceId: stored.orthancInstanceId },
          });
          instanceCount += 1;
        }
        seriesCount += 1;
      }
      restoredStudies.add(study.studyInstanceUid);
    }
    if (instanceCount !== manifest.instanceCount || seriesCount !== manifest.seriesCount) {
      throw new Error('DICOM restore did not recover every manifest entry');
    }
    return {
      studyCount: restoredStudies.size,
      seriesCount,
      instanceCount,
    };
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
}
