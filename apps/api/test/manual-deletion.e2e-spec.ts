import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  AuditResource,
  ManualDeletionArchiveStatus,
  ReportStatus,
  StudyStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { sha256File } from '../src/backup/backup-ops.js';
import type {
  ArtifactMetadata,
  BackupStorage,
  RemoteArtifact,
} from '../src/backup/backup-storage.js';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';

class MemoryDeletionStorage implements BackupStorage {
  readonly remote = true;
  readonly uploads: ArtifactMetadata[] = [];
  readonly objects = new Map<string, { bytes: Buffer; checksum: string }>();
  failUploads = false;
  beforeUpload?: () => Promise<void>;

  async upload(filePath: string, key: string, metadata: ArtifactMetadata) {
    if (this.failUploads) throw new Error('test storage unavailable');
    await this.beforeUpload?.();
    this.objects.set(key, {
      bytes: await fs.readFile(filePath),
      checksum: metadata.checksum,
    });
    this.uploads.push(metadata);
  }

  async download(key: string, filePath: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error('test object missing');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, object.bytes);
  }

  async head(key: string): Promise<RemoteArtifact | null> {
    const object = this.objects.get(key);
    return object
      ? { key, sizeBytes: String(object.bytes.length), checksum: object.checksum }
      : null;
  }

  async list(prefix: string): Promise<RemoteArtifact[]> {
    const result: RemoteArtifact[] = [];
    for (const [key, object] of this.objects) {
      if (key.startsWith(prefix)) {
        result.push({
          key,
          sizeBytes: String(object.bytes.length),
          checksum: object.checksum,
        });
      }
    }
    return result;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async purgeVersions(key: string) {
    const existed = this.objects.delete(key);
    return existed ? 1 : 0;
  }

  async verifyPurge(key: string) {
    return !this.objects.has(key);
  }

  async verify(key: string, filePath: string, expectedChecksum: string) {
    const object = this.objects.get(key);
    return Boolean(
      object &&
        object.checksum === expectedChecksum &&
        (await sha256File(filePath)) === expectedChecksum &&
        createHash('sha256').update(object.bytes).digest('hex') === expectedChecksum,
    );
  }
}

interface FixtureStudy {
  id: string;
  uid: string;
  patientId: string;
}

let app: INestApplication;
let server: any;
let storage: MemoryDeletionStorage;
let manager: { id: string; email: string; password: string; hospitalId: string };
let hospitalIds: { first: string; second: string };
let backupDir: string;
let previousBackupDir: string | undefined;
const fixtureStudies: FixtureStudy[] = [];
const archiveIds: string[] = [];

async function seedManager() {
  const suffix = randomUUID();
  const password = 'Manual-Delete-Test@123';
  const user = await prisma.user.create({
    data: {
      email: `manual-delete-${suffix}@example.test`,
      displayName: 'Manual Delete Manager',
      role: UserRole.MANAGER,
      status: UserStatus.APPROVED,
      isActive: true,
      passwordHash: bcrypt.hashSync(password, 10),
      hospitalId: hospitalIds.first,
    },
  });
  return { id: user.id, email: user.email, password, hospitalId: hospitalIds.first };
}

async function seedStudy(): Promise<FixtureStudy> {
  const suffix = randomUUID().replace(/-/g, '');
  const patient = await prisma.patient.create({
    data: {
      patientId: `MANUAL-${suffix}`,
      displayName: 'Manual Deletion Patient',
      hospitalId: hospitalIds.first,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid: `1.2.826.0.1.3680043.99.manual.${suffix}`,
      accessionNumber: `AX-MANUAL-${suffix}`,
      patientId: patient.id,
      hospitalId: hospitalIds.first,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: StudyStatus.UNASSIGNED,
    },
  });
  const series = await prisma.series.create({
    data: {
      seriesInstanceUid: `1.2.826.0.1.3680043.99.manual.series.${suffix}`,
      studyId: study.id,
      modality: 'CT',
      seriesNumber: 1,
      seriesDescription: 'Manual deletion test',
    },
  });
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: USERS.ADMIN.email },
    select: { id: true },
  });
  const report = await prisma.report.create({
    data: {
      studyId: study.id,
      authorId: admin.id,
      version: 1,
      status: ReportStatus.DRAFT,
      contentHash: `manual-delete-${suffix}`,
    },
  });
  await prisma.reportVersion.create({
    data: {
      reportId: report.id,
      version: 1,
      status: ReportStatus.DRAFT,
      findings: 'Test findings',
      impression: 'Test impression',
      authorId: admin.id,
      contentHash: `manual-delete-version-${suffix}`,
    },
  });
  await prisma.worklistItem.create({
    data: { studyId: study.id, assignedAt: new Date() },
  });
  const fixture = { id: study.id, uid: study.studyInstanceUid, patientId: patient.id };
  fixtureStudies.push(fixture);
  return fixture;
}

async function addOtherTenantArchive() {
  const suffix = randomUUID();
  const archive = await prisma.manualDeletionArchive.create({
    data: {
      hospitalId: hospitalIds.second,
      hospitalName: 'Other Hospital',
      studyInstanceUid: `1.2.826.0.1.3680043.99.other.${suffix}`,
      accessionNumber: `AX-OTHER-${suffix}`,
      patientId: `OTHER-${suffix}`,
      patientName: 'Other Tenant',
      deletedById: manager.id,
      deletedByName: 'Manual Delete Manager',
      deletedByRole: UserRole.MANAGER,
      status: ManualDeletionArchiveStatus.ARCHIVED,
      deletedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  archiveIds.push(archive.id);
  return archive;
}

beforeAll(async () => {
  previousBackupDir = process.env.AXIS_BACKUP_DIR;
  backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'axis-manual-deletion-'));
  process.env.AXIS_BACKUP_DIR = backupDir;
  const [first, second] = await Promise.all([
    prisma.hospital.findUniqueOrThrow({ where: { code: 'CGH' }, select: { id: true } }),
    prisma.hospital.findUniqueOrThrow({ where: { code: 'MMC' }, select: { id: true } }),
  ]);
  hospitalIds = { first: first.id, second: second.id };
  manager = await seedManager();
  storage = new MemoryDeletionStorage();
  const built = await createTestApp({ backupStorage: storage });
  app = built.app;
  server = built.server;
});

afterAll(async () => {
  for (const fixture of fixtureStudies) {
    await prisma.reportVersion.deleteMany({ where: { report: { studyId: fixture.id } } });
    await prisma.report.deleteMany({ where: { studyId: fixture.id } });
    await prisma.instance.deleteMany({ where: { studyId: fixture.id } });
    await prisma.series.deleteMany({ where: { studyId: fixture.id } });
    await prisma.worklistItem.deleteMany({ where: { studyId: fixture.id } });
    await prisma.assignment.deleteMany({ where: { studyId: fixture.id } });
    await prisma.notification.deleteMany({ where: { studyId: fixture.id } });
    await prisma.study.delete({ where: { id: fixture.id } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: fixture.patientId } }).catch(() => undefined);
  }
  const fixtureUids = fixtureStudies.map((fixture) => fixture.uid);
  const fixtureArchives = fixtureUids.length
    ? await prisma.manualDeletionArchive.findMany({
        where: { studyInstanceUid: { in: fixtureUids } },
        select: { id: true },
      })
    : [];
  const testArchiveIds = [...new Set([...archiveIds, ...fixtureArchives.map(({ id }) => id)])];
  if (manager) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { resource: AuditResource.MANUAL_DELETION, resourceId: { in: testArchiveIds } },
          { actorId: manager.id },
        ],
      },
    });
    await prisma.user.delete({ where: { id: manager.id } }).catch(() => undefined);
  }
  await prisma.manualDeletionArchive.deleteMany({
    where: { id: { in: testArchiveIds } },
  });
  await app?.close();
  await prisma.$disconnect();
  if (previousBackupDir === undefined) delete process.env.AXIS_BACKUP_DIR;
  else process.env.AXIS_BACKUP_DIR = previousBackupDir;
  await fs.rm(backupDir, { recursive: true, force: true });
});

describe('manual deletion and Recently Deleted', () => {
  it('rejects unauthorized direct delete and purge requests', async () => {
    await request(server)
      .post('/api/manual-deletions/studies')
      .send({ studyInstanceUids: ['1.2.3'] })
      .expect(401);

    const hospitalUser = await loginAgent(server, USERS.H_CGH);
    await hospitalUser
      .post('/api/manual-deletions/studies')
      .send({ studyInstanceUids: ['1.2.3'] })
      .expect(403);
  });

  it('archives before deleting, restores the study graph, and enforces tenant scope', async () => {
    const fixture = await seedStudy();
    const secondFixture = await seedStudy();
    const uploadStudyUids = [fixture.uid, secondFixture.uid];
    let uploadIndex = 0;
    storage.beforeUpload = async () => {
      expect(
        await prisma.study.findUnique({
          where: { studyInstanceUid: uploadStudyUids[uploadIndex++] },
          select: { id: true },
        }),
      ).not.toBeNull();
    };
    const managerAgent = await loginAgent(server, manager);
    const deleted = await managerAgent
      .post('/api/manual-deletions/studies')
      .send({ studyInstanceUids: uploadStudyUids })
      .expect(201);
    storage.beforeUpload = undefined;

    expect(deleted.body.data.map((item: { status: string }) => item.status)).toEqual([
      'DELETED',
      'DELETED',
    ]);
    expect(storage.uploads.length).toBeGreaterThanOrEqual(2);
    const archiveId = deleted.body.data[0].archiveId as string;
    const secondArchiveId = deleted.body.data[1].archiveId as string;
    archiveIds.push(archiveId);
    archiveIds.push(secondArchiveId);
    expect(await prisma.study.findUnique({ where: { id: fixture.id } })).toBeNull();
    expect(await prisma.study.findUnique({ where: { id: secondFixture.id } })).toBeNull();
    expect(
      await prisma.report.count({ where: { studyId: fixture.id } }),
    ).toBe(0);
    const archive = await prisma.manualDeletionArchive.findUniqueOrThrow({
      where: { id: archiveId },
    });
    expect(archive).toMatchObject({ status: ManualDeletionArchiveStatus.ARCHIVED });

    const otherTenant = await addOtherTenantArchive();
    const managerList = await managerAgent.get('/api/manual-deletions').expect(200);
    expect(managerList.body.data.map((item: { id: string }) => item.id)).toContain(archiveId);
    expect(managerList.body.data.map((item: { id: string }) => item.id)).toContain(secondArchiveId);
    expect(managerList.body.data.map((item: { id: string }) => item.id)).not.toContain(otherTenant.id);
    await managerAgent
      .post(`/api/manual-deletions/${otherTenant.id}/restore`)
      .expect(404);

    if (!archive.metadataObjectKey) throw new Error('Expected archived metadata');
    const metadataObject = storage.objects.get(archive.metadataObjectKey);
    if (!metadataObject) throw new Error('Expected metadata object in test storage');
    storage.objects.delete(archive.metadataObjectKey);
    await managerAgent
      .post(`/api/manual-deletions/${archiveId}/restore`)
      .expect(409);
    expect(
      await prisma.manualDeletionArchive.findUniqueOrThrow({ where: { id: archiveId } }),
    ).toMatchObject({ status: ManualDeletionArchiveStatus.ARCHIVED });
    storage.objects.set(archive.metadataObjectKey, metadataObject);

    await managerAgent
      .post(`/api/manual-deletions/${archiveId}/restore`)
      .expect(201);
    const repeatedRestore = await managerAgent
      .post(`/api/manual-deletions/${archiveId}/restore`)
      .expect(201);
    expect(repeatedRestore.body.data.alreadyRestored).toBe(true);
    const restored = await prisma.study.findUniqueOrThrow({
      where: { id: fixture.id },
      include: { series: true, reports: { include: { versions: true } }, worklistItem: true },
    });
    expect(restored.series).toHaveLength(1);
    expect(restored.reports[0]?.versions).toHaveLength(1);
    expect(restored.worklistItem).not.toBeNull();
    expect(await prisma.patient.findUnique({ where: { id: fixture.patientId } })).not.toBeNull();

    const adminAgent = await loginAgent(server, USERS.ADMIN);
    const secondArchiveKeys = [...storage.objects.keys()].filter((key) =>
      key.includes(secondArchiveId),
    );
    expect(secondArchiveKeys.length).toBeGreaterThan(0);
    await adminAgent
      .post(`/api/manual-deletions/${secondArchiveId}/purge`)
      .send({ confirmArchiveId: secondArchiveId })
      .expect(201);
    expect(
      [...storage.objects.keys()].some((key) => key.includes(secondArchiveId)),
    ).toBe(false);
    expect(
      await prisma.manualDeletionArchive.findUniqueOrThrow({
        where: { id: secondArchiveId },
      }),
    ).toMatchObject({ status: ManualDeletionArchiveStatus.PURGED, patientId: 'PURGED' });
  });

  it('keeps active rows when S3 archival fails and only lets Admin purge', async () => {
    const fixture = await seedStudy();
    storage.failUploads = true;
    const managerAgent = await loginAgent(server, manager);
    const result = await managerAgent
      .post('/api/manual-deletions/studies')
      .send({ studyInstanceUids: [fixture.uid] })
      .expect(201);
    storage.failUploads = false;

    expect(result.body.data[0].status).toBe('FAILED');
    expect(await prisma.study.findUnique({ where: { id: fixture.id } })).not.toBeNull();

    const archive = await prisma.manualDeletionArchive.findFirstOrThrow({
      where: { studyInstanceUid: fixture.uid },
    });
    archiveIds.push(archive.id);
    await managerAgent
      .post(`/api/manual-deletions/${archive.id}/purge`)
      .send({ confirmArchiveId: archive.id })
      .expect(403);
    const adminAgent = await loginAgent(server, USERS.ADMIN);
    await adminAgent
      .post(`/api/manual-deletions/${archive.id}/purge`)
      .send({ confirmArchiveId: archive.id })
      .expect(201);
    expect(
      await prisma.manualDeletionArchive.findUniqueOrThrow({ where: { id: archive.id } }),
    ).toMatchObject({
      status: ManualDeletionArchiveStatus.PURGED,
      patientId: 'PURGED',
      patientName: 'Purged',
      metadataObjectKey: null,
      fileObjects: null,
    });
  });
});
