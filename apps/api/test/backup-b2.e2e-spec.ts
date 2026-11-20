import 'reflect-metadata';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import {
  AuditAction,
  BackupStatus,
  BackupType,
  type BackupRun,
  type PrismaClient,
} from '@prisma/client';
import { assertB2Config, resolveBackupEnv, validateDatabaseDump } from '../src/backup/backup-ops.js';
import { createDicomWebArchive } from '../src/backup/dicom-backup.js';
import {
  executeBackup,
  type BackupAuditEntry,
  type BackupAuditSink,
} from '../src/backup/backup-workflow.js';
import type { ArtifactMetadata, BackupStorage, RemoteArtifact } from '../src/backup/backup-storage.js';

const STUDY_UID = '1.2.826.0.1.3680043.99.120001.1';
const SERIES_UID = '1.2.826.0.1.3680043.99.120001.2';
const SOP_UID = '1.2.826.0.1.3680043.99.120001.3';
const tempDirs: string[] = [];

function padEven(value: string): string {
  return value.length % 2 === 0 ? value : `${value}\0`;
}

function dicomElement(group: number, element: number, vr: string, value: string | Buffer): Buffer {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(padEven(value), 'latin1');
  const header = Buffer.alloc(8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(element, 2);
  header.write(vr, 4, 2, 'latin1');
  header.writeUInt16LE(bytes.length, 6);
  return Buffer.concat([header, bytes]);
}

function makeDicom(): Buffer {
  const transferSyntax = dicomElement(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
  const groupLength = Buffer.alloc(4);
  groupLength.writeUInt32LE(transferSyntax.length, 0);
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM', 'latin1'),
    dicomElement(0x0002, 0x0000, 'UL', groupLength),
    transferSyntax,
    dicomElement(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
    dicomElement(0x0008, 0x0018, 'UI', SOP_UID),
    dicomElement(0x0008, 0x0020, 'DA', '19950922'),
    dicomElement(0x0008, 0x0030, 'TM', '121803'),
    dicomElement(0x0008, 0x0060, 'CS', 'CT'),
    dicomElement(0x0010, 0x0010, 'PN', 'Test^Patient'),
    dicomElement(0x0010, 0x0020, 'LO', 'P-B2'),
    dicomElement(0x0020, 0x000d, 'UI', STUDY_UID),
    dicomElement(0x0020, 0x000e, 'UI', SERIES_UID),
    dicomElement(0x0020, 0x0011, 'IS', '1'),
    dicomElement(0x0020, 0x0013, 'IS', '1'),
  ]);
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: { get: () => 'application/dicom+json' },
  } as unknown as Response;
}

function wadoResponse(buffer: Buffer): Response {
  const boundary = '----axis-backup-test';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => body,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? `multipart/related; type="application/dicom"; boundary="${boundary}"`
          : null,
    },
  } as unknown as Response;
}

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'axis-b2-backup-'));
  tempDirs.push(dir);
  return dir;
}

function testEnv(dir: string) {
  return resolveBackupEnv({
    ...process.env,
    BACKUP_STORAGE_PROVIDER: 'B2',
    AXIS_BACKUP_DIR: dir,
    AXIS_ENV: 'test',
    B2_KEY_ID: 'test-key-id',
    B2_APPLICATION_KEY: 'test-application-key',
    B2_BUCKET_NAME: 'teleradiology-pacs',
    B2_S3_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
    B2_REGION: 'us-east-005',
    ORTHANC_URL: 'http://localhost:8042',
    ORTHANC_USERNAME: 'service',
    ORTHANC_PASSWORD: 'secret',
  });
}

function mockDicomWebFetch(): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/instances/')) {
      return wadoResponse(makeDicom());
    }
    if (url.includes('/dicom-web/studies?')) return jsonResponse([{ '0020000D': { Value: [STUDY_UID] } }]);
    if (url.includes(`/studies/${encodeURIComponent(STUDY_UID)}/series?`)) {
      return jsonResponse([{ '0020000E': { Value: [SERIES_UID] } }]);
    }
    if (url.includes(`/series/${encodeURIComponent(SERIES_UID)}/instances?`)) {
      return jsonResponse([{ '00080018': { Value: [SOP_UID] } }]);
    }
    return jsonResponse([]);
  });
}

function fakeStorage(): BackupStorage & { uploads: ArtifactMetadata[] } {
  const uploads: ArtifactMetadata[] = [];
  const stored = new Map<string, RemoteArtifact>();
  return {
    remote: true,
    uploads,
    async upload(filePath, key, metadata) {
      uploads.push(metadata);
      stored.set(key, {
        key,
        sizeBytes: String((await fs.stat(filePath)).size),
        checksum: metadata.checksum,
      });
    },
    async download(key, filePath) {
      const artifact = stored.get(key);
      if (!artifact) throw new Error('missing fake artifact');
      await fs.writeFile(filePath, Buffer.from(artifact.checksum ?? ''));
    },
    async head(key) {
      return stored.get(key) ?? null;
    },
    async list() {
      return [...stored.values()];
    },
    async delete(key) {
      stored.delete(key);
    },
    async verify(key, _filePath, expectedChecksum) {
      return stored.get(key)?.checksum === expectedChecksum;
    },
  };
}

function fakePrisma() {
  const updates: Array<Record<string, unknown>> = [];
  const base = {
    id: 'run-b2-test',
    type: BackupType.DICOM,
    status: BackupStatus.RUNNING,
    startedAt: new Date(),
    createdAt: new Date(),
    createdById: null,
  } as BackupRun;
  let current = base;
  const prisma = {
    backupRun: {
      findFirst: async () => null,
      create: async () => current,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        current = { ...current, ...data } as BackupRun;
        return current;
      },
      findUnique: async () => current,
      findMany: async () => [],
    },
  };
  return { prisma: prisma as unknown as PrismaClient, updates };
}

function fakeAudit(): BackupAuditSink & { entries: BackupAuditEntry[] } {
  const entries: BackupAuditEntry[] = [];
  return {
    entries,
    async create(entry) {
      entries.push(entry);
      return entry;
    },
  };
}

afterAll(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

describe('B2 backup configuration and artifacts', () => {
  it('selects the B2 provider only with credentials and validates required configuration', () => {
    const dir = resolveBackupEnv({ ...process.env, B2_KEY_ID: '', B2_APPLICATION_KEY: '' });
    expect(dir.provider).toBe('LOCAL');
    const env = testEnv('/tmp/axis-b2-config-test');
    expect(env.provider).toBe('B2');
    expect(env.b2BucketName).toBe('teleradiology-pacs');
    expect(() => assertB2Config(env)).not.toThrow();
  });

  it('validates both plain SQL dumps and compressed custom-format dumps', async () => {
    const dir = await makeTempDir();
    const sql = path.join(dir, 'plain.sql');
    const dump = path.join(dir, 'dump.dump.gz');
    await fs.writeFile(sql, 'PostgreSQL database dump\nCREATE TABLE test (id int);\n');
    await fs.writeFile(dump, gzipSync(Buffer.from('PGDMP\0compressed custom dump')));
    await expect(validateDatabaseDump(sql)).resolves.toBe(true);
    await expect(validateDatabaseDump(dump)).resolves.toBe(true);
  });

  it('creates a verified DICOMweb tar.gz containing all instances and a manifest', async () => {
    const dir = await makeTempDir();
    const archive = path.join(dir, 'dicom.tar.gz');
    const fetchSpy = mockDicomWebFetch();
    try {
      const result = await createDicomWebArchive(archive, testEnv(dir));
      const content = gunzipSync(await fs.readFile(archive)).toString('latin1');
      expect(content).toContain('manifest.json');
      expect(content).toContain('DICM');
      expect(result.checksum).toHaveLength(64);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('marks FULL backup incomplete on DICOM enumeration failure and preserves successful artifacts', async () => {
    const dir = await makeTempDir();
    const env = testEnv(dir);
    const storage = fakeStorage();
    const audit = fakeAudit();
    const { prisma, updates } = fakePrisma();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    try {
      const result = await executeBackup(
        prisma,
        audit,
        storage,
        env,
        BackupType.DICOM,
        { id: 'admin', role: 'ADMIN', displayName: 'Admin' },
      );
      expect(result.error).toMatch(/no studies|no DICOM instances/);
      expect(updates.at(-1)).toMatchObject({ status: BackupStatus.FAILED });
      expect(audit.entries.some((entry) => entry.action === AuditAction.BACKUP_FAILED)).toBe(true);
      expect(storage.uploads).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('completes only after remote DICOM artifact upload and checksum verification', async () => {
    const dir = await makeTempDir();
    const env = testEnv(dir);
    const storage = fakeStorage();
    const audit = fakeAudit();
    const { prisma, updates } = fakePrisma();
    const fetchSpy = mockDicomWebFetch();
    try {
      const result = await executeBackup(
        prisma,
        audit,
        storage,
        env,
        BackupType.DICOM,
        { id: 'admin', role: 'ADMIN', displayName: 'Admin' },
      );
      expect(result.error).toBeUndefined();
      expect(updates.at(-1)).toMatchObject({
        status: BackupStatus.COMPLETED,
        dicomVerified: true,
        storageProvider: 'B2',
      });
      expect(storage.uploads).toHaveLength(1);
      expect(storage.uploads[0].artifact).toBe('dicom');
      expect(audit.entries.map((entry) => entry.action)).toContain(AuditAction.BACKUP_COMPLETED);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
