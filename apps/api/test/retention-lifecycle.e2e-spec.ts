import 'reflect-metadata';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { Prisma, RetentionJobType, UserRole } from '@prisma/client';
import { sha256File } from '../src/backup/backup-ops.js';
import * as dicomBackup from '../src/backup/dicom-backup.js';
import {
  BACKUP_STORAGE,
  type BackupStorage,
} from '../src/backup/backup-storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';
import type { RetentionActor } from '../src/retention/retention-audit.service.js';
import { RetentionArchiveService } from '../src/retention/retention-archive.service.js';
import { retentionPolicy } from '../src/retention/retention-config.js';
import { RetentionJobService } from '../src/retention/retention-job.service.js';
import { RetentionNotificationService } from '../src/retention/retention-notification.service.js';
import { RetentionAuditService } from '../src/retention/retention-audit.service.js';
import {
  archivedReportMatchesStudy,
  buildArchivedReportArtifact,
} from '../src/retention/retention-archive.dto.js';
import { retentionStudyInclude } from '../src/retention/retention-eligibility.service.js';
import { RetentionService } from '../src/retention/retention.service.js';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const BACKUP_DIR = '/tmp/opencode/axis-retention-lifecycle-e2e';

const ENV_KEYS = [
  'AXIS_RETENTION_DAYS',
  'AXIS_RETENTION_REQUIRE_BACKUP',
  'INITIAL_RETENTION_DAYS',
  'CANCEL_REMINDER_DAYS',
  'CANCEL_MAX_COUNT',
  'IGNORE_RESPONSE_HOURS',
  'IGNORE_REMINDER_DAYS',
  'IGNORE_MAX_COUNT',
  'DICOM_BACKUP_RETENTION_DAYS',
  'METADATA_BACKUP_RETENTION_DAYS',
  'RETENTION_SCHEDULER_ENABLED',
  'RETENTION_DRY_RUN',
  'RETENTION_DELETE_ENABLED',
  'RETENTION_BACKUP_DELETE_ENABLED',
  'RETENTION_DICOM_ARCHIVE_ENABLED',
  'BACKUP_STORAGE_PROVIDER',
  'B2_KEY_ID',
  'B2_APPLICATION_KEY',
  'AXIS_BACKUP_DIR',
  'AXIS_ENV',
] as const;

const originalEnv: Record<string, string | undefined> = {};
const createdStudyIds: string[] = [];
const createdBackupRunIds: string[] = [];

let app: INestApplication;
let server: any;
let retentionService: RetentionService;
let notificationService: RetentionNotificationService;
let archiveService: RetentionArchiveService;
let jobService: RetentionJobService;
let adminAgent: any;
let adminActor: RetentionActor;
let hospitalAgent: any;
let managerAgent: any;
let radUser: any;

function uid(): string {
  return `1.2.826.0.1.3680043.8.498.retention-lifecycle.${Date.now()}.${randomUUID()
    .replace(/-/g, '')
    .slice(0, 12)}`;
}

function actorFrom(user: any): RetentionActor {
  return {
    id: user.id,
    role: user.role as UserRole,
    displayName: user.displayName,
    email: user.email,
    hospitalId: user.hospitalId,
  };
}

async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((callback) => {
    resolve = callback;
  });
  return { promise, resolve };
}

function stubOrthancDelete(onDelete?: (orthancStudyId: string) => Promise<void>) {
  const deleteSpy = jest
    .spyOn(dicomBackup, 'deleteOrthancStudy')
    .mockImplementation(async (orthancStudyId) => {
      if (onDelete) await onDelete(orthancStudyId);
    });
  const existsSpy = jest.spyOn(dicomBackup, 'orthancStudyExists').mockResolvedValue(false);
  return {
    deleteSpy,
    existsSpy,
    restore() {
      deleteSpy.mockRestore();
      existsSpy.mockRestore();
    },
  };
}

function orthancDeleteCallsFor(
  stub: ReturnType<typeof stubOrthancDelete>,
  studyId: string,
): unknown[][] {
  const target = `orthanc-${studyId}`;
  return stub.deleteSpy.mock.calls.filter(([orthancStudyId]) => orthancStudyId === target);
}

function blockRetentionArchiveUpdateMany(
  client: PrismaService,
  match: (args: Prisma.RetentionArchiveUpdateManyArgs) => boolean,
) {
  const reached = deferred();
  const release = deferred();
  const internal = client as any;
  const middleware = async (params: any, next: (params: any) => Promise<any>) => {
    if (
      params.model === 'RetentionArchive' &&
      params.action === 'updateMany' &&
      match(params.args as Prisma.RetentionArchiveUpdateManyArgs)
    ) {
      reached.resolve();
      await release.promise;
    }
    return next(params);
  };
  internal.$use(middleware);
  const middlewares = internal._middlewares._middlewares as unknown[];
  return {
    reached: reached.promise,
    release: release.resolve,
    restore() {
      const index = middlewares.indexOf(middleware);
      if (index >= 0) middlewares.splice(index, 1);
    },
  };
}

async function createValidFakeArchive(
  studyId: string,
  studyUid: string,
  options: { backupRunId?: string; dicomDeleteAt?: Date } = {},
) {
  const retention = await prisma.studyRetention.findUniqueOrThrow({
    where: { studyId },
  });
  const report = await prisma.report.findFirstOrThrow({
    where: { studyId },
    select: { contentHash: true },
  });
  const archiveId = `fake-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const dir = `${BACKUP_DIR}/retention-objects/${studyId}/${archiveId}`;
  await fs.mkdir(dir, { recursive: true });
  const dicomPath = `${dir}/dicom.tar.gz`;
  const reportPath = `${dir}/report.json`;
  const studyPath = `${dir}/study.json`;
  const manifestPath = `${dir}/archive-manifest.json`;
  await fs.writeFile(dicomPath, `dicom-${archiveId}`, 'utf8');
  await fs.writeFile(
    reportPath,
    JSON.stringify({
      archiveId,
      studyInstanceUid: studyUid,
      reports: [{ contentHash: report.contentHash }],
      versionSnapshots: [],
    }),
    'utf8',
  );
  await fs.writeFile(
    studyPath,
    JSON.stringify({ archiveId, studyInstanceUid: studyUid }),
    'utf8',
  );
  const dicomChecksum = await sha256File(dicomPath);
  const reportChecksum = await sha256File(reportPath);
  const studyChecksum = await sha256File(studyPath);
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      version: 1,
      archiveId,
      studyInstanceUid: studyUid,
      dicomObjectKey: dicomPath,
      dicomChecksum,
      dicomObjectOwned: true,
      reportSha256: reportChecksum,
      studySha256: studyChecksum,
      artifacts: {
        report: { file: 'report.json', sha256: reportChecksum, objectKey: reportPath },
        study: { file: 'study.json', sha256: studyChecksum, objectKey: studyPath },
        dicom: { file: 'dicom.tar.gz', sha256: dicomChecksum, objectKey: dicomPath },
      },
    }),
    'utf8',
  );
  const checksum = await sha256File(manifestPath);
  await prisma.study.update({
    where: { id: studyId },
    data: { orthancStudyId: `orthanc-${studyId}` },
  });
  const archive = await prisma.retentionArchive.create({
    data: {
      id: archiveId,
      studyId,
      retentionId: retention.id,
      backupRunId: options.backupRunId,
      archiveStatus: 'ARCHIVED',
      archiveCreatedAt: new Date(),
      archiveVerifiedAt: new Date(),
      contentVerifiedAt: new Date(),
      dicomObjectKey: dicomPath,
      dicomObjectOwned: true,
      dicomChecksum,
      studyObjectKey: studyPath,
      reportObjectKey: reportPath,
      manifestObjectKey: manifestPath,
      checksum,
      dicomDeleteAt: options.dicomDeleteAt ?? null,
      originalDataDeletionStatus: 'PENDING',
      dicomDeletionStatus: 'PENDING',
      metadataDeletionStatus: 'PENDING',
      uploadedArtifacts: [
        { file: 'report.json', key: reportPath, sha256: reportChecksum },
        { file: 'study.json', key: studyPath, sha256: studyChecksum },
        { file: 'archive-manifest.json', key: manifestPath, sha256: checksum },
        { file: 'dicom.tar.gz', key: dicomPath, sha256: dicomChecksum },
      ] as any,
    },
  });
  return { archive, dicomPath, manifestPath };
}

async function createLifecycleStudy(): Promise<{ studyId: string; studyUid: string }> {
  const studyUid = uid();
  const res = await hospitalAgent.post('/api/studies').send({
    patientName: 'Retention Lifecycle Patient',
    patientId: `RL-${randomUUID().slice(0, 8)}`,
    studyInstanceUid: studyUid,
    modality: 'CT',
    bodyPart: 'CHEST',
    studyDescription: 'Retention lifecycle e2e fixture',
  });
  if (res.status !== 201) {
    throw new Error(`createStudy failed ${res.status}: ${res.text}`);
  }
  const studyId = res.body.data.id;
  createdStudyIds.push(studyId);
  const study = await prisma.study.findUniqueOrThrow({
    where: { id: studyId },
    select: { hospitalId: true },
  });
  const anchorAt = new Date(Date.now() - 45 * DAY);
  const report = await prisma.report.create({
    data: {
      studyId,
      authorId: radUser.id,
      status: 'SIGNED',
      signedOffAt: anchorAt,
      contentHash: `retention-lifecycle-${studyId}`,
      findings: 'Lifecycle audit findings',
      impression: 'Lifecycle audit impression',
      contentHtml: '<p>Lifecycle audit report content</p>',
    },
    select: { id: true },
  });
  await prisma.deliveryAttempt.create({
    data: {
      studyId,
      reportId: report.id,
      hospitalId: study.hospitalId,
      status: 'COMPLETED',
      deliveredAt: anchorAt,
    },
  });
  await prisma.worklistItem.updateMany({
    where: { studyId },
    data: { completedAt: anchorAt },
  });
  await prisma.study.update({
    where: { id: studyId },
    data: {
      status: 'COMPLETED',
      completedAt: anchorAt,
      deliveredAt: anchorAt,
      signedOffAt: anchorAt,
      imagingAvailability: 'AVAILABLE',
      imagingAvailabilityReason: null,
    },
  });
  return { studyId, studyUid };
}

async function startForStudy(studyId: string) {
  expect(await retentionService.startLifecycle()).toBeGreaterThan(0);
  const retention = await prisma.studyRetention.findUniqueOrThrow({
    where: { studyId },
  });
  return retention;
}

async function adminNotice(studyId: string, sequence: number) {
  const notification = await prisma.retentionNotification.findFirst({
    where: {
      studyId,
      sequenceNumber: sequence,
      recipientUserId: adminActor.id,
    },
    orderBy: { createdAt: 'asc' },
  });
  expect(notification).toBeTruthy();
  return notification!;
}

async function archiveJobFor(retentionId: string) {
  return prisma.retentionJob.findUnique({
    where: { dedupeKey: `retention-archive:${retentionId}` },
  });
}

beforeAll(async () => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

  process.env.AXIS_RETENTION_DAYS = '30';
  process.env.AXIS_RETENTION_REQUIRE_BACKUP = 'false';
  process.env.INITIAL_RETENTION_DAYS = '20';
  process.env.CANCEL_REMINDER_DAYS = '20';
  process.env.CANCEL_MAX_COUNT = '2';
  process.env.IGNORE_RESPONSE_HOURS = '24';
  process.env.IGNORE_REMINDER_DAYS = '3';
  process.env.IGNORE_MAX_COUNT = '2';
  process.env.DICOM_BACKUP_RETENTION_DAYS = '14';
  process.env.METADATA_BACKUP_RETENTION_DAYS = '30';
  process.env.RETENTION_SCHEDULER_ENABLED = 'false';
  process.env.RETENTION_DRY_RUN = 'true';
  process.env.RETENTION_DELETE_ENABLED = 'false';
  process.env.RETENTION_BACKUP_DELETE_ENABLED = 'false';
  process.env.RETENTION_DICOM_ARCHIVE_ENABLED = 'false';
  process.env.BACKUP_STORAGE_PROVIDER = 'LOCAL';
  process.env.B2_KEY_ID = '';
  process.env.B2_APPLICATION_KEY = '';
  process.env.AXIS_BACKUP_DIR = BACKUP_DIR;
  process.env.AXIS_ENV = 'test';

  await fs.rm(BACKUP_DIR, { recursive: true, force: true });

  const built = await createTestApp();
  app = built.app;
  server = built.server;
  retentionService = app.get(RetentionService);
  notificationService = app.get(RetentionNotificationService);
  archiveService = app.get(RetentionArchiveService);
  jobService = app.get(RetentionJobService);

  adminAgent = await loginAgent(server, USERS.ADMIN);
  managerAgent = await loginAgent(server, USERS.MANAGER);
  hospitalAgent = await loginAgent(server, USERS.H_CGH);
  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: USERS.ADMIN.email },
  });
  radUser = await prisma.user.findUniqueOrThrow({
    where: { email: USERS.RAD1.email },
  });
  adminActor = actorFrom(adminUser);
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const studies = await prisma.study.findMany({
    where: { id: { in: createdStudyIds } },
    select: { patientId: true },
  });
  const patientIds = studies.map((study) => study.patientId);
  const reports = await prisma.report.findMany({
    where: { studyId: { in: createdStudyIds } },
    select: { id: true },
  });
  const reportIds = reports.map((report) => report.id);

  await prisma.notification.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.retentionJob.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.retentionAuditLog.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.retentionNotification.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.retentionArchive.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.studyRetention.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.backupRun.deleteMany({
    where: { id: { in: createdBackupRunIds } },
  });
  await prisma.reportVersion.deleteMany({
    where: { reportId: { in: reportIds } },
  });
  await prisma.changeRequest.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.deliveryAttempt.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.worklistItem.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.assignment.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.report.deleteMany({
    where: { studyId: { in: createdStudyIds } },
  });
  await prisma.study.deleteMany({
    where: { id: { in: createdStudyIds } },
  });
  await prisma.patient.deleteMany({
    where: {
      id: { in: patientIds },
      studies: { none: {} },
    },
  });

  await fs.rm(BACKUP_DIR, { recursive: true, force: true });
  await prisma.$disconnect();
  await app.close();
});

describe('Retention lifecycle', () => {
  it('RL-1: legal hold overrides lifecycle notifications and preview eligibility', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);

    await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');

    const held = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(held.retentionLocked).toBe(true);
    expect(held.status).toBe('ON_HOLD');

    await notificationService.sendDueNotifications(new Date());
    const notices = await prisma.retentionNotification.count({ where: { studyId } });
    expect(notices).toBe(0);

    const preview = await adminAgent
      .get('/api/admin/retention/preview')
      .expect(200);
    const row = (preview.body.data.candidates as any[]).find(
      (candidate) => candidate.studyId === studyId,
    );
    expect(row.reason).toBe('LEGAL_HOLD');

    await retentionService.releaseLegalHold(studyId, adminActor);
    const released = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(released.retentionLocked).toBe(false);
    expect(released.status).toBe('PENDING_RETENTION');
  });

  it('RL-2: cancel defers once, then triggers automatic processing at the limit', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await notificationService.sendDueNotifications(new Date());

    const first = await adminNotice(studyId, 1);
    expect(first.deliveryStatus).toBe('DELIVERED');

    const firstResponse = await notificationService.respond(
      first.id,
      adminActor,
      'CANCEL',
    );
    expect(firstResponse.cancelCount).toBe(1);
    expect(firstResponse.retentionStatus).toBe('CANCELLED_DEFERRED');

    const deferred = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(deferred.status).toBe('CANCELLED_DEFERRED');
    expect(deferred.cancelCount).toBe(1);

    await notificationService.sendDueNotifications(
      new Date(Date.now() + 21 * DAY),
    );
    const second = await adminNotice(studyId, 2);
    const secondResponse = await notificationService.respond(
      second.id,
      adminActor,
      'CANCEL',
    );
    expect(secondResponse.cancelCount).toBe(2);
    expect(secondResponse.retentionStatus).toBe('AUTOMATIC_PROCESSING');

    const processed = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(processed.status).toBe('AUTOMATIC_PROCESSING');
    const job = await archiveJobFor(processed.id);
    expect(job?.type).toBe(RetentionJobType.PROCESS_ARCHIVE);

    const listed = await retentionService.listNotifications(adminActor);
    expect(listed.data.some((item) => item.id === first.id)).toBe(true);
    expect(listed.data.find((item) => item.id === first.id)?.reportStatus).toBe(
      'SIGNED',
    );
  });

  it('RL-3: ignored notices are counted once per sequence and trigger automatic processing', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await notificationService.sendDueNotifications(new Date());

    expect(
      await notificationService.markIgnoredDue(new Date(Date.now() + 25 * HOUR)),
    ).toBeGreaterThan(0);

    const firstIgnored = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(firstIgnored.ignoredCount).toBe(1);
    expect(firstIgnored.status).toBe('NOTIFICATION_IGNORED');

    await notificationService.markIgnoredDue(new Date(Date.now() + 26 * HOUR));
    const duplicateIgnored = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(duplicateIgnored.ignoredCount).toBe(1);

    await notificationService.sendDueNotifications(
      new Date(Date.now() + 6 * DAY),
    );
    expect(
      await notificationService.markIgnoredDue(new Date(Date.now() + 7 * DAY)),
    ).toBeGreaterThan(0);

    const processed = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(processed.ignoredCount).toBe(2);
    expect(processed.status).toBe('AUTOMATIC_PROCESSING');
    const job = await archiveJobFor(processed.id);
    expect(job?.type).toBe(RetentionJobType.PROCESS_ARCHIVE);
  });

  it('RL-4: explicit DELETE archives safely and destructive expiry stays disabled by default', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await notificationService.sendDueNotifications(new Date());

    const notice = await adminNotice(studyId, 1);
    const response = await notificationService.respond(
      notice.id,
      adminActor,
      'DELETE',
    );
    expect(response.retentionStatus).toBe('AUTOMATIC_PROCESSING');

    const retention = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    await retentionService.processJob({
      id: `test-${retention.id}`,
      type: RetentionJobType.PROCESS_ARCHIVE,
      studyId,
      retentionId: retention.id,
      payload: { retentionId: retention.id },
    });

    const archivedStudy = await prisma.study.findUniqueOrThrow({
      where: { id: studyId },
    });
    expect(archivedStudy.archivedAt).not.toBeNull();

    const archive = await prisma.retentionArchive.findUniqueOrThrow({
      where: { studyId },
    });
    expect(archive.archiveStatus).toBe('ARCHIVED');
    expect(archive.archiveVerifiedAt).not.toBeNull();
    expect(archive.contentVerifiedAt).not.toBeNull();
    expect(archive.dicomObjectOwned).toBe(false);
    expect(archive.dicomDeleteAt).toBeNull();
    expect(archive.metadataDeleteAt).toBeTruthy();

    const past = new Date(Date.now() - DAY);
    await prisma.retentionArchive.update({
      where: { id: archive.id },
      data: { dicomDeleteAt: past, metadataDeleteAt: past },
    });

    const expiry = await archiveService.processDueBackups();
    expect(expiry.dicomDeleted).toBe(0);
    expect(expiry.metadataDeleted).toBe(0);

    const unchangedArchive = await prisma.retentionArchive.findUniqueOrThrow({
      where: { id: archive.id },
    });
    expect(unchangedArchive.archiveStatus).toBe('ARCHIVED');
    expect(unchangedArchive.dicomDeletionStatus).toBe('PENDING');
    expect(unchangedArchive.metadataDeletionStatus).toBe('PENDING');

    const cleanup = await archiveService.cleanupOriginalData(studyId);
    expect(cleanup).toEqual({ deleted: false, reason: 'DELETION_DISABLED' });
    expect(archivedStudy.orthancStudyId).toBeNull();
  });

  it('RL-5: cleanup refuses an archive without an owned DICOM artifact', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await notificationService.sendDueNotifications(new Date());
    const notice = await adminNotice(studyId, 1);
    await notificationService.respond(notice.id, adminActor, 'DELETE');
    await archiveService.createArchive(studyId, adminActor);

    const originalDryRun = process.env.RETENTION_DRY_RUN;
    const originalDelete = process.env.RETENTION_DELETE_ENABLED;
    const originalDicomArchive = process.env.RETENTION_DICOM_ARCHIVE_ENABLED;
    try {
      process.env.RETENTION_DRY_RUN = 'false';
      process.env.RETENTION_DELETE_ENABLED = 'true';
      process.env.RETENTION_DICOM_ARCHIVE_ENABLED = 'true';
      expect(await archiveService.cleanupOriginalData(studyId)).toEqual({
        deleted: false,
        reason: 'DEDICATED_DICOM_ARCHIVE_REQUIRED',
      });
    } finally {
      if (originalDryRun === undefined) delete process.env.RETENTION_DRY_RUN;
      else process.env.RETENTION_DRY_RUN = originalDryRun;
      if (originalDelete === undefined) delete process.env.RETENTION_DELETE_ENABLED;
      else process.env.RETENTION_DELETE_ENABLED = originalDelete;
      if (originalDicomArchive === undefined) delete process.env.RETENTION_DICOM_ARCHIVE_ENABLED;
      else process.env.RETENTION_DICOM_ARCHIVE_ENABLED = originalDicomArchive;
    }
  });

  it('RL-6: stale archive claims are recoverable and report content is preserved', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await notificationService.sendDueNotifications(new Date());
    const notice = await adminNotice(studyId, 1);
    await notificationService.respond(notice.id, adminActor, 'DELETE');
    await archiveService.createArchive(studyId, adminActor);

    const first = await prisma.retentionArchive.findUniqueOrThrow({
      where: { studyId },
    });
    await prisma.retentionArchive.update({
      where: { id: first.id },
      data: {
        archiveStatus: 'ARCHIVING',
        claimUntil: new Date(Date.now() - HOUR),
        contentVerifiedAt: null,
      },
    });

    const retried = await archiveService.createArchive(studyId, adminActor);
    expect(retried.archived).toBe(true);
    const recovered = await prisma.retentionArchive.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(recovered.archiveStatus).toBe('ARCHIVED');
    expect(recovered.claimUntil).toBeNull();
    expect(recovered.contentVerifiedAt).not.toBeNull();
    expect(Array.isArray(recovered.uploadedArtifacts)).toBe(true);
    expect((recovered.uploadedArtifacts as any[]).length).toBeGreaterThan(0);

    const reportJson = JSON.parse(
      await fs.readFile(
        `${BACKUP_DIR}/retention-objects/${studyId}/${first.id}/report.json`,
        'utf8',
      ),
    );
    expect(reportJson.reports[0].findings).toBe('Lifecycle audit findings');
    expect(reportJson.reports[0].contentHtml).toContain('Lifecycle audit report content');
    expect(reportJson.patient.displayName).toBe('Retention Lifecycle Patient');
    expect(reportJson.hospital.name).toBeTruthy();
  });

  it('RL-7: manager job list and retry are hospital scoped', async () => {
    const { studyId } = await createLifecycleStudy();
    const job = await prisma.retentionJob.create({
      data: {
        type: RetentionJobType.PROCESS_ARCHIVE,
        dedupeKey: `retention-scope-test:${studyId}`,
        dueAt: new Date(),
        studyId,
        maxAttempts: 5,
      },
    });
    const managerActor: RetentionActor = {
      ...adminActor,
      role: UserRole.MANAGER,
      hospitalId: '__other_hospital__',
    };

    const listed = await retentionService.listJobs(managerActor);
    expect(listed.data.some((item) => item.id === job.id)).toBe(false);
    await expect(retentionService.retryJob(job.id, managerActor)).rejects.toThrow(
      /not found/i,
    );
  });

  it('RL-8: invalid safety configuration fails closed', () => {
    const original = process.env.CANCEL_MAX_COUNT;
    try {
      process.env.CANCEL_MAX_COUNT = 'not-a-number';
      expect(() => retentionPolicy()).toThrow(/CANCEL_MAX_COUNT/);
    } finally {
      if (original === undefined) delete process.env.CANCEL_MAX_COUNT;
      else process.env.CANCEL_MAX_COUNT = original;
    }
  });

  it('RL-9: purge verification distinguishes present and removed objects', async () => {
    const storage = app.get<BackupStorage>(BACKUP_STORAGE);
    const key = `${BACKUP_DIR}/purge-verification.txt`;
    await fs.writeFile(key, 'present', 'utf8');
    expect(await storage.verifyPurge?.(key)).toBe(false);
    await storage.delete(key);
    expect(await storage.verifyPurge?.(key)).toBe(true);
  });

  it('RL-10: job leases can be renewed only by their owning worker', async () => {
    const { studyId } = await createLifecycleStudy();
    const job = await prisma.retentionJob.create({
      data: {
        type: RetentionJobType.PROCESS_ARCHIVE,
        dedupeKey: `retention-lease-test:${studyId}`,
        dueAt: new Date(),
        studyId,
        status: 'RUNNING',
        lockedBy: 'lease-worker',
        leaseUntil: new Date(Date.now() - HOUR),
        maxAttempts: 5,
      },
    });

    expect(await jobService.renewLease(job.id, 'lease-worker', HOUR)).toBe(true);
    const renewed = await prisma.retentionJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(renewed.leaseUntil).not.toBeNull();
    expect(renewed.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await jobService.renewLease(job.id, 'other-worker', HOUR)).toBe(false);
  });

  it('RL-11: critical destructive flag combinations fail closed or stay explicitly safe', async () => {
    const cases = [
      {
        name: 'enabled+enabled',
        env: {
          RETENTION_DELETE_ENABLED: 'true',
          RETENTION_DRY_RUN: 'false',
          RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
          RETENTION_BACKUP_DELETE_ENABLED: 'false',
        },
        throws: false,
      },
      {
        name: 'disabled+disabled',
        env: {
          RETENTION_DELETE_ENABLED: 'false',
          RETENTION_DRY_RUN: 'true',
          RETENTION_DICOM_ARCHIVE_ENABLED: 'false',
          RETENTION_BACKUP_DELETE_ENABLED: 'false',
        },
        throws: false,
      },
      {
        name: 'disabled+enabled',
        env: {
          RETENTION_DELETE_ENABLED: 'false',
          RETENTION_DRY_RUN: 'true',
          RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
          RETENTION_BACKUP_DELETE_ENABLED: 'false',
        },
        throws: false,
      },
      {
        name: 'delete with dry run',
        env: {
          RETENTION_DELETE_ENABLED: 'true',
          RETENTION_DRY_RUN: 'true',
          RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
          RETENTION_BACKUP_DELETE_ENABLED: 'false',
        },
        throws: true,
      },
      {
        name: 'delete without owned archive',
        env: {
          RETENTION_DELETE_ENABLED: 'true',
          RETENTION_DRY_RUN: 'false',
          RETENTION_DICOM_ARCHIVE_ENABLED: 'false',
          RETENTION_BACKUP_DELETE_ENABLED: 'false',
        },
        throws: true,
      },
      {
        name: 'backup delete with dry run',
        env: {
          RETENTION_DELETE_ENABLED: 'false',
          RETENTION_DRY_RUN: 'true',
          RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
          RETENTION_BACKUP_DELETE_ENABLED: 'true',
        },
        throws: true,
      },
    ];
    for (const testCase of cases) {
      await withEnv(testCase.env, async () => {
        if (testCase.throws) expect(() => retentionPolicy()).toThrow();
        else expect(() => retentionPolicy()).not.toThrow();
      });
    }
  });

  it('RL-12: DICOM archive upload failure leaves the archive failed and unverified', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'false',
        RETENTION_DRY_RUN: 'true',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        await expect(archiveService.createArchive(studyId, adminActor)).rejects.toThrow();
      },
    );
    const archive = await prisma.retentionArchive.findUniqueOrThrow({
      where: { studyId },
    });
    expect(archive.archiveStatus).toBe('FAILED');
    expect(archive.contentVerifiedAt).toBeNull();
    expect(archive.dicomObjectOwned).toBe(false);
  });

  it('RL-13: cleanup fails closed when the archived DICOM object is missing', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid);
    await prisma.retentionArchive.update({
      where: { id: archive.id },
      data: { dicomObjectKey: `${BACKUP_DIR}/missing-${randomUUID()}.tar.gz` },
    });
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        expect(await archiveService.cleanupOriginalData(studyId)).toEqual({
          deleted: false,
          reason: 'ARCHIVE_OBJECT_VERIFICATION_FAILED',
        });
      },
    );
  });

  it('RL-14: cleanup fails closed when the archived manifest checksum is invalid', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid);
    await prisma.retentionArchive.update({
      where: { id: archive.id },
      data: { checksum: 'invalid-checksum' },
    });
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        expect(await archiveService.cleanupOriginalData(studyId)).toEqual({
          deleted: false,
          reason: 'ARCHIVE_OBJECT_VERIFICATION_FAILED',
        });
      },
    );
  });

  it('RL-15: retention expiry preserves a DICOM object referenced by a full backup', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid, {
      dicomDeleteAt: new Date(Date.now() - HOUR),
    });
    const backupRun = await prisma.backupRun.create({
      data: {
        type: 'FULL',
        status: 'VERIFIED',
        completedAt: new Date(),
        verifiedAt: new Date(),
        dicomObjectKey: archive.dicomObjectKey,
        dicomChecksum: archive.dicomChecksum,
        dicomVerified: true,
        createdById: adminActor.id,
      },
    });
    createdBackupRunIds.push(backupRun.id);
    await prisma.retentionArchive.update({
      where: { id: archive.id },
      data: { backupRunId: backupRun.id },
    });
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'false',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'true',
      },
      async () => {
        await archiveService.processDueBackups();
      },
    );
    await expect(fs.stat(archive.dicomObjectKey!)).resolves.toBeTruthy();
    const unchanged = await prisma.retentionArchive.findUniqueOrThrow({
      where: { id: archive.id },
    });
    expect(unchanged.dicomDeletionStatus).toBe('FAILED');
  });

  it('RL-16: concurrent cancellation responses are counted once', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await notificationService.sendDueNotifications(new Date());
    const first = await adminNotice(studyId, 1);
    await notificationService.respond(first.id, adminActor, 'CANCEL');
    await notificationService.sendDueNotifications(new Date(Date.now() + 21 * DAY));
    const second = await adminNotice(studyId, 2);
    const outcomes = await Promise.allSettled([
      notificationService.respond(second.id, adminActor, 'CANCEL'),
      notificationService.respond(second.id, adminActor, 'CANCEL'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const retention = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(retention.cancelCount).toBe(2);
    expect(retention.status).toBe('AUTOMATIC_PROCESSING');
  });

  it('RL-17: concurrent ignored processing counts one sequence once', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await notificationService.sendDueNotifications(new Date());
    await Promise.all([
      notificationService.markIgnoredDue(new Date(Date.now() + 25 * HOUR)),
      notificationService.markIgnoredDue(new Date(Date.now() + 25 * HOUR)),
    ]);
    const retention = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(retention.ignoredCount).toBe(1);
  });

  it('RL-18: a transaction failure rolls back notification counters and responses', async () => {
    const { studyId } = await createLifecycleStudy();
    await startForStudy(studyId);
    await notificationService.sendDueNotifications(new Date());
    const notice = await adminNotice(studyId, 1);
    const retentionAudit = app.get(RetentionAuditService);
    const auditRecord = jest
      .spyOn(retentionAudit, 'recordTx')
      .mockRejectedValueOnce(new Error('audit_failure'));
    await expect(
      notificationService.respond(notice.id, adminActor, 'CANCEL'),
    ).rejects.toThrow('audit_failure');
    auditRecord.mockRestore();
    const retention = await prisma.studyRetention.findUniqueOrThrow({
      where: { studyId },
    });
    expect(retention.cancelCount).toBe(0);
    const unchanged = await prisma.retentionNotification.findUniqueOrThrow({
      where: { id: notice.id },
    });
    expect(unchanged.respondedAt).toBeNull();
  });

  it('RL-19: a legal hold aborts an in-flight cleanup before the finalization boundary', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid);
    await prisma.retentionArchive.update({
      where: { id: archive.id },
      data: {
        originalDataDeletionStatus: 'IN_PROGRESS',
        cleanupClaimUntil: new Date(Date.now() + HOUR),
        cleanupFinalized: false,
      },
    });
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
        const aborted = await prisma.retentionArchive.findUniqueOrThrow({
          where: { id: archive.id },
        });
        expect(aborted.originalDataDeletionStatus).toBe('FAILED');
        expect(aborted.lastError).toBe('LEGAL_HOLD_DURING_CLEANUP');
        expect(await archiveService.cleanupOriginalData(studyId)).toEqual({
          deleted: false,
          reason: 'LEGAL_HOLD',
        });
      },
    );
  });

  it('RL-20: a hold after finalization is recorded without silently racing cleanup', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid);
    await prisma.retentionArchive.update({
      where: { id: archive.id },
      data: {
        originalDataDeletionStatus: 'FINALIZING',
        cleanupClaimUntil: new Date(Date.now() + HOUR),
        cleanupFinalized: true,
      },
    });
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
        const audit = await prisma.retentionAuditLog.findFirst({
          where: { studyId, action: 'RETENTION_LOCK_APPLIED' },
          orderBy: { timestamp: 'desc' },
        });
        expect((audit?.details as any)?.cleanupBoundaryCrossed).toBe(true);
        expect(await archiveService.cleanupOriginalData(studyId)).toEqual({
          deleted: false,
          reason: 'LEGAL_HOLD',
        });
      },
    );
  });

  it('RL-21: manager HTTP paths do not expose another hospital’s jobs or studies', async () => {
    const { studyId } = await createLifecycleStudy();
    const job = await prisma.retentionJob.create({
      data: {
        type: RetentionJobType.PROCESS_ARCHIVE,
        dedupeKey: `retention-http-scope:${studyId}`,
        dueAt: new Date(),
        studyId,
        maxAttempts: 5,
      },
    });
    const listed = await managerAgent.get('/api/admin/retention/jobs').expect(200);
    expect(listed.body.data.some((item: any) => item.id === job.id)).toBe(false);
    await managerAgent
      .post(`/api/admin/retention/jobs/${job.id}/retry`)
      .expect(404);
    await managerAgent
      .post(`/api/admin/retention/holds/${studyId}`)
      .send({ reason: 'LEGAL_HOLD' })
      .expect(404);
  });

  it('RL-22: a hold applied before cleanup prevents Orthanc deletion', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    await createValidFakeArchive(studyId, studyUid);
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        const stub = stubOrthancDelete();
        try {
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          expect(await archiveService.cleanupOriginalData(studyId)).toEqual({
            deleted: false,
            reason: 'LEGAL_HOLD',
          });
          expect(orthancDeleteCallsFor(stub, studyId)).toHaveLength(0);
        } finally {
          stub.restore();
        }
      },
    );
  });

  it('RL-23: a hold during IN_PROGRESS aborts the in-flight worker', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid);
    const gate = deferred();
    const reached = deferred();
    let verificationCalls = 0;
    const originalVerify = (archiveService as any).verifyArchiveObjects.bind(archiveService);
    const verifySpy = jest
      .spyOn(archiveService as any, 'verifyArchiveObjects')
      .mockImplementation(async (...args: any[]) => {
        verificationCalls += 1;
        if (verificationCalls === 2) {
          reached.resolve();
          await gate.promise;
        }
        return originalVerify(...args);
      });
    const stub = stubOrthancDelete();
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        try {
          const cleanup = archiveService.cleanupOriginalData(studyId);
          await reached.promise;
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          gate.resolve();
          expect(await cleanup).toEqual({ deleted: false, reason: 'LEGAL_HOLD' });
          expect(orthancDeleteCallsFor(stub, studyId)).toHaveLength(0);
          const aborted = await prisma.retentionArchive.findUniqueOrThrow({
            where: { id: archive.id },
          });
          expect(aborted.originalDataDeletionStatus).toBe('FAILED');
          expect(aborted.lastError).toBe('LEGAL_HOLD_DURING_CLEANUP');
        } finally {
          gate.resolve();
          verifySpy.mockRestore();
          stub.restore();
        }
      },
    );
  });

  it('RL-24: a hold after FINALIZING but before dispatch prevents Orthanc deletion', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid);
    const block = blockRetentionArchiveUpdateMany(app.get(PrismaService), (args) =>
      Boolean(args?.data?.orthancDeleteDispatchedAt),
    );
    const stub = stubOrthancDelete();
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        try {
          const cleanup = archiveService.cleanupOriginalData(studyId);
          await block.reached;
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          block.release();
          expect(await cleanup).toEqual({ deleted: false, reason: 'LEGAL_HOLD' });
          expect(orthancDeleteCallsFor(stub, studyId)).toHaveLength(0);
          const held = await prisma.retentionArchive.findUniqueOrThrow({
            where: { id: archive.id },
          });
          expect(held.originalDataDeletionStatus).toBe('FAILED');
          expect(held.orthancDeleteDispatchedAt).toBeNull();
          const audit = await prisma.retentionAuditLog.findFirst({
            where: { studyId, action: 'RETENTION_LOCK_APPLIED' },
            orderBy: { timestamp: 'desc' },
          });
          expect((audit?.details as any)?.cleanupBoundaryCrossed).toBe(true);
          expect((audit?.details as any)?.cleanupAborted).toBe(true);
        } finally {
          block.release();
          block.restore();
          stub.restore();
        }
      },
    );
  });

  it('RL-25: a hold before DICOM B2 expiry prevents the object purge', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid, {
      dicomDeleteAt: new Date(Date.now() - DAY),
    });
    const block = blockRetentionArchiveUpdateMany(app.get(PrismaService), (args) =>
      args?.data?.dicomDeletionStatus === 'DELETING',
    );
    const storage = app.get<BackupStorage>(BACKUP_STORAGE);
    const deleteSpy = jest.spyOn(storage, 'delete');
    const purgeSpy = storage.purgeVersions ? jest.spyOn(storage, 'purgeVersions' as never) : null;
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'true',
      },
      async () => {
        try {
          const expiry = archiveService.processDueBackups();
          await block.reached;
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          block.release();
          await expiry;
          expect(deleteSpy).not.toHaveBeenCalled();
          expect(purgeSpy?.mock.calls ?? []).toHaveLength(0);
          const held = await prisma.retentionArchive.findUniqueOrThrow({
            where: { id: archive.id },
          });
          expect(held.dicomDeletionStatus).toBe('PENDING');
        } finally {
          block.release();
          block.restore();
          deleteSpy.mockRestore();
          purgeSpy?.mockRestore();
        }
      },
    );
  });

  it('RL-26: a hold before metadata B2 expiry prevents every object purge', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid);
    await prisma.retentionArchive.update({
      where: { id: archive.id },
      data: { metadataDeleteAt: new Date(Date.now() - DAY) },
    });
    const block = blockRetentionArchiveUpdateMany(app.get(PrismaService), (args) =>
      args?.data?.metadataDeletionStatus === 'DELETING',
    );
    const storage = app.get<BackupStorage>(BACKUP_STORAGE);
    const deleteSpy = jest.spyOn(storage, 'delete');
    const purgeSpy = storage.purgeVersions ? jest.spyOn(storage, 'purgeVersions' as never) : null;
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'true',
      },
      async () => {
        try {
          const expiry = archiveService.processDueBackups();
          await block.reached;
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          block.release();
          await expiry;
          expect(deleteSpy).not.toHaveBeenCalled();
          expect(purgeSpy?.mock.calls ?? []).toHaveLength(0);
          const held = await prisma.retentionArchive.findUniqueOrThrow({
            where: { id: archive.id },
          });
          expect(held.metadataDeletionStatus).toBe('PENDING');
        } finally {
          block.release();
          block.restore();
          deleteSpy.mockRestore();
          purgeSpy?.mockRestore();
        }
      },
    );
  });

  it('RL-27: concurrent hold application and cleanup worker never deletes', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    await createValidFakeArchive(studyId, studyUid);
    const block = blockRetentionArchiveUpdateMany(app.get(PrismaService), (args) =>
      Boolean(args?.data?.orthancDeleteDispatchedAt),
    );
    const stub = stubOrthancDelete();
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        try {
          const cleanup = archiveService.cleanupOriginalData(studyId);
          await block.reached;
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          block.release();
          expect(await cleanup).toEqual({ deleted: false, reason: 'LEGAL_HOLD' });
          expect(orthancDeleteCallsFor(stub, studyId)).toHaveLength(0);
        } finally {
          block.release();
          block.restore();
          stub.restore();
        }
      },
    );
  });

  it('RL-28: releasing a hold triggers a fresh eligibility recheck', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    await createValidFakeArchive(studyId, studyUid);
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        const stub = stubOrthancDelete();
        try {
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          expect(await archiveService.cleanupOriginalData(studyId)).toEqual({
            deleted: false,
            reason: 'LEGAL_HOLD',
          });
          await retentionService.releaseLegalHold(studyId, adminActor);
          const audit = await prisma.retentionAuditLog.findFirst({
            where: { studyId, action: 'RETENTION_ELIGIBILITY_CHECKED' },
            orderBy: { timestamp: 'desc' },
          });
          expect((audit?.details as any)?.recheckedAfterRelease).toBe(true);
          expect((audit?.details as any)?.eligible).toBe(true);
          expect(await archiveService.cleanupOriginalData(studyId)).toEqual({ deleted: true });
          expect(orthancDeleteCallsFor(stub, studyId)).toHaveLength(1);
        } finally {
          stub.restore();
        }
      },
    );
  });

  it('RL-29: only the restarted cleanup worker deletes after a stale claim', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    const { archive } = await createValidFakeArchive(studyId, studyUid);
    const gate = deferred();
    const reached = deferred();
    let verificationCalls = 0;
    const originalVerify = (archiveService as any).verifyArchiveObjects.bind(archiveService);
    const verifySpy = jest
      .spyOn(archiveService as any, 'verifyArchiveObjects')
      .mockImplementation(async (...args: any[]) => {
        verificationCalls += 1;
        if (verificationCalls === 2) {
          reached.resolve();
          await gate.promise;
        }
        return originalVerify(...args);
      });
    const stub = stubOrthancDelete();
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        try {
          const first = archiveService.cleanupOriginalData(studyId);
          await reached.promise;
          await prisma.retentionArchive.update({
            where: { id: archive.id },
            data: { cleanupClaimUntil: new Date(Date.now() - HOUR) },
          });
          const second = archiveService.cleanupOriginalData(studyId);
          gate.resolve();
          const [firstResult, secondResult] = await Promise.all([first, second]);
          expect(firstResult).toEqual({ deleted: false, reason: 'CLEANUP_CLAIM_LOST' });
          expect(secondResult).toEqual({ deleted: true });
          expect(orthancDeleteCallsFor(stub, studyId)).toHaveLength(1);
        } finally {
          gate.resolve();
          verifySpy.mockRestore();
          stub.restore();
        }
      },
    );
  });

  it('RL-30: duplicate cleanup workers during a hold never delete', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    await createValidFakeArchive(studyId, studyUid);
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        const stub = stubOrthancDelete();
        try {
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          const results = await Promise.all([
            archiveService.cleanupOriginalData(studyId),
            archiveService.cleanupOriginalData(studyId),
          ]);
          expect(results).toEqual([
            { deleted: false, reason: 'LEGAL_HOLD' },
            { deleted: false, reason: 'LEGAL_HOLD' },
          ]);
          expect(orthancDeleteCallsFor(stub, studyId)).toHaveLength(0);
        } finally {
          stub.restore();
        }
      },
    );
  });

  it('RL-31: a hold after the Orthanc delete is dispatched cannot roll it back', async () => {
    const { studyId, studyUid } = await createLifecycleStudy();
    await startForStudy(studyId);
    await createValidFakeArchive(studyId, studyUid);
    const reached = deferred();
    const gate = deferred();
    const stub = stubOrthancDelete(async (orthancStudyId) => {
      if (orthancStudyId !== `orthanc-${studyId}`) return;
      reached.resolve();
      await gate.promise;
    });
    await withEnv(
      {
        RETENTION_DELETE_ENABLED: 'true',
        RETENTION_DRY_RUN: 'false',
        RETENTION_DICOM_ARCHIVE_ENABLED: 'true',
        RETENTION_BACKUP_DELETE_ENABLED: 'false',
      },
      async () => {
        try {
          const cleanup = archiveService.cleanupOriginalData(studyId);
          await reached.promise;
          await retentionService.applyLegalHold(studyId, adminActor, 'LEGAL_HOLD');
          gate.resolve();
          expect(await cleanup).toEqual({ deleted: true });
          expect(orthancDeleteCallsFor(stub, studyId)).toHaveLength(1);
          const audit = await prisma.retentionAuditLog.findFirst({
            where: { studyId, action: 'RETENTION_LOCK_APPLIED' },
            orderBy: { timestamp: 'desc' },
          });
          expect((audit?.details as any)?.deleteInFlight).toBe(true);
          expect((audit?.details as any)?.cleanupBoundaryCrossed).toBe(true);
        } finally {
          gate.resolve();
          stub.restore();
        }
      },
    );
  });

  it('RL-32: immutable ReportVersion snapshots are archived and verified', async () => {
    const { studyId } = await createLifecycleStudy();
    const report = await prisma.report.findFirstOrThrow({ where: { studyId } });
    const version = await prisma.reportVersion.create({
      data: {
        reportId: report.id,
        version: 2,
        status: 'SIGNED',
        findings: 'Archived historical findings',
        impression: 'Archived historical impression',
        authorId: radUser.id,
        contentHash: 'archived-report-version-hash',
        createdAt: new Date(Date.now() - HOUR),
      },
    });
    const study = await prisma.study.findUniqueOrThrow({
      where: { id: studyId },
      include: retentionStudyInclude,
    });
    const artifact = buildArchivedReportArtifact(study, 'report-version-archive', new Date());
    expect(artifact.versionSnapshots).toHaveLength(1);
    expect(artifact.versionSnapshots[0]).toMatchObject({
      id: version.id,
      reportId: report.id,
      version: 2,
      status: 'SIGNED',
      authorId: radUser.id,
      contentHash: 'archived-report-version-hash',
    });
    expect(archivedReportMatchesStudy(artifact, 'report-version-archive', study)).toBe(true);
    expect(
      archivedReportMatchesStudy(
        { ...artifact, versionSnapshots: [] },
        'report-version-archive',
        study,
      ),
    ).toBe(false);
  });
});
