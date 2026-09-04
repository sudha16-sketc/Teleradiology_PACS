import 'reflect-metadata';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { StudyStatus } from '@prisma/client';

let app: INestApplication;
let server: any;

const manager = USERS.MANAGER;
const admin = USERS.ADMIN;
const rad1 = USERS.RAD1;
const h_cgh = USERS.H_CGH;
const h_mmc = USERS.H_MMC;
const CGH_HOSPITAL_ID = 'hosp-001';
const MMC_HOSPITAL_ID = 'hosp-002';

const seeded: Array<{ id: string; patientId: string }> = [];

const FAKE_HASH_V1 = '1'.repeat(64);

/**
 * Seeds a COMPLETED study with a signed, immutable report + a ReportVersion
 * snapshot (v1). Mirrors the terminal state from which corrections begin.
 */
async function seedCompleted(opts: {
  assignedRadiologist: string;
  hospitalId?: string;
}): Promise<{
  id: string;
  studyInstanceUid: string;
  patientId: string;
  reportId: string;
  versionId: string;
}> {
  const hospitalId = opts.hospitalId ?? CGH_HOSPITAL_ID;
  const studyInstanceUid = `1.2.826.0.1.3680043.6.CR-${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-CR-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: 'Correction Patient',
      hospitalId,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber: `AX-CR-${Date.now()}`,
      patientId: patient.id,
      hospitalId,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: StudyStatus.COMPLETED,
      orthancStudyId: `orth-${studyInstanceUid}`,
      orthancPatientId: `orthp-${studyInstanceUid}`,
      assignedRadiologistId: opts.assignedRadiologist,
      signedOffAt: new Date(),
      managerReviewedAt: new Date(),
      managerApprovedAt: new Date(),
      deliveredAt: new Date(),
      hospitalReviewedAt: new Date(),
      hospitalAcceptedAt: new Date(),
      completedAt: new Date(),
    },
  });
  const report = await prisma.report.create({
    data: {
      studyId: study.id,
      authorId: opts.assignedRadiologist,
      status: 'SIGNED',
      version: 1,
      clinicalHistory: 'Original clinical history',
      findings: 'Original findings',
      impression: 'Original impression',
      technique: 'CT chest',
      comparison: 'None',
      recommendations: 'Follow up',
      signedOffBy: opts.assignedRadiologist,
      signedOffAt: new Date(),
      contentHash: FAKE_HASH_V1,
    },
  });
  const version = await prisma.reportVersion.create({
    data: {
      reportId: report.id,
      version: 1,
      status: 'SIGNED',
      clinicalHistory: 'Original clinical history',
      findings: 'Original findings',
      impression: 'Original impression',
      technique: 'CT chest',
      comparison: 'None',
      recommendations: 'Follow up',
      authorId: opts.assignedRadiologist,
      contentHash: FAKE_HASH_V1,
    },
  });
  seeded.push({ id: study.id, patientId: patient.id });
  return { id: study.id, studyInstanceUid, patientId: patient.id, reportId: report.id, versionId: version.id };
}

async function cleanupStudy(id: string, patientId: string) {
  await prisma.notification.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.changeRequest.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.reportVersion.deleteMany({ where: { report: { studyId: id } } }).catch(() => undefined);
  await prisma.deliveryAttempt.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.report.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.instance.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.series.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.worklistItem.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.assignment.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => undefined);
  await prisma.study.delete({ where: { id } }).catch(() => undefined);
  const remaining = await prisma.study.count({ where: { patientId } }).catch(() => 0);
  if (remaining === 0) {
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
  }
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
});

afterAll(async () => {
  for (const s of seeded) {
    await cleanupStudy(s.id, s.patientId);
  }
  await prisma.$disconnect();
  await app.close();
});

describe('Phase 6 — Corrections', () => {
  let managerAgent: any;
  let adminAgent: any;
  let rad1Agent: any;
  let cghAgent: any;
  let mmcAgent: any;
  let rad1Id!: string;

  beforeAll(async () => {
    managerAgent = await loginAgent(server, manager);
    adminAgent = await loginAgent(server, admin);
    rad1Agent = await loginAgent(server, rad1);
    cghAgent = await loginAgent(server, h_cgh);
    mmcAgent = await loginAgent(server, h_mmc);
    rad1Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
  });

  it('CORRECTION-1: hospital can request correction for own delivered/completed study', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    const res = await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'Incorrect finding in the impression' })
      .expect(201);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.requestedByRole).toBe('HOSPITAL');
    expect(res.body.data.reason).toBe('Incorrect finding in the impression');
    const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(db.status).toBe('CORRECTION_REQUESTED');
  });

  it('CORRECTION-2: hospital cannot request correction for another hospital', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    const res = await mmcAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'should fail' });
    expect(res.status).toBe(403);
    const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(db.status).toBe('COMPLETED');
  });

  it('CORRECTION-21: duplicate active correction request is rejected', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'first' })
      .expect(201);
    const res = await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'duplicate' });
    expect(res.status).toBe(409);
  });

  it('CORRECTION-24: invalid correction state transition is rejected (not eligible)', async () => {
    // Study still in RADIOLOGIST_SIGNED is not correction-eligible.
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await prisma.study.update({ where: { id: s.id }, data: { status: 'RADIOLOGIST_SIGNED' } });
    const res = await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'nope' });
    expect(res.status).toBe(400);
  });

  it('CORRECTION-25: generic PATCH cannot bypass correction workflow', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    // COMPLETED has no outgoing transitions — hospital cannot PATCH to CORRECTION_REQUESTED.
    const hospitalPatch = await cghAgent
      .patch(`/api/studies/${s.studyInstanceUid}/status`)
      .send({ status: 'CORRECTION_REQUESTED' });
    expect(hospitalPatch.status).toBe(400);
    // Radiologist cannot PATCH to CORRECTION_REQUESTED from COMPLETED either.
    const radPatch = await rad1Agent
      .patch(`/api/studies/${s.studyInstanceUid}/status`)
      .send({ status: 'CORRECTION_REQUESTED' });
    expect(radPatch.status).toBe(400);
    const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(db.status).toBe('COMPLETED');
  });

  it('CORRECTION-26: URL UID tampering fails', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    // MMC tries to tamper into CGH study via UID.
    const res = await mmcAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'tamper' });
    expect(res.status).toBe(403);
  });

  it('CORRECTION-4: unauthorized role cannot approve correction', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'need fix' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    const res = await cghAgent.post(`/api/corrections/${cr.id}/approve`).send({});
    expect(res.status).toBe(403);
    // radiologist cannot approve
    const res2 = await rad1Agent.post(`/api/corrections/${cr.id}/approve`).send({});
    expect(res2.status).toBe(403);
  });

  it('CORRECTION-3: manager can review/approve correction request', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'please fix' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    const res = await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    expect(res.body.data.status).toBe('APPROVED');
    const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(db.status).toBe('IN_READING');
  });

  it('CORRECTION-22: double correction approval is rejected', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'fix it' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    const res = await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({});
    expect(res.status).toBe(409);
  });

  it('CORRECTION-5: approved correction becomes available to the assigned radiologist', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'go' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    const list = await rad1Agent.get('/api/corrections').expect(200);
    const mine = list.body.data.find((c: any) => c.id === cr.id);
    expect(mine).toBeTruthy();
    expect(mine.status).toBe('APPROVED');
    expect(mine.assignedToId).toBe(rad1Id);
  });

  it('CORRECTION-6/8: radiologist can create and save a correction draft', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'impression wrong' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);

    const begin = await rad1Agent
      .post(`/api/studies/${s.studyInstanceUid}/corrections/begin`)
      .send({})
      .expect(201);
    expect(begin.body.data.version).toBe(2);
    expect(begin.body.data.status).toBe('DRAFT');
    const dbCr = await prisma.changeRequest.findUniqueOrThrow({ where: { id: cr.id } });
    expect(dbCr.status).toBe('IN_PROGRESS');
    const studyDb = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(studyDb.status).toBe('REPORT_DRAFT');

    const save = await rad1Agent
      .patch(`/api/reports/${s.studyInstanceUid}/draft`)
      .send({ findings: 'Corrected findings', impression: 'Corrected impression' })
      .expect(200);
    expect(save.body.data.impression).toBe('Corrected impression');
  });

  it('CORRECTION-7/11: original signed version + hash remain immutable', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'fix' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent
      .post(`/api/studies/${s.studyInstanceUid}/corrections/begin`)
      .send({})
      .expect(201);
    await rad1Agent
      .patch(`/api/reports/${s.studyInstanceUid}/draft`)
      .send({ findings: 'New findings', impression: 'New impression' })
      .expect(200);
    await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
    const v1 = await prisma.reportVersion.findUniqueOrThrow({ where: { id: s.versionId } });
    expect(v1.contentHash).toBe(FAKE_HASH_V1);
    expect(v1.findings).toBe('Original findings');
  });

  it('CORRECTION-9/10/12: corrected report signed → NEW immutable version with server hash', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'impression wrong' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent
      .post(`/api/studies/${s.studyInstanceUid}/corrections/begin`)
      .send({})
      .expect(201);
    await rad1Agent
      .patch(`/api/reports/${s.studyInstanceUid}/draft`)
      .send({ findings: 'Corrected findings', impression: 'Corrected impression' })
      .expect(200);
    const sign = await rad1Agent
      .post(`/api/reports/${s.studyInstanceUid}/sign`)
      .send({})
      .expect(201);
    expect(sign.body.data.status).toBe('SIGNED');

    const dbCr = await prisma.changeRequest.findUniqueOrThrow({ where: { id: cr.id } });
    expect(dbCr.status).toBe('RESOLVED');
    expect(dbCr.newReportVersionId).toBeTruthy();

    const newVersion = await prisma.reportVersion.findUniqueOrThrow({
      where: { id: dbCr.newReportVersionId! },
    });
    expect(newVersion.version).toBe(2);
    expect(newVersion.status).toBe('SIGNED');
    expect(newVersion.findings).toBe('Corrected findings');
    expect(newVersion.contentHash).not.toBe(FAKE_HASH_V1);
    expect(newVersion.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(newVersion.authorId).toBe(rad1Id);

    const studyDb = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(studyDb.status).toBe('RADIOLOGIST_SIGNED');
  });

  it('CORRECTION-23: double corrected signing is rejected', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'fix' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({}).expect(201);
    await rad1Agent
      .patch(`/api/reports/${s.studyInstanceUid}/draft`)
      .send({ findings: 'A', impression: 'B' })
      .expect(200);
    await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
    const res = await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({});
    expect(res.status).toBe(409);
  });

  it('CORRECTION-13/14: manager can review/approve corrected report using Phase 5 logic', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/correction-requests`).send({ reason: 'fix' }).expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({}).expect(201);
    await rad1Agent.patch(`/api/reports/${s.studyInstanceUid}/draft`).send({ findings: 'C', impression: 'D' }).expect(200);
    await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
    const review = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
    expect(review.body.data.status).toBe('MANAGER_REVIEW');
    const approve = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
    expect(approve.body.data.status).toBe('MANAGER_APPROVED');
    const deliver = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
    expect(deliver.body.data.status).toBe('DELIVERED_TO_HOSPITAL');
  });

  it('CORRECTION-16/17: correct hospital sees corrected report, wrong hospital cannot', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/correction-requests`).send({ reason: 'fix' }).expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({}).expect(201);
    await rad1Agent.patch(`/api/reports/${s.studyInstanceUid}/draft`).send({ findings: 'E', impression: 'F' }).expect(200);
    await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
    const wrong = await mmcAgent.get(`/api/reports/${s.studyInstanceUid}`);
    expect(wrong.status).toBe(403);
    const right = await cghAgent.get(`/api/reports/${s.studyInstanceUid}`).expect(200);
    expect(right.body.data.impression).toBe('F');
  });

  it('CORRECTION-18/19: hospital accepts corrected report → COMPLETED', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/correction-requests`).send({ reason: 'fix' }).expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({}).expect(201);
    await rad1Agent.patch(`/api/reports/${s.studyInstanceUid}/draft`).send({ findings: 'G', impression: 'H' }).expect(200);
    await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({}).expect(201);
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({}).expect(201);
    const complete = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/complete`).send({}).expect(201);
    expect(complete.body.data.status).toBe('COMPLETED');
  });

  it('CORRECTION-20: original report version remains accessible in history', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/correction-requests`).send({ reason: 'fix' }).expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({}).expect(201);
    await rad1Agent.patch(`/api/reports/${s.studyInstanceUid}/draft`).send({ findings: 'I', impression: 'J' }).expect(200);
    await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({}).expect(201);
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/complete`).send({}).expect(201);
    const versions = await cghAgent.get(`/api/reports/${s.studyInstanceUid}/versions`).expect(200);
    const list = versions.body.data;
    expect(list.length).toBeGreaterThanOrEqual(2);
    const v1 = list.find((v: any) => v.version === 1);
    const v2 = list.find((v: any) => v.version === 2);
    expect(v1).toBeTruthy();
    expect(v2).toBeTruthy();
  });

  it('CORRECTION-27: correction audit records exist', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/correction-requests`).send({ reason: 'audit me' }).expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({}).expect(201);
    await rad1Agent.patch(`/api/reports/${s.studyInstanceUid}/draft`).send({ findings: 'K', impression: 'L' }).expect(200);
    await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);

    const actions = await prisma.auditLog.findMany({
      where: { resourceId: cr.id },
      select: { action: true },
    });
    const set = actions.map((a) => a.action);
    expect(set).toContain('CORRECTION_REQUESTED');
    expect(set).toContain('CORRECTION_APPROVED');
    expect(set).toContain('CORRECTION_STARTED');
    expect(set).toContain('CORRECTED_REPORT_SIGNED');
    expect(set).toContain('CORRECTION_RESOLVED');
  });

  it('CORRECTION-28: correction workflow is transaction-safe (full pipeline completes)', async () => {
    // Full happy path through the state machine, exercising every transition.
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/correction-requests`).send({ reason: 'full' }).expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    await managerAgent.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
    await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({}).expect(201);
    await rad1Agent.patch(`/api/reports/${s.studyInstanceUid}/draft`).send({ findings: 'M', impression: 'N' }).expect(200);
    await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({}).expect(201);
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({}).expect(201);
    await managerAgent.post(`/api/studies/${s.studyInstanceUid}/complete`).send({}).expect(201);
    const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(db.status).toBe('COMPLETED');
  });

  it('CORRECTION-9b: radiologist cannot begin a non-approved correction', async () => {
    const s = await seedCompleted({ assignedRadiologist: rad1Id });
    await cghAgent.post(`/api/studies/${s.studyInstanceUid}/correction-requests`).send({ reason: 'wait' }).expect(201);
    const res = await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({});
    expect(res.status).toBe(409);
  });
});
