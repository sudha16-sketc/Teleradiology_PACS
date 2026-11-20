import 'reflect-metadata';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { RetentionJobType, UserRole } from '@prisma/client';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';
import type { RetentionActor } from '../src/retention/retention-audit.service.js';
import { RetentionArchiveService } from '../src/retention/retention-archive.service.js';
import { RetentionNotificationService } from '../src/retention/retention-notification.service.js';
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

let app: INestApplication;
let server: any;
let retentionService: RetentionService;
let notificationService: RetentionNotificationService;
let archiveService: RetentionArchiveService;
let adminAgent: any;
let adminActor: RetentionActor;
let hospitalAgent: any;
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

  adminAgent = await loginAgent(server, USERS.ADMIN);
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
      'COMPLETED',
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
    expect(archive.dicomDeleteAt).toBeTruthy();
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
});
