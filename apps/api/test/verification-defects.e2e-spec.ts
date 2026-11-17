import 'reflect-metadata';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma } from './helpers.js';
import { seedE2eTenants, type SeededTenant } from './e2e-tenants.js';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, StudyStatus, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { readdirSync } from 'fs';
import { tmpdir } from 'os';
import { request as httpRequest } from 'node:http';
import { Socket } from 'node:net';

let app: INestApplication;
let server: any;

let cgh: SeededTenant;
let mmc: SeededTenant;

let cghAgent: any;
let mmcAgent: any;
let adminAgent: any;
let managerAgent: any;
let managerHospitalId: string | null = null;
let rad1Id: string;

const tracked: Array<{ id: string; patientId: string }> = [];
const trackedUsers: string[] = [];

const CONTENT_HASH = 'b'.repeat(64);

let uniqueCounter = 0;
function uniq(prefix: string): string {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * A valid DICOM UID. Every component must be digits only (PS3.5), so a UID may
 * not carry a readable suffix like ".REG" or ".CHUNKED"; the test's own
 * uniqueCounter provides the distinguishing part instead.
 */
function uid(suffix: string): string {
  uniqueCounter += 1;
  return `1.2.826.0.1.3680043.9.${suffix}.${Date.now()}.${uniqueCounter}`;
}

async function seedAdmin(): Promise<{ email: string; password: string }> {
  const email = 'e2e-admin@axis.test';
  const password = 'AxisE2EAdmin123!';
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { passwordHash, role: UserRole.ADMIN, status: UserStatus.APPROVED, isActive: true },
    });
  } else {
    await prisma.user.create({
      data: {
        email,
        displayName: 'E2E Administrator',
        role: UserRole.ADMIN,
        status: UserStatus.APPROVED,
        isActive: true,
        passwordHash,
        organization: 'Axis Radiology',
      },
    });
  }
  return { email, password };
}

async function seedManager(hospitalId: string | null): Promise<{ email: string; password: string }> {
  const email = `e2e-manager-${hospitalId ? 'cgh' : 'global'}@axis.test`;
  const password = 'AxisE2EMgr123!';
  const passwordHash = await bcrypt.hash(password, 10);
  const data = {
    displayName: 'E2E Manager',
    role: UserRole.MANAGER,
    status: UserStatus.APPROVED,
    isActive: true,
    passwordHash,
    hospitalId,
    organization: 'Axis Radiology',
  };
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { email }, data });
  } else {
    await prisma.user.create({ data: { email, ...data } });
  }
  return { email, password };
}

async function seedRadiologist(): Promise<{ id: string; email: string; password: string }> {
  const email = 'e2e-rad@axis.test';
  const password = 'AxisE2ERad123!';
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  let id: string;
  if (existing) {
    const updated = await prisma.user.update({
      where: { email },
      data: { passwordHash, role: UserRole.RADIOLOGIST, status: UserStatus.APPROVED, isActive: true },
    });
    id = updated.id;
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        displayName: 'E2E Radiologist',
        role: UserRole.RADIOLOGIST,
        status: UserStatus.APPROVED,
        isActive: true,
        passwordHash,
        subspecialty: 'GENERAL',
        organization: 'Axis Radiology',
      },
    });
    id = created.id;
  }
  return { id, email, password };
}

/**
 * Seeds a study in `status` with an assigned radiologist, plus a signed report
 * (and, for released states, the workflow timestamps those states require).
 */
async function seedStudyWithReport(opts: {
  hospitalId: string;
  status: StudyStatus;
  accessionNumber?: string;
  priority?: 'STAT' | 'URGENT' | 'ROUTINE';
}): Promise<{
  id: string;
  studyInstanceUid: string;
  patientId: string;
  reportId: string;
  accessionNumber: string;
}> {
  const studyInstanceUid = uid('9');
  const accessionNumber = opts.accessionNumber ?? uniq('ACC');
  const patient = await prisma.patient.create({
    data: {
      patientId: uniq('P-REG'),
      displayName: 'Regression Patient',
      hospitalId: opts.hospitalId,
      gender: 'U',
    },
  });

  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber,
      patientId: patient.id,
      hospitalId: opts.hospitalId,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: opts.status,
      priority: opts.priority ?? 'URGENT',
      assignedRadiologistId: rad1Id,
      assignedAt: new Date(),
      reportingStartedAt: new Date(),
      receivedAt: new Date(),
      orthancStudyId: `orth-${studyInstanceUid}`,
      orthancPatientId: `orthp-${studyInstanceUid}`,
    },
  });
  tracked.push({ id: study.id, patientId: patient.id });

  const report = await prisma.report.create({
    data: {
      studyId: study.id,
      authorId: rad1Id,
      status: 'SIGNED',
      version: 1,
      clinicalHistory: 'Regression history',
      findings: 'Regression findings',
      impression: 'Regression impression',
      technique: 'CT chest',
      comparison: 'None',
      recommendations: 'Follow up',
      signedOffBy: rad1Id,
      signedOffAt: new Date(),
      contentHash: CONTENT_HASH,
    },
  });

  const releasedStates: StudyStatus[] = [
    StudyStatus.MANAGER_APPROVED,
    StudyStatus.DELIVERED_TO_HOSPITAL,
    StudyStatus.HOSPITAL_REVIEW,
    StudyStatus.HOSPITAL_ACCEPTED,
    StudyStatus.COMPLETED,
  ];
  if (releasedStates.includes(opts.status)) {
    await prisma.study.update({
      where: { id: study.id },
      data: {
        signedOffAt: new Date(),
        managerReviewedAt: new Date(),
        managerApprovedAt: new Date(),
        ...(opts.status !== StudyStatus.MANAGER_APPROVED ? { deliveredAt: new Date() } : {}),
        ...(opts.status === StudyStatus.HOSPITAL_ACCEPTED || opts.status === StudyStatus.COMPLETED
          ? { hospitalReviewedAt: new Date(), hospitalAcceptedAt: new Date() }
          : {}),
        ...(opts.status === StudyStatus.COMPLETED ? { completedAt: new Date() } : {}),
      },
    });
  } else {
    await prisma.study.update({
      where: { id: study.id },
      data: { signedOffAt: new Date() },
    });
  }

  if (opts.status === StudyStatus.DELIVERED_TO_HOSPITAL) {
    await prisma.deliveryAttempt.create({
      data: {
        studyId: study.id,
        reportId: report.id,
        hospitalId: opts.hospitalId,
        status: 'COMPLETED',
        attemptNumber: 1,
        deliveredAt: new Date(),
      },
    });
  }
  if (opts.status !== StudyStatus.UNASSIGNED) {
    await prisma.worklistItem.upsert({
      where: { studyId: study.id },
      update: {},
      create: { studyId: study.id, assignedAt: new Date() },
    });
  }

  return {
    id: study.id,
    studyInstanceUid,
    patientId: patient.id,
    reportId: report.id,
    accessionNumber,
  };
}

async function cleanupStudy(id: string, patientId: string) {
  await prisma.deliveryAttempt.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.reportVersion.deleteMany({ where: { report: { studyId: id } } }).catch(() => undefined);
  await prisma.report.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.changeRequest.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.instance.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.series.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.worklistItem.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.assignment.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.study.delete({ where: { id } }).catch(() => undefined);
  const remaining = await prisma.study.count({ where: { patientId } }).catch(() => 0);
  if (remaining === 0) {
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
  }
}

async function cleanup() {
  for (const t of [...tracked]) {
    await cleanupStudy(t.id, t.patientId);
  }
  tracked.length = 0;
  for (const userId of trackedUsers) {
    await prisma.auditLog.deleteMany({ where: { actorId: userId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  trackedUsers.length = 0;
}

/** Count of staging directories created by the upload path. */
function uploadStagingDirs(): number {
  try {
    return readdirSync(tmpdir()).filter((n) => n.startsWith('axis-upload-')).length;
  } catch {
    return 0;
  }
}

/**
 * True when the configured Orthanc endpoint accepts a TCP connection. A
 * filesystem probe such as `existsSync('/dev/tcp/...')` cannot detect a socket,
 * so a real connection attempt is made.
 */
function orthancReachable(timeoutMs = 2000): Promise<boolean> {
  const url = process.env.ORTHANC_URL ?? process.env.AXIS_ORTHANC_URL;
  if (typeof url !== 'string' || url.length === 0) return Promise.resolve(false);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(false);
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, parsed.hostname);
  });
}

beforeAll(async () => {
  const tenants = await seedE2eTenants(prisma as unknown as PrismaClient);
  cgh = tenants.cgh;
  mmc = tenants.mmc;

  const admin = await seedAdmin();
  const manager = await seedManager(cgh.hospitalId);
  const rad = await seedRadiologist();
  rad1Id = rad.id;

  const built = await createTestApp();
  app = built.app;
  server = built.server;

  cghAgent = await loginAgent(server, cgh.user);
  mmcAgent = await loginAgent(server, mmc.user);
  adminAgent = await loginAgent(server, admin);
  managerAgent = await loginAgent(server, manager);

  const managerRow = await prisma.user.findUniqueOrThrow({ where: { email: manager.email } });
  managerHospitalId = managerRow.hospitalId;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

// ---------------------------------------------------------------------------
// 1. Manager of Hospital A must not receive Hospital B PHI in the SLA overview
// ---------------------------------------------------------------------------
describe('FIX-1: GET /api/sla/overview is hospital-scoped for a MANAGER', () => {
  it('a manager linked to hospital A sees only hospital A studies and breaches', async () => {
    const mine = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.RADIOLOGIST_SIGNED,
    });
    const theirs = await seedStudyWithReport({
      hospitalId: mmc.hospitalId,
      status: StudyStatus.RADIOLOGIST_SIGNED,
    });

    // Both are past the URGENT threshold with no completedAt, so both are
    // breaches. Only the caller's own hospital may be represented.
    const old = new Date(Date.now() - 1000 * 60 * 60 * 30);
    await prisma.study.update({ where: { id: mine.id }, data: { receivedAt: old, createdAt: old } });
    await prisma.study.update({ where: { id: theirs.id }, data: { receivedAt: old, createdAt: old } });

    const res = await managerAgent.get('/api/sla/overview').expect(200);
    const d = res.body.data;

    expect(d.counts.total).toBeGreaterThanOrEqual(1);
    expect(d.sla.breachCount).toBeGreaterThanOrEqual(1);

    const studyIds = new Set(d.sla.breaches.map((b: any) => b.studyId));
    expect(studyIds.has(mine.id)).toBe(true);
    expect(studyIds.has(theirs.id)).toBe(false);

    // No patient name or hospital name from the other tenant may appear.
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain(theirs.studyInstanceUid);
    expect(serialized).not.toContain(mmc.hospitalId);
  });

  it('a manager without a hospital gets an empty overview, never global data', async () => {
    const mine = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.RADIOLOGIST_SIGNED,
    });
    const globalManager = await seedManager(null);
    const agent = await loginAgent(server, globalManager);

    const res = await agent.get('/api/sla/overview').expect(200);
    const d = res.body.data;

    expect(d.counts.total).toBe(0);
    expect(d.sla.breachCount).toBe(0);
    expect(d.sla.breaches).toEqual([]);
    expect(JSON.stringify(d)).not.toContain(mine.studyInstanceUid);
  });

  it('an admin keeps the global view', async () => {
    const mine = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.RADIOLOGIST_SIGNED,
    });
    // Backdate it past the URGENT threshold so it is certainly a breach.
    const old = new Date(Date.now() - 1000 * 60 * 60 * 30);
    await prisma.study.update({ where: { id: mine.id }, data: { receivedAt: old, createdAt: old } });

    const res = await adminAgent.get('/api/sla/overview').expect(200);
    const ids = res.body.data.sla.breaches.map((b: any) => b.studyId);
    expect(ids).toContain(mine.id);
  });
});

// ---------------------------------------------------------------------------
// 2. validate() must not revert a released report to DRAFT
// ---------------------------------------------------------------------------
describe('FIX-2: POST /api/reports/:studyUid/validate cannot revert to DRAFT', () => {
  it('rejects DRAFT on a manager-approved study and leaves the report untouched (409)', async () => {
    const s = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.MANAGER_APPROVED,
    });

    const res = await managerAgent
      .post(`/api/reports/${s.studyInstanceUid}/validate`)
      .send({ status: 'DRAFT' });

    expect(res.status).toBe(409);

    const report = await prisma.report.findUniqueOrThrow({ where: { id: s.reportId } });
    expect(report.status).toBe('SIGNED');
    expect(report.contentHash).toBe(CONTENT_HASH);

    const study = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(study.status).toBe('MANAGER_APPROVED');
  });

  it('rejects DRAFT on a delivered study', async () => {
    const s = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.DELIVERED_TO_HOSPITAL,
    });
    const res = await managerAgent
      .post(`/api/reports/${s.studyInstanceUid}/validate`)
      .send({ status: 'DRAFT' });
    expect(res.status).toBe(409);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: s.reportId } });
    expect(report.status).toBe('SIGNED');
  });

  it('rejects DRAFT on a completed study', async () => {
    const s = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.COMPLETED,
    });
    const res = await managerAgent
      .post(`/api/reports/${s.studyInstanceUid}/validate`)
      .send({ status: 'DRAFT' });
    expect(res.status).toBe(409);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: s.reportId } });
    expect(report.status).toBe('SIGNED');
  });

  it('still verifies a signed report that has not been released', async () => {
    const s = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.RADIOLOGIST_SIGNED,
    });
    const res = await managerAgent
      .post(`/api/reports/${s.studyInstanceUid}/validate`)
      .send({ status: 'SIGNED' });
    expect([200, 201]).toContain(res.status);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: s.reportId } });
    expect(report.status).toBe('SIGNED');
  });
});

// ---------------------------------------------------------------------------
// 3. Hospital PDF is not readable before delivery
// ---------------------------------------------------------------------------
describe('FIX-3: hospital PDF is unavailable until the report is delivered', () => {
  it('returns 404 for a MANAGER_APPROVED study (not yet delivered)', async () => {
    const s = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.MANAGER_APPROVED,
    });
    const res = await cghAgent.get(`/api/reports/hospital/${s.studyInstanceUid}/pdf`);
    expect(res.status).toBe(404);
  });

  it('returns the PDF once the study is delivered', async () => {
    const s = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.DELIVERED_TO_HOSPITAL,
    });
    const res = await cghAgent.get(`/api/reports/hospital/${s.studyInstanceUid}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('still denies another hospital access (403)', async () => {
    const s = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.COMPLETED,
    });
    const res = await mmcAgent.get(`/api/reports/hospital/${s.studyInstanceUid}/pdf`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 4. DICOM re-ingest preserves workflow state
// ---------------------------------------------------------------------------
describe('FIX-4: re-ingesting a delivered study preserves its workflow state', () => {
  const buildP10 = (studyUid: string, sopUid: string, seriesUid: string): Buffer => {
    const el = (group: number, elem: number, vr: string, value: string): Buffer => {
      const v = Buffer.from(value.length % 2 ? `${value}\u0000` : value, 'latin1');
      const head = Buffer.from([group & 255, (group >> 8) & 255, elem & 255, (elem >> 8) & 255]);
      const vrB = Buffer.from(vr, 'ascii');
      let tail: Buffer;
      if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
        const len = Buffer.alloc(4);
        len.writeUInt32LE(v.length, 0);
        tail = Buffer.concat([vrB, Buffer.alloc(2), len]);
      } else {
        const len = Buffer.alloc(2);
        len.writeUInt16LE(v.length, 0);
        tail = Buffer.concat([vrB, len]);
      }
      return Buffer.concat([head, tail, v]);
    };
    return Buffer.concat([
      Buffer.alloc(128),
      Buffer.from('DICM'),
      el(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'),
      el(0x0002, 0x0003, 'UI', sopUid),
      el(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
      el(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'),
      el(0x0008, 0x0018, 'UI', sopUid),
      el(0x0008, 0x0060, 'CS', 'CT'),
      el(0x0010, 0x0010, 'PN', 'REINGEST^PATIENT'),
      el(0x0010, 0x0020, 'LO', 'REINGEST-PID'),
      el(0x0020, 0x000d, 'UI', studyUid),
      el(0x0020, 0x000e, 'UI', seriesUid),
    ]);
  };

  it('a re-ingest of a DELIVERED study keeps status, assignment, reports and delivery history', async () => {
    // Orthanc is a hard dependency of the ingest path (as it is for the rest of
    // the DICOM suite). Probe it over a real TCP connection so an unreachable
    // PACS is reported as the environment problem it is, instead of being
    // silently skipped or mistaken for a code regression.
    expect(await orthancReachable()).toBe(true);
    const s = await seedStudyWithReport({
      hospitalId: cgh.hospitalId,
      status: StudyStatus.DELIVERED_TO_HOSPITAL,
    });
    const before = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    const worklistBefore = await prisma.worklistItem.findUniqueOrThrow({ where: { studyId: s.id } });
    const deliveryBefore = await prisma.deliveryAttempt.count({ where: { studyId: s.id } });
    const reportBefore = await prisma.report.findUniqueOrThrow({ where: { id: s.reportId } });
    const seriesBefore = await prisma.series.count({ where: { studyId: s.id } });

    const newSop = uid('8');
    const newSeries = uid('7');
    const body = buildP10(s.studyInstanceUid, newSop, newSeries);

    const res = await cghAgent
      .post('/api/dicom/ingest')
      .attach('file', body, { filename: 'reingest.dcm', contentType: 'application/octet-stream' });
    expect(res.status).toBe(201);

    const after = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe(before.status);
    expect(after.status).toBe('DELIVERED_TO_HOSPITAL');
    expect(after.assignedRadiologistId).toBe(before.assignedRadiologistId);
    expect(after.assignedAt).toEqual(before.assignedAt);
    expect(after.signedOffAt).toEqual(before.signedOffAt);
    expect(after.managerApprovedAt).toEqual(before.managerApprovedAt);
    expect(after.deliveredAt).toEqual(before.deliveredAt);
    expect(after.completedAt).toEqual(before.completedAt);
    expect(after.priority).toBe(before.priority);
    expect(after.receivedAt).toEqual(before.receivedAt);
    expect(after.accessionNumber).toBe(before.accessionNumber);

    const worklistAfter = await prisma.worklistItem.findUniqueOrThrow({ where: { studyId: s.id } });
    expect(worklistAfter.assignedAt).toEqual(worklistBefore.assignedAt);

    expect(await prisma.deliveryAttempt.count({ where: { studyId: s.id } })).toBe(deliveryBefore);
    const reportAfter = await prisma.report.findUniqueOrThrow({ where: { id: s.reportId } });
    expect(reportAfter.status).toBe(reportBefore.status);
    expect(reportAfter.contentHash).toBe(reportBefore.contentHash);
    expect(await prisma.report.count({ where: { studyId: s.id } })).toBe(1);

    // The new instance is additive, and the hierarchy totals are recomputed.
    expect(await prisma.instance.count({ where: { studyId: s.id } })).toBeGreaterThan(0);
    expect(after.instanceCount).toBe(await prisma.instance.count({ where: { studyId: s.id } }));
    expect(after.seriesCount).toBe(await prisma.series.count({ where: { studyId: s.id } }));
    expect(after.seriesCount).toBeGreaterThanOrEqual(seriesBefore);
  });
});

// ---------------------------------------------------------------------------
// 5. Accession uniqueness is per hospital
// ---------------------------------------------------------------------------
describe('FIX-5: accession numbers are unique per hospital, not globally', () => {
  it('allows the same accession number in two different hospitals', async () => {
    const shared = uniq('ACC-SHARED');

    const a = await cghAgent
      .post('/api/studies')
      .send({ patientName: 'Acc Shared A', accessionNumber: shared, modality: 'CT' });
    expect([200, 201]).toContain(a.status);
    if (a.body?.data?.id) tracked.push({ id: a.body.data.id, patientId: a.body.data.patientId });

    const b = await mmcAgent
      .post('/api/studies')
      .send({ patientName: 'Acc Shared B', accessionNumber: shared, modality: 'CT' });
    expect([200, 201]).toContain(b.status);
    if (b.body?.data?.id) tracked.push({ id: b.body.data.id, patientId: b.body.data.patientId });

    const rows = await prisma.study.findMany({
      where: { accessionNumber: shared },
      select: { hospitalId: true },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.hospitalId)).size).toBe(2);
  });

  it('rejects a duplicate accession in the same hospital with 409, not 500', async () => {
    const dupe = uniq('ACC-DUPE');
    const first = await cghAgent
      .post('/api/studies')
      .send({ patientName: 'Acc Dupe One', accessionNumber: dupe, modality: 'CT' });
    expect([200, 201]).toContain(first.status);
    if (first.body?.data?.id) {
      tracked.push({ id: first.body.data.id, patientId: first.body.data.patientId });
    }

    const second = await cghAgent
      .post('/api/studies')
      .send({ patientName: 'Acc Dupe Two', accessionNumber: dupe, modality: 'CT' });

    expect(second.status).toBe(409);
    expect(second.body.message).toContain(dupe);
    expect(second.status).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 6. Audit coverage for the user lifecycle and failed logins
// ---------------------------------------------------------------------------
describe('FIX-6: user lifecycle and failed logins are audited', () => {
  const password = 'AxisE2ECreated123!';

  it('records USER_CREATED, USER_UPDATED and USER_DELETED with the acting admin', async () => {
    const email = uniq('created') + '@axis.test';
    const created = await adminAgent.post('/api/users').send({
      displayName: 'Audit Subject',
      email,
      role: 'HOSPITAL',
      password,
      hospitalId: cgh.hospitalId,
    });
    expect([200, 201]).toContain(created.status);
    const userId: string = created.body.data.id;
    trackedUsers.push(userId);

    const createAudit = await prisma.auditLog.findFirst({
      where: { resource: 'USER', resourceId: userId, action: 'USER_CREATED' },
    });
    expect(createAudit).toBeTruthy();
    expect(createAudit?.metadata).toMatchObject({ email });

    const adminRow = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const patched = await adminAgent.patch(`/api/users/${userId}`).send({ displayName: 'Audit Subject 2' });
    expect([200, 201]).toContain(patched.status);

    const updateAudit = await prisma.auditLog.findFirst({
      where: { resource: 'USER', resourceId: userId, action: 'USER_UPDATED' },
      orderBy: { timestamp: 'desc' },
    });
    expect(updateAudit).toBeTruthy();
    expect((updateAudit?.metadata as any)?.changes?.displayName).toEqual({
      from: 'Audit Subject',
      to: 'Audit Subject 2',
    });
    void adminRow;

    const removed = await adminAgent.delete(`/api/users/${userId}`);
    expect([200, 201]).toContain(removed.status);

    const deleteAudit = await prisma.auditLog.findFirst({
      where: { resource: 'USER', resourceId: userId, action: 'USER_DELETED' },
    });
    expect(deleteAudit).toBeTruthy();
    expect(deleteAudit?.metadata).toMatchObject({ email });
    // The trail survives the account removal.
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();

    trackedUsers.splice(trackedUsers.indexOf(userId), 1);
  });

  it('records LOGIN_FAILURE for a wrong password on a known account', async () => {
    const subject = uniq('loginfail') + '@axis.test';
    const created = await adminAgent.post('/api/users').send({
      displayName: 'Login Failure Subject',
      email: subject,
      role: 'HOSPITAL',
      password,
      hospitalId: cgh.hospitalId,
    });
    expect([200, 201]).toContain(created.status);
    const userId: string = created.body.data.id;
    trackedUsers.push(userId);

    const failed = await adminAgent.post('/api/auth/login').send({
      email: subject,
      password: 'WrongPassword123!',
    });
    expect([401, 403]).toContain(failed.status);

    const row = await prisma.auditLog.findFirst({
      where: { resource: 'AUTH', resourceId: userId, action: 'LOGIN_FAILURE' },
    });
    expect(row).toBeTruthy();
    expect(row?.actorId).toBe(userId);
    expect(row?.metadata).toMatchObject({ reason: 'INVALID_PASSWORD' });
    expect(row?.correlationId).toBeTruthy();
    expect(row?.timestamp).toBeInstanceOf(Date);
  });

  it('still returns the same 401 for an unknown email and does not create an account', async () => {
    const unknown = uniq('nobody') + '@axis.test';
    const res = await adminAgent.post('/api/auth/login').send({
      email: unknown,
      password: 'WrongPassword123!',
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
    expect(await prisma.user.findUnique({ where: { email: unknown } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Truncated Part-10 files are a 4xx, never a 500
// ---------------------------------------------------------------------------
describe('FIX-7: a truncated DICOM Part-10 header is rejected as a client error', () => {
  it.each([133, 136, 138, 140])(
    'a %i-byte Part-10 file returns 400 rather than 500',
    async (size) => {
      const buf = Buffer.alloc(size, 0);
      buf.write('DICM', 128, 'latin1');
      const res = await cghAgent
        .post('/api/dicom/ingest')
        .attach('file', buf, { filename: 'truncated.dcm', contentType: 'application/octet-stream' });
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
    },
  );

  it('a truncated file with a long-VR element header returns 400', async () => {
    // 132 preamble+DICM plus a partial 0x0002,0x0001 OB element: the 8-byte
    // short-form check passes but the 12-byte long form does not.
    const buf = Buffer.alloc(140, 0);
    buf.write('DICM', 128, 'latin1');
    buf.writeUInt16LE(0x0002, 132);
    buf.writeUInt16LE(0x0001, 134);
    buf.write('OB', 136, 'latin1');
    const res = await cghAgent
      .post('/api/dicom/ingest')
      .attach('file', buf, { filename: 'truncated-ob.dcm', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 8. The aggregate upload cap is enforced on received bytes (chunked included)
// ---------------------------------------------------------------------------
describe('FIX-8: a chunked upload cannot bypass the aggregate size cap', () => {
  /**
   * superagent always computes a Content-Length, so a genuine
   * `Transfer-Encoding: chunked` request has to be written by hand. The app is
   * bound to an ephemeral port and the body is written in chunks, which is
   * exactly what a streaming client (or an attacker) would send.
   */
  let baseUrl: string;
  let cookie: string;

  beforeAll(async () => {
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const loginRes = await new Promise<{ status: number; headers: any }>((resolve, reject) => {
      const payload = JSON.stringify(cgh.user);
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/api/auth/login',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, headers: res.headers });
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
    expect(loginRes.status).toBeLessThan(300);
    const setCookie = loginRes.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    cookie = String(raw ?? '').split(';')[0];
    expect(cookie).toContain('=');
  });

  afterAll(async () => {
    await app.close();
  });

  function chunkedUpload(
    boundary: string,
    filename: string,
    payload: Buffer,
  ): Promise<{ status: number; headers: any }> {
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      'latin1',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1');

    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: Number(new URL(baseUrl).port),
          path: '/api/dicom/ingest',
          method: 'POST',
          // No content-length: Node emits Transfer-Encoding: chunked.
          headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'transfer-encoding': 'chunked',
            cookie,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
        },
      );
      req.on('error', (err) => {
        // A torn-down connection after the server has already answered is fine.
        if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
          resolve({ status: 0, headers: {} });
          return;
        }
        reject(err);
      });

      const CHUNK = 64 * 1024;
      const writeAll = (buf: Buffer, offset: number) => {
        if (offset >= buf.length) {
          req.end();
          return;
        }
        const end = Math.min(offset + CHUNK, buf.length);
        const more = req.write(buf.subarray(offset, end));
        if (more) setImmediate(() => writeAll(buf, end));
        else req.once('drain', () => writeAll(buf, end));
      };
      writeAll(Buffer.concat([head, payload, tail]), 0);
    });
  }

  it('rejects a chunked request with no Content-Length that exceeds the cap (413)', async () => {
    const res = await chunkedUpload(
      '----axisChunkedOne',
      'chunked-big.dcm',
      Buffer.alloc(2 * 1024 * 1024, 0x41),
    );
    expect(res.status).toBe(413);
  });

  it('cleans up the upload staging directory when the cap is exceeded', async () => {
    const before = uploadStagingDirs();
    const res = await chunkedUpload(
      '----axisChunkedTwo',
      'chunked-big2.dcm',
      Buffer.alloc(2 * 1024 * 1024, 0x42),
    );
    expect(res.status).toBe(413);

    // Give the request 'close' sweeper a moment to remove the staging dir.
    await new Promise((r) => setTimeout(r, 300));
    expect(uploadStagingDirs()).toBeLessThanOrEqual(before);
  });

  it('still rejects an oversized request that declares its Content-Length (413)', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 0x43);
    const res = await cghAgent
      .post('/api/dicom/ingest')
      .attach('file', big, { filename: 'big3.zip', contentType: 'application/octet-stream' });
    expect(res.status).toBe(413);
  });

  it('accepts a chunked request that stays under the cap', async () => {
    // A small, valid Part-10 instance streamed without a Content-Length must
    // still be ingested: the counter must not reject merely for being chunked.
    const res = await chunkedUpload(
      '----axisChunkedSmall',
      'chunked-small.dcm',
      smallP10(),
    );
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 9. The DICOM suite is self-seeding
// ---------------------------------------------------------------------------
describe('FIX-9: DICOM suite fixtures are self-seeding', () => {
  it('the seeded hospital user can authenticate without the developer seed', async () => {
    const res = await cghAgent.post('/api/auth/login').send(cgh.user);
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.hospitalId).toBe(cgh.hospitalId);
  });

  it('the ingest path returns 201 for a valid Part-10 instance from the seeded tenant', async () => {
    const studyUid = uid('6');
    const sopUid = uid('5');
    const seriesUid = uid('4');
    const el = (group: number, elem: number, vr: string, value: string): Buffer => {
      const v = Buffer.from(value.length % 2 ? `${value}\u0000` : value, 'latin1');
      const head = Buffer.from([group & 255, (group >> 8) & 255, elem & 255, (elem >> 8) & 255]);
      const vrB = Buffer.from(vr, 'ascii');
      const len = Buffer.alloc(2);
      len.writeUInt16LE(v.length, 0);
      return Buffer.concat([head, vrB, len, v]);
    };
    const p10 = Buffer.concat([
      Buffer.alloc(128),
      Buffer.from('DICM'),
      el(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'),
      el(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
      el(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'),
      el(0x0008, 0x0018, 'UI', sopUid),
      el(0x0008, 0x0060, 'CS', 'CT'),
      el(0x0010, 0x0010, 'PN', 'SELFSHED^PATIENT'),
      el(0x0010, 0x0020, 'LO', 'SELFSHED-PID'),
      el(0x0020, 0x000d, 'UI', studyUid),
      el(0x0020, 0x000e, 'UI', seriesUid),
    ]);

    const res = await cghAgent
      .post('/api/dicom/ingest')
      .attach('file', p10, { filename: 'selfseed.dcm', contentType: 'application/octet-stream' });

    expect(res.status).toBe(201);
    expect(res.body.data.study.hospitalId).toBe(cgh.hospitalId);
  });
});

/** A minimal, valid Part-10 instance for the chunked-accept path. */
function smallP10(studyUid = uid('3')): Buffer {
  const el = (group: number, elem: number, vr: string, value: string): Buffer => {
    const v = Buffer.from(value.length % 2 ? `${value}\u0000` : value, 'latin1');
    const head = Buffer.from([group & 255, (group >> 8) & 255, elem & 255, (elem >> 8) & 255]);
    const vrB = Buffer.from(vr, 'ascii');
    const len = Buffer.alloc(2);
    len.writeUInt16LE(v.length, 0);
    return Buffer.concat([head, vrB, len, v]);
  };
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM'),
    el(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'),
    el(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
    el(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'),
    el(0x0008, 0x0018, 'UI', `${studyUid}.1`),
    el(0x0008, 0x0060, 'CS', 'CT'),
    el(0x0010, 0x0010, 'PN', 'CHUNKED^PATIENT'),
    el(0x0010, 0x0020, 'LO', 'CHUNKED-PID'),
    el(0x0020, 0x000d, 'UI', studyUid),
    el(0x0020, 0x000e, 'UI', `${studyUid}.2`),
  ]);
}

void managerHospitalId;
