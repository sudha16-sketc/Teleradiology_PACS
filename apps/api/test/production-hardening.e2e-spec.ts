import 'reflect-metadata';
import request from 'supertest';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';

let app: INestApplication;
let server: any;

const admin = USERS.ADMIN;
const manager = USERS.MANAGER;
const h_cgh = USERS.H_CGH;

const UID = () =>
  `1.2.826.0.1.3680043.8.498.ph7.${Date.now()}.${randomUUID().replace(/-/g, '').slice(0, 12)}`;

let createdStudyIds: string[] = [];
let createdBackupIds: string[] = [];
let createdReportIds: string[] = [];

async function createStudy(agent: any): Promise<{ studyUid: string; studyId: string }> {
  const studyUid = UID();
  const res = await agent.post('/api/studies').send({
    patientName: 'Phase7 Patient',
    patientId: `P7-${randomUUID().slice(0, 8)}`,
    studyInstanceUid: studyUid,
    modality: 'CT',
    bodyPart: 'CHEST',
    studyDescription: 'Phase 7 e2e fixture',
  });
  if (res.status !== 201) {
    throw new Error(`createStudy failed ${res.status}: ${res.text}`);
  }
  const studyId = res.body.data.id;
  createdStudyIds.push(studyId);
  return { studyUid, studyId };
}

async function forceCompletedOld(studyId: string): Promise<void> {
  await prisma.study.update({
    where: { id: studyId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    },
  });
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
});

afterAll(async () => {
  for (const studyId of createdStudyIds) {
    const reports = await prisma.report.findMany({ where: { studyId }, select: { id: true } });
    const reportIds = reports.map((r) => r.id);
    if (reportIds.length) {
      await prisma.reportVersion.deleteMany({ where: { reportId: { in: reportIds } } });
      await prisma.changeRequest.deleteMany({
        where: { OR: [{ reportId: { in: reportIds } }, { studyId }] },
      });
    }
    await prisma.deliveryAttempt.deleteMany({
      where: { OR: [{ studyId }, { reportId: { in: reportIds } }] },
    });
    await prisma.worklistItem.deleteMany({ where: { studyId } });
    await prisma.assignment.deleteMany({ where: { studyId } });
    await prisma.report.deleteMany({ where: { studyId } });
    await prisma.study.delete({ where: { id: studyId } }).catch(() => undefined);
  }
  for (const id of createdBackupIds) {
    await prisma.backupRun.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
  await app.close();
});

describe('Phase 7 -- health & unauthenticated access', () => {
  it('P7-HEALTH-1: /health/live is public and returns ok', async () => {
    const res = await request(server).get('/api/health/live').expect(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('P7-HEALTH-2: /health/ready is public (no redirect to login)', async () => {
    const res = await request(server).get('/api/health/ready');
    expect([200, 503]).toContain(res.status);
    expect(Array.isArray(res.body.components)).toBe(true);
  });

  it('P7-AUTH-1: unauthenticated access to admin endpoints returns 401', async () => {
    await request(server).get('/api/sla/overview').expect(401);
    await request(server).get('/api/audit').expect(401);
    await request(server).get('/api/admin/backups').expect(401);
    await request(server).get('/api/admin/retention/preview').expect(401);
  });

  it('P7-AUTH-2: role guard blocks MANAGER from POST /sla/config and /admin/backups', async () => {
    const mgrAgent = await loginAgent(server, manager);
    await mgrAgent
      .post('/api/sla/config')
      .send({ priority: 'ROUTINE', minutes: 100 })
      .expect(403);
    await mgrAgent.post('/api/admin/backups').send({ type: 'DATABASE' }).expect(403);
  });
});

describe('Phase 7 -- audit server-side filters', () => {
  let adminAgent: any;
  let adminUser: any;

  beforeAll(async () => {
    adminAgent = await loginAgent(server, admin);
    adminUser = await prisma.user.findUnique({ where: { email: admin.email } });
  });

  it('P7-AUDIT-1: returns a paginated envelope with meta.total', async () => {
    const res = await adminAgent.get('/api/audit').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(typeof res.body.meta.total).toBe('number');
    expect(typeof res.body.meta.totalPages).toBe('number');
    expect(res.body.meta.pageSize).toBe(50);
  });

  it('P7-AUDIT-2: filters by action/resource and respects pageSize cap', async () => {
    const res = await adminAgent
      .get('/api/audit?action=LOGIN&resource=AUTH&pageSize=5')
      .expect(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    for (const row of res.body.data) {
      expect(row.action).toBe('LOGIN');
      expect(row.resource).toBe('AUTH');
    }
  });

  it('P7-AUDIT-3: audit rows persist a correlationId from request context', async () => {
    const res = await adminAgent
      .get(`/api/audit?actorId=${adminUser.id}&action=LOGIN&pageSize=1`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(row.correlationId).toBeTruthy();
      expect(row.actorId).toBe(adminUser.id);
    }
  });
});

describe('Phase 7 -- SLA configuration & overview', () => {
  let adminAgent: any;
  let mgrAgent: any;

  beforeAll(async () => {
    adminAgent = await loginAgent(server, admin);
    mgrAgent = await loginAgent(server, manager);
  });

  it('P7-SLA-1: admin persists an SLA threshold for URGENT', async () => {
    const res = await adminAgent
      .post('/api/sla/config')
      .send({ priority: 'URGENT', minutes: 300 })
      .expect(201);
    expect(res.body.data.priority).toBe('URGENT');
    expect(res.body.data.minutes).toBe(300);
    expect(res.body.data.isActive).toBe(true);
  });

  it('P7-SLA-2: overview computes server-side counts, TAT, and SLA breaches', async () => {
    const res = await mgrAgent.get('/api/sla/overview').expect(200);
    const d = res.body.data;
    expect(typeof d.counts.total).toBe('number');
    expect(typeof d.tat.averageReportingMinutes).toBe('number');
    expect(typeof d.tat.averageTotalMinutes).toBe('number');
    expect(typeof d.sla.breachCount).toBe('number');
    expect(typeof d.sla.totalTracked).toBe('number');
    expect(Array.isArray(d.sla.breaches)).toBe(true);
  });

  it('P7-SLA-3: negative/zero minutes are rejected', async () => {
    await adminAgent
      .post('/api/sla/config')
      .send({ priority: 'ROUTINE', minutes: 0 })
      .expect(400);
  });
});

describe('Phase 7 -- backups (CI-safe: no podman dependency)', () => {
  let adminAgent: any;
  let adminUser: any;

  beforeAll(async () => {
    adminAgent = await loginAgent(server, admin);
    adminUser = await prisma.user.findUnique({ where: { email: admin.email } });
  });

  it('P7-BACKUP-1: list serializes BigInt sizeBytes as a JSON-safe string', async () => {
    const row = await prisma.backupRun.create({
      data: {
        type: 'DATABASE',
        status: 'COMPLETED',
        backupDirectory: 'test',
        createdById: adminUser.id,
        startedAt: new Date(),
        completedAt: new Date(),
        sizeBytes: BigInt(123456),
      },
    });
    createdBackupIds.push(row.id);

    const res = await adminAgent.get('/api/admin/backups').expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('BigInt');
    const found = (res.body.data as any[]).find((b) => b.id === row.id);
    expect(found).toBeTruthy();
    expect(found.sizeBytes).toBe('123456');
  });

  it('P7-BACKUP-2: verify on an artifact-less completed run resolves to a FAILED/VERIFIED status without a BigInt error', async () => {
    const row = await prisma.backupRun.create({
      data: {
        type: 'DATABASE',
        status: 'COMPLETED',
        backupDirectory: 'test',
        createdById: adminUser.id,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    createdBackupIds.push(row.id);

    const res = await adminAgent.post(`/api/admin/backups/${row.id}/verify`).expect(201);
    expect(['VERIFIED', 'FAILED']).toContain(res.body.data.status);
    expect(typeof res.body.data.detail).toBe('string');

    const audit = await adminAgent
      .get(`/api/audit?resource=BACKUP&action=BACKUP_VERIFIED&actorId=${adminUser.id}`)
      .expect(200);
    expect((audit.body.data as any[]).length).toBeGreaterThan(0);
  });

  it('P7-BACKUP-3: run endpoint returns a backup record regardless of podman availability', async () => {
    const res = await adminAgent
      .post('/api/admin/backups')
      .send({ type: 'DATABASE' })
      .expect(201);
    expect(res.body.data.id).toBeTruthy();
    expect(['RUNNING', 'COMPLETED', 'FAILED']).toContain(res.body.data.status);
    createdBackupIds.push(res.body.data.id);
  });
});

describe('Phase 7 -- retention/archival', () => {
  let adminAgent: any;
  let adminUser: any;
  let radUser: any;
  const originalRequireBackup = process.env.AXIS_RETENTION_REQUIRE_BACKUP;

  beforeAll(async () => {
    process.env.AXIS_RETENTION_REQUIRE_BACKUP = 'false';
    process.env.AXIS_RETENTION_DAYS = '30';
    adminAgent = await loginAgent(server, admin);
    adminUser = await prisma.user.findUnique({ where: { email: admin.email } });
    radUser = await prisma.user.findUnique({ where: { email: USERS.RAD1.email } });
  });

  afterAll(() => {
    if (originalRequireBackup === undefined) {
      delete process.env.AXIS_RETENTION_REQUIRE_BACKUP;
    } else {
      process.env.AXIS_RETENTION_REQUIRE_BACKUP = originalRequireBackup;
    }
    delete process.env.AXIS_RETENTION_DAYS;
  });

  async function addActiveCorrection(studyId: string): Promise<void> {
    const report = await prisma.report.create({
      data: {
        studyId,
        authorId: radUser.id,
        status: 'DRAFT',
        contentHash: 'ph7-test',
      },
    });
    createdReportIds.push(report.id);
    await prisma.changeRequest.create({
      data: {
        studyId,
        reportId: report.id,
        requestedById: adminUser.id,
        requestedByRole: 'ADMIN',
        assignedToId: radUser.id,
        reason: 'phase 7 active correction block',
        status: 'OPEN',
      },
    });
  }

  it('P7-RET-1: preview returns policy and eligibility data, excluding active corrections', async () => {
    const cghAgent = await loginAgent(server, h_cgh);
    const eligible = await createStudy(cghAgent);
    const blocked = await createStudy(cghAgent);
    await forceCompletedOld(eligible.studyId);
    await forceCompletedOld(blocked.studyId);
    await addActiveCorrection(blocked.studyId);

    const res = await adminAgent.get('/api/admin/retention/preview').expect(200);
    const d = res.body.data;
    expect(d.policy.retentionDays).toBe(30);
    expect(d.policy.requiresVerifiedBackup).toBe(false);
    expect(Array.isArray(d.candidates)).toBe(true);

    const blockedRow = (d.candidates as any[]).find((c) => c.studyId === blocked.studyId);
    expect(blockedRow).toBeTruthy();
    expect(blockedRow.eligible).toBe(false);
    expect(blockedRow.hasActiveCorrection).toBe(true);

    const eligibleRow = (d.candidates as any[]).find((c) => c.studyId === eligible.studyId);
    expect(eligibleRow).toBeTruthy();
    expect(eligibleRow.eligible).toBe(true);
  });

  it('P7-RET-2: execute archives eligible studies and records ARCHIVE_MARKED audit', async () => {
    const cghAgent = await loginAgent(server, h_cgh);
    const s = await createStudy(cghAgent);
    await forceCompletedOld(s.studyId);

    const res = await adminAgent.post('/api/admin/retention/execute').expect(201);
    const d = res.body.data;
    expect(typeof d.archived).toBe('number');

    const study = await prisma.study.findUnique({ where: { id: s.studyId } });
    expect(study?.archivedAt).not.toBeNull();

    const audit = await adminAgent
      .get(`/api/audit?resource=STUDY&action=ARCHIVE_MARKED&studyUid=${s.studyUid}`)
      .expect(200);
    expect((audit.body.data as any[]).length).toBeGreaterThan(0);
  });
});
