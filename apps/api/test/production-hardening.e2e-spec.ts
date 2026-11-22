import 'reflect-metadata';
import request from 'supertest';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import { resolveBackupEnv } from '../src/backup/backup-ops.js';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';

let app: INestApplication;
let server: any;

const admin = USERS.ADMIN;
const manager = USERS.MANAGER;
const h_cgh = USERS.H_CGH;

const UID = () =>
  `1.2.826.0.1.3680043.8.498.${Date.now()}.${parseInt(randomUUID().replace(/-/g, '').slice(0, 12), 16)}`;

const createdStudyIds: string[] = [];
const createdBackupIds: string[] = [];
const createdReportIds: string[] = [];

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
      imagingAvailability: 'AVAILABLE',
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

  it('P7-HEALTH-3: readiness reports a missing DICOMweb plugin as degraded', async () => {
    const probeResponse = (status: number, body?: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
        body: { cancel: async () => undefined },
      }) as unknown as globalThis.Response;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) return probeResponse(404);
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready');
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'down' });
      expect(res.body.status).toBe('degraded');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('P7-HEALTH-4: readiness reports a missing dicom-web plugin as degraded', async () => {
    const probeResponse = (status: number, body?: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
        body: { cancel: async () => undefined },
      }) as unknown as globalThis.Response;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'explorer.js' }]);
      if (url.includes('/dicom-web/studies')) return probeResponse(200, []);
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready');
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'down' });
      expect(res.body.status).toBe('degraded');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('P7-HEALTH-5: readiness reports an empty archive as degraded', async () => {
    const hospitalAgent = await loginAgent(server, h_cgh);
    const { studyId } = await createStudy(hospitalAgent);
    await prisma.study.update({
      where: { id: studyId },
      data: {
        seriesCount: 1,
        instanceCount: 1,
        imagingAvailability: 'AVAILABLE',
        orthancStudyId: 'orth-study',
        imagingCheckedAt: new Date(),
      },
    });

    const probeResponse = (status: number, body?: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
        body: { cancel: async () => undefined },
      }) as unknown as globalThis.Response;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) return probeResponse(200, []);
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready');
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'down' });
      expect(res.body.status).toBe('degraded');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('P7-HEALTH-6: readiness stays healthy when the indexed study exists in Orthanc', async () => {
    const hospitalAgent = await loginAgent(server, h_cgh);
    const { studyUid, studyId } = await createStudy(hospitalAgent);
    await prisma.study.update({
      where: { id: studyId },
      data: {
        seriesCount: 1,
        instanceCount: 1,
        imagingAvailability: 'AVAILABLE',
        orthancStudyId: 'orth-study',
        imagingCheckedAt: new Date(),
      },
    });

    const probeResponse = (status: number, body?: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
        body: { cancel: async () => undefined },
      }) as unknown as globalThis.Response;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) {
        return probeResponse(200, [{ '0020000D': { Value: [studyUid] } }]);
      }
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready');
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'up' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('P7-HEALTH-7: readiness normalizes StudyInstanceUID whitespace from QIDO', async () => {
    const hospitalAgent = await loginAgent(server, h_cgh);
    const { studyUid, studyId } = await createStudy(hospitalAgent);
    await prisma.study.update({
      where: { id: studyId },
      data: {
        seriesCount: 1,
        instanceCount: 1,
        imagingAvailability: 'AVAILABLE',
        orthancStudyId: 'orth-study',
        imagingCheckedAt: new Date(),
      },
    });

    const probeResponse = (status: number, body?: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
        body: { cancel: async () => undefined },
      }) as unknown as globalThis.Response;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) {
        return probeResponse(200, [{ '0020000D': { Value: [`  ${studyUid}\u0000 `] } }]);
      }
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready').expect(200);
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'up' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('P7-HEALTH-8: archive mismatch keeps HTTP 200 but reports degraded imaging', async () => {
    const hospitalAgent = await loginAgent(server, h_cgh);
    const { studyId } = await createStudy(hospitalAgent);
    await prisma.study.update({
      where: { id: studyId },
      data: {
        seriesCount: 1,
        instanceCount: 1,
        imagingAvailability: 'AVAILABLE',
        orthancStudyId: 'orth-study',
        imagingCheckedAt: new Date(),
      },
    });

    const probeResponse = (status: number, body?: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
        body: { cancel: async () => undefined },
      }) as unknown as globalThis.Response;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) return probeResponse(200, []);
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready').expect(200);
      expect(res.body.status).toBe('degraded');
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'down' });
    } finally {
      fetchSpy.mockRestore();
    }
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
    await mgrAgent
      .post('/api/admin/backups/missing/restore')
      .send({ type: 'DATABASE', confirm: true })
      .expect(403);
  });

  it('P7-AUTH-3: unauthenticated restore is rejected', async () => {
    await request(server)
      .post('/api/admin/backups/missing/restore')
      .send({ type: 'DATABASE', confirm: true })
      .expect(401);
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
  let managerAgent: any;
  let hospitalAgent: any;
  let radiologistAgent: any;
  let adminUser: any;
  let radUser: any;
  const originalRequireBackup = process.env.AXIS_RETENTION_REQUIRE_BACKUP;

  beforeAll(async () => {
    process.env.AXIS_RETENTION_REQUIRE_BACKUP = 'false';
    process.env.AXIS_RETENTION_DAYS = '30';
    adminAgent = await loginAgent(server, admin);
    managerAgent = await loginAgent(server, manager);
    hospitalAgent = await loginAgent(server, h_cgh);
    radiologistAgent = await loginAgent(server, USERS.RAD1);
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

  async function createVerifiedBackup(type: 'DATABASE' | 'FULL', verified = true) {
    const env = resolveBackupEnv();
    const timestamp = new Date();
    const row = await prisma.backupRun.create({
      data: {
        type,
        status: verified ? 'VERIFIED' : 'COMPLETED',
        startedAt: new Date(timestamp.getTime() - 60_000),
        completedAt: timestamp,
        failedAt: null,
        databaseArtifact: 'phase7-db.dump.gz',
        databaseObjectKey: 'phase7/db.dump.gz',
        databaseChecksum: 'a'.repeat(64),
        databaseVerified: true,
        dicomArtifact: type === 'FULL' ? 'phase7-dicom.tar.gz' : null,
        dicomObjectKey: type === 'FULL' ? 'phase7/dicom.tar.gz' : null,
        dicomChecksum: type === 'FULL' ? 'b'.repeat(64) : null,
        dicomVerified: type === 'FULL',
        verifiedAt: verified ? timestamp : null,
        remoteVerifiedAt: verified && env.provider === 'B2' ? timestamp : null,
        storageProvider: env.provider,
        environment: env.environment,
        createdById: adminUser.id,
      },
    });
    createdBackupIds.push(row.id);
    return row;
  }

  it('P7-RET-1: preview returns policy, reviewed counts, eligibility, and skip reasons', async () => {
    const eligible = await createStudy(hospitalAgent);
    const blocked = await createStudy(hospitalAgent);
    await forceCompletedOld(eligible.studyId);
    await forceCompletedOld(blocked.studyId);
    await addActiveCorrection(blocked.studyId);

    const res = await adminAgent.get('/api/admin/retention/preview').expect(200);
    const d = res.body.data;
    expect(d.policy.retentionDays).toBe(30);
    expect(d.policy.requiresVerifiedBackup).toBe(false);
    expect(Array.isArray(d.candidates)).toBe(true);
    expect(d.reviewed).toBeGreaterThanOrEqual(2);
    expect(d.eligibleCount).toBeGreaterThanOrEqual(1);
    expect(d.skipped).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.skippedReasons)).toBe(true);
    expect(d.skippedReasons.some((item: any) => item.reason === 'ACTIVE_CORRECTION')).toBe(true);

    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain('patientName');
    expect(serialized).not.toContain('dateOfBirth');

    const blockedRow = (d.candidates as any[]).find((c) => c.studyId === blocked.studyId);
    expect(blockedRow).toBeTruthy();
    expect(blockedRow.eligible).toBe(false);
    expect(blockedRow.hasActiveCorrection).toBe(true);
    expect(blockedRow.reason).toBe('ACTIVE_CORRECTION');

    const eligibleRow = (d.candidates as any[]).find((c) => c.studyId === eligible.studyId);
    expect(eligibleRow).toBeTruthy();
    expect(eligibleRow.eligible).toBe(true);
    expect(typeof eligibleRow.daysSinceAnchor).toBe('number');
  });

  it('P7-RET-2: dry-run leaves studies unarchived and reports retention-not-elapsed', async () => {
    const old = await createStudy(hospitalAgent);
    const recent = await createStudy(hospitalAgent);
    await forceCompletedOld(old.studyId);
    await prisma.study.update({
      where: { id: recent.studyId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        imagingAvailability: 'AVAILABLE',
      },
    });

    const before = await prisma.study.findUnique({ where: { id: old.studyId } });
    const res = await adminAgent.get('/api/admin/retention/preview').expect(200);
    const after = await prisma.study.findUnique({ where: { id: old.studyId } });
    expect(after?.archivedAt).toEqual(before?.archivedAt);
    expect(after?.archivedAt).toBeNull();

    const recentRow = (res.body.data.candidates as any[]).find(
      (c) => c.studyId === recent.studyId,
    );
    expect(recentRow).toBeTruthy();
    expect(recentRow.eligible).toBe(false);
    expect(recentRow.reason).toBe('RETENTION_NOT_ELAPSED');
  });

  it('P7-RET-3: execute archives eligible studies and records ARCHIVE_MARKED audit', async () => {
    const s = await createStudy(hospitalAgent);
    await forceCompletedOld(s.studyId);

    const res = await adminAgent.post('/api/admin/retention/execute').expect(201);
    const d = res.body.data;
    expect(typeof d.archived).toBe('number');
    expect(d.archived).toBeGreaterThanOrEqual(1);
    expect(typeof d.reviewed).toBe('number');
    expect(Array.isArray(d.skippedReasons)).toBe(true);

    const study = await prisma.study.findUnique({ where: { id: s.studyId } });
    expect(study?.archivedAt).not.toBeNull();

    const audit = await adminAgent
      .get(`/api/audit?resource=STUDY&action=ARCHIVE_MARKED&studyUid=${s.studyUid}`)
      .expect(200);
    expect((audit.body.data as any[]).length).toBeGreaterThan(0);
  });

  it('P7-RET-4: execute is idempotent for already archived studies', async () => {
    const s = await createStudy(hospitalAgent);
    await forceCompletedOld(s.studyId);
    await adminAgent.post('/api/admin/retention/execute').expect(201);
    const first = await prisma.study.findUnique({ where: { id: s.studyId } });
    await adminAgent.post('/api/admin/retention/execute').expect(201);
    const second = await prisma.study.findUnique({ where: { id: s.studyId } });
    expect(first?.archivedAt).not.toBeNull();
    expect(second?.archivedAt).toEqual(first?.archivedAt);
  });

  it('P7-RET-5: only ADMIN and MANAGER may preview/execute archival', async () => {
    await hospitalAgent.get('/api/admin/retention/preview').expect(403);
    await hospitalAgent.post('/api/admin/retention/execute').expect(403);
    await radiologistAgent.get('/api/admin/retention/preview').expect(403);
    await radiologistAgent.post('/api/admin/retention/execute').expect(403);

    await managerAgent.get('/api/admin/retention/preview').expect(200);
    await managerAgent.post('/api/admin/retention/execute').expect(201);
  });

  it('P7-RET-6: manager preview is scoped to the manager hospital', async () => {
    const mmcAgent = await loginAgent(server, USERS.H_MMC);
    const outside = await createStudy(mmcAgent);
    await forceCompletedOld(outside.studyId);

    const managerRes = await managerAgent
      .get('/api/admin/retention/preview')
      .expect(200);
    const adminRes = await adminAgent.get('/api/admin/retention/preview').expect(200);
    expect(
      (managerRes.body.data.candidates as any[]).some((c) => c.studyId === outside.studyId),
    ).toBe(false);
    expect(
      (adminRes.body.data.candidates as any[]).some((c) => c.studyId === outside.studyId),
    ).toBe(true);
  });

  it('P7-RET-7: backup gate rejects unverified/database-only runs and accepts verified FULL', async () => {
    const original = process.env.AXIS_RETENTION_REQUIRE_BACKUP;
    process.env.AXIS_RETENTION_REQUIRE_BACKUP = 'true';
    try {
      const s = await createStudy(hospitalAgent);
      await forceCompletedOld(s.studyId);
      await createVerifiedBackup('FULL', false);
      await createVerifiedBackup('DATABASE');

      let res = await adminAgent.get('/api/admin/retention/preview').expect(200);
      let row = (res.body.data.candidates as any[]).find((c) => c.studyId === s.studyId);
      expect(row).toBeTruthy();
      expect(row.eligible).toBe(false);
      expect(row.reason).toBe('NO_VERIFIED_FULL_BACKUP');
      expect(row.verifiedBackupExists).toBe(false);

      const full = await createVerifiedBackup('FULL');
      res = await adminAgent.get('/api/admin/retention/preview').expect(200);
      row = (res.body.data.candidates as any[]).find((c) => c.studyId === s.studyId);
      expect(row.eligible).toBe(true);
      expect(row.verifiedBackupExists).toBe(true);
      expect(row.verifiedBackupId).toBe(full.id);
    } finally {
      if (original === undefined) delete process.env.AXIS_RETENTION_REQUIRE_BACKUP;
      else process.env.AXIS_RETENTION_REQUIRE_BACKUP = original;
    }
  });
});
