import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { retentionPolicy } from '../src/retention/retention-config.js';
import type { RetentionStudy } from '../src/retention/retention-eligibility.service.js';
import { RetentionArchiveService } from '../src/retention/retention-archive.service.js';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';
import { FakeRemoteBackupStorage } from './retention-remote-storage.fake.js';

const BACKUP_DIR = '/tmp/opencode/axis-retention-remote-manifest';
const B2_PREFIX = 'retention-remote-test';
const DAY = 24 * 60 * 60 * 1000;

const ENV_KEYS = [
  'AXIS_BACKUP_DIR',
  'AXIS_ENV',
  'AXIS_RETENTION_DAYS',
  'AXIS_RETENTION_REQUIRE_BACKUP',
  'BACKUP_STORAGE_PROVIDER',
  'B2_KEY_ID',
  'B2_APPLICATION_KEY',
  'B2_PREFIX',
  'RETENTION_DICOM_ARCHIVE_ENABLED',
  'RETENTION_DRY_RUN',
  'RETENTION_DELETE_ENABLED',
  'RETENTION_BACKUP_DELETE_ENABLED',
  'RETENTION_POLICY_VERSION',
] as const;

const originalEnv: Record<string, string | undefined> = {};
const createdStudyIds: string[] = [];
const storage = new FakeRemoteBackupStorage();

let app: INestApplication;
let server: any;
let archiveService: RetentionArchiveService;
let adminAgent: any;
let hospitalAgent: any;

function uid(): string {
  return `1.2.826.0.1.3680043.8.498.retention-remote.${Date.now()}.${randomUUID()
    .replace(/-/g, '')
    .slice(0, 12)}`;
}

function buildStudyFixture(studyId: string, studyUid: string): RetentionStudy {
  const at = new Date('2024-01-01T00:00:00.000Z');
  const author = {
    id: 'rad-user',
    displayName: 'Test Radiologist',
    email: 'rad@test.local',
    role: 'RADIOLOGIST',
  };
  return {
    id: studyId,
    studyInstanceUid: studyUid,
    accessionNumber: 'ACC-REMOTE-MANIFEST',
    status: 'COMPLETED',
    completedAt: at,
    hospitalId: 'hospital-remote-test',
    hospital: { id: 'hospital-remote-test', name: 'Remote Test Hospital', isActive: true },
    patient: {
      id: 'patient-remote-test',
      hospitalId: 'hospital-remote-test',
      patientId: 'P-REMOTE-MANIFEST',
      displayName: 'Remote Manifest Patient',
      dateOfBirth: null,
      gender: null,
    },
    modality: 'CT',
    bodyPart: 'CHEST',
    studyDate: at,
    studyTime: '000000',
    reports: [
      {
        id: 'report-remote-test',
        status: 'SIGNED',
        signedOffAt: at,
        signedOffBy: author.id,
        version: 1,
        createdAt: at,
        updatedAt: at,
        contentHash: 'report-hash-remote-test',
        findings: 'Findings',
        impression: 'Impression',
        recommendations: 'Recommendations',
        clinicalHistory: 'History',
        comparison: 'Comparison',
        technique: 'Technique',
        contentHtml: '<p>Report content</p>',
        criticalFinding: false,
        criticalFindingAcknowledged: false,
        author,
        versions: [
          {
            id: 'report-version-remote-test',
            reportId: 'report-remote-test',
            version: 1,
            status: 'SIGNED',
            createdAt: at,
            authorId: author.id,
            author,
            contentHash: 'report-hash-remote-test',
            contentHtml: '<p>Report content</p>',
            findings: 'Findings',
            impression: 'Impression',
            recommendations: 'Recommendations',
            clinicalHistory: 'History',
            comparison: 'Comparison',
            technique: 'Technique',
          },
        ],
      },
    ],
    changeRequests: [],
    deliveryAttempts: [],
    worklistItem: null,
    retention: null,
    retentionArchives: [],
  } as unknown as RetentionStudy;
}

async function createStudy(agent: any): Promise<{ studyUid: string; studyId: string }> {
  const studyUid = uid();
  const res = await agent.post('/api/studies').send({
    patientName: 'Remote Manifest Patient',
    patientId: `P-RM-${randomUUID().slice(0, 8)}`,
    studyInstanceUid: studyUid,
    modality: 'CT',
    bodyPart: 'CHEST',
    studyDescription: 'Retention remote manifest test',
  });
  if (res.status !== 201) {
    throw new Error(`createStudy failed ${res.status}: ${res.text}`);
  }
  const studyId = res.body.data.id;
  createdStudyIds.push(studyId);
  return { studyUid, studyId };
}

async function makeEligible(studyId: string, orthancStudyId?: string): Promise<void> {
  await prisma.study.update({
    where: { id: studyId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 200 * DAY),
      imagingAvailability: 'AVAILABLE',
      ...(orthancStudyId ? { orthancStudyId } : {}),
    },
  });
}

beforeAll(async () => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

  process.env.AXIS_BACKUP_DIR = BACKUP_DIR;
  process.env.AXIS_ENV = 'test';
  process.env.AXIS_RETENTION_DAYS = '30';
  process.env.AXIS_RETENTION_REQUIRE_BACKUP = 'false';
  process.env.BACKUP_STORAGE_PROVIDER = 'B2';
  process.env.B2_KEY_ID = '';
  process.env.B2_APPLICATION_KEY = '';
  process.env.B2_PREFIX = B2_PREFIX;
  process.env.RETENTION_DICOM_ARCHIVE_ENABLED = 'false';
  process.env.RETENTION_DRY_RUN = 'true';
  process.env.RETENTION_DELETE_ENABLED = 'false';
  process.env.RETENTION_BACKUP_DELETE_ENABLED = 'false';
  process.env.RETENTION_POLICY_VERSION = 'remote-manifest-test';

  await fs.rm(BACKUP_DIR, { recursive: true, force: true });

  const built = await createTestApp({ backupStorage: storage });
  app = built.app;
  server = built.server;
  archiveService = new RetentionArchiveService(
    {} as PrismaService,
    storage,
    {} as any,
    {} as any,
  );
  adminAgent = await loginAgent(server, USERS.ADMIN);
  hospitalAgent = await loginAgent(server, USERS.H_CGH);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { resource: 'STUDY', resourceId: { in: createdStudyIds } },
  });
  await prisma.retentionAuditLog.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.notification.deleteMany({ where: { studyId: { in: createdStudyIds } } });
  await prisma.retentionJob.deleteMany({ where: { studyId: { in: createdStudyIds } } });
  await prisma.retentionArchive.deleteMany({ where: { studyId: { in: createdStudyIds } } });
  await prisma.studyRetention.deleteMany({ where: { studyId: { in: createdStudyIds } } });

  for (const studyId of createdStudyIds) {
    const reports = await prisma.report.findMany({ where: { studyId }, select: { id: true } });
    const reportIds = reports.map((report) => report.id);
    await prisma.reportVersion.deleteMany({ where: { reportId: { in: reportIds } } });
    await prisma.changeRequest.deleteMany({ where: { studyId } });
    await prisma.deliveryAttempt.deleteMany({ where: { studyId } });
    await prisma.worklistItem.deleteMany({ where: { studyId } });
    await prisma.assignment.deleteMany({ where: { studyId } });
    await prisma.report.deleteMany({ where: { studyId } });
    await prisma.study.delete({ where: { id: studyId } }).catch(() => undefined);
  }

  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  await fs.rm(BACKUP_DIR, { recursive: true, force: true });
  await prisma.$disconnect();
  await app.close();
});

describe('B2 retention manifest path handling', () => {
  it('writes, checksums, uploads, and verifies the manifest from a local scratch file', async () => {
    storage.reset();
    const studyId = `unit-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const studyUid = uid();
    const archiveId = `archive-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const study = buildStudyFixture(studyId, studyUid);
    const scratchDir = `${BACKUP_DIR}/retention-scratch/${studyId}/${archiveId}`;
    const localManifestPath = `${scratchDir}/archive-manifest.json`;
    const keyBase = `${B2_PREFIX}/retention/studies/${studyId}/${archiveId}`;
    const reportKey = `${keyBase}/report.json`;
    const studyKey = `${keyBase}/study.json`;
    const manifestKey = `${keyBase}/archive-manifest.json`;
    const expectedKeys = [reportKey, studyKey, manifestKey];

    const writeSpy = jest.spyOn(fs, 'writeFile');
    try {
      const result = await (archiveService as any).writeArchive(
        archiveId,
        study,
        null,
        new Date(),
        retentionPolicy(),
        null,
      );

      const writtenPaths = writeSpy.mock.calls.map((call) => String(call[0]));
      expect(writtenPaths).toContain(localManifestPath);
      expect(writtenPaths).not.toContain(manifestKey);
      expect(writtenPaths.some((filePath) => filePath.startsWith(`${B2_PREFIX}/`))).toBe(false);

      expect(storage.uploads.map((upload) => upload.key).sort()).toEqual([...expectedKeys].sort());
      for (const key of expectedKeys) {
        const upload = storage.uploadFor(key);
        expect(upload).toBeDefined();
        expect(upload!.filePath.startsWith(`${BACKUP_DIR}/`)).toBe(true);
        expect(upload!.filePath).not.toBe(key);
        expect(upload!.metadata.checksum).toBe(upload!.sha256);
        expect(storage.verifications).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key,
              filePath: upload!.filePath,
              expectedChecksum: upload!.sha256,
            }),
          ]),
        );
      }

      const manifestUpload = storage.uploadFor(manifestKey)!;
      expect(result.manifestObjectKey).toBe(manifestKey);
      expect(result.manifestChecksum).toBe(manifestUpload.sha256);
      expect(storage.uploadFor(reportKey)!.metadata.artifact).toBe('retention');
      expect(storage.uploadFor(studyKey)!.metadata.artifact).toBe('retention');

      const manifest = JSON.parse(storage.contentFor(manifestKey)!.toString('utf8'));
      expect(manifest.archiveId).toBe(archiveId);
      expect(manifest.artifacts.report.objectKey).toBe(reportKey);
      expect(manifest.artifacts.study.objectKey).toBe(studyKey);
      await expect(fs.stat(localManifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe('remote retention execution', () => {
  it('archives an eligible study and uploads all expected remote objects', async () => {
    storage.reset();
    const { studyId } = await createStudy(hospitalAgent);
    await makeEligible(studyId);

    const res = await adminAgent.post('/api/admin/retention/execute').expect(201);
    expect(res.body.data.archived).toBeGreaterThanOrEqual(1);

    const study = await prisma.study.findUniqueOrThrow({ where: { id: studyId } });
    expect(study.archivedAt).not.toBeNull();

    const audit = await adminAgent
      .get(`/api/audit?resource=STUDY&action=ARCHIVE_MARKED&studyUid=${study.studyInstanceUid}`)
      .expect(200);
    expect((audit.body.data as unknown[]).length).toBeGreaterThan(0);

    const archive = await prisma.retentionArchive.findUniqueOrThrow({ where: { studyId } });
    expect(archive.archiveStatus).toBe('ARCHIVED');
    expect(archive.archiveVerifiedAt).not.toBeNull();
    expect(archive.contentVerifiedAt).not.toBeNull();

    const keyBase = `${B2_PREFIX}/retention/studies/${studyId}/${archive.id}`;
    const expectedKeys = [
      `${keyBase}/report.json`,
      `${keyBase}/study.json`,
      `${keyBase}/archive-manifest.json`,
    ];
    expect(archive.manifestObjectKey).toBe(expectedKeys[2]);

    const uploadedArtifacts = archive.uploadedArtifacts as Array<{ key: string; sha256: string }>;
    expect(Array.isArray(uploadedArtifacts)).toBe(true);
    for (const key of expectedKeys) {
      expect(uploadedArtifacts.some((artifact) => artifact.key === key)).toBe(true);
      expect(await storage.head(key)).not.toBeNull();
      expect(storage.verifications.some((verification) => verification.key === key)).toBe(true);
    }

    const manifest = JSON.parse(storage.contentFor(expectedKeys[2])!.toString('utf8'));
    expect(manifest.archiveId).toBe(archive.id);
    expect(manifest.studyInstanceUid).toBe(study.studyInstanceUid);
    expect(manifest.artifacts.report.objectKey).toBe(expectedKeys[0]);
    expect(manifest.artifacts.study.objectKey).toBe(expectedKeys[1]);
  });

  it('fails closed when manifest writing fails', async () => {
    storage.reset();
    const { studyUid, studyId } = await createStudy(hospitalAgent);
    const orthancStudyId = `orthanc-original-${studyId}`;
    await makeEligible(studyId, orthancStudyId);

    const originalWriteFile = fs.writeFile;
    const writeSpy = jest.spyOn(fs, 'writeFile').mockImplementation((filePath: any, ...args: any[]) => {
      if (String(filePath).endsWith('/archive-manifest.json')) {
        return Promise.reject(new Error('MANIFEST_WRITE_FAILED'));
      }
      return (originalWriteFile as any)(filePath, ...args);
    });

    let res: any;
    try {
      res = await adminAgent.post('/api/admin/retention/execute').expect(201);
    } finally {
      writeSpy.mockRestore();
    }

    expect(res.body.data.archiveFailures).toBeGreaterThanOrEqual(1);

    const study = await prisma.study.findUniqueOrThrow({ where: { id: studyId } });
    expect(study.archivedAt).toBeNull();
    expect(study.orthancStudyId).toBe(orthancStudyId);
    expect(study.imagingAvailability).toBe('AVAILABLE');

    const archive = await prisma.retentionArchive.findUniqueOrThrow({ where: { studyId } });
    expect(archive.archiveStatus).toBe('FAILED');
    expect(archive.archiveVerifiedAt).toBeNull();
    expect(archive.contentVerifiedAt).toBeNull();

    const audit = await adminAgent
      .get(`/api/audit?resource=STUDY&action=ARCHIVE_MARKED&studyUid=${studyUid}`)
      .expect(200);
    expect((audit.body.data as unknown[]).length).toBe(0);
    expect(storage.uploads.length).toBe(0);
  });
});
