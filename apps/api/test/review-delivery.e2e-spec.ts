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

const FAKE_HASH =
  'a'.repeat(64);

async function seedStudy(opts: {
  hospitalId: string;
  status?: StudyStatus;
  assignedRadiologist?: string;
}): Promise<{ id: string; studyInstanceUid: string; patientId: string }> {
  const studyInstanceUid = `1.2.826.0.1.3680043.5.RD-${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-P5-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: 'Phase5 Patient',
      hospitalId: opts.hospitalId,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber: `AX-P5-${Date.now()}`,
      patientId: patient.id,
      hospitalId: opts.hospitalId,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: opts.status ?? StudyStatus.UNASSIGNED,
      orthancStudyId: `orth-${studyInstanceUid}`,
      orthancPatientId: `orthp-${studyInstanceUid}`,
      assignedRadiologistId: opts.assignedRadiologist ?? null,
    },
  });
  seeded.push({ id: study.id, patientId: patient.id });
  return { id: study.id, studyInstanceUid, patientId: patient.id };
}

/**
 * Seeds a study plus a signed, immutable report in the given study status.
 * Sets the workflow timestamps required for later Phase 5 transitions.
 */
async function seedSigned(opts: {
  hospitalId: string;
  status: StudyStatus;
  assignedRadiologist: string;
  signedBy?: string;
  managerApprovedAt?: boolean;
  deliveredAt?: boolean;
  hospitalAcceptedAt?: boolean;
}): Promise<{ id: string; studyInstanceUid: string; patientId: string; reportId: string }> {
  const s = await seedStudy({
    hospitalId: opts.hospitalId,
    status: opts.status,
    assignedRadiologist: opts.assignedRadiologist,
  });

  const report = await prisma.report.create({
    data: {
      studyId: s.id,
      authorId: opts.assignedRadiologist,
      status: 'SIGNED',
      version: 1,
      clinicalHistory: 'Phase5 clinical history',
      findings: 'Phase5 findings',
      impression: 'Phase5 impression',
      technique: 'CT chest',
      comparison: 'None',
      recommendations: 'Follow up',
      signedOffBy: opts.signedBy ?? opts.assignedRadiologist,
      signedOffAt: new Date(),
      contentHash: FAKE_HASH,
    },
  });

  await prisma.study.update({
    where: { id: s.id },
    data: {
      signedOffAt: new Date(),
      ...(opts.managerApprovedAt ? { managerReviewedAt: new Date(), managerApprovedAt: new Date() } : {}),
      ...(opts.deliveredAt ? { deliveredAt: new Date() } : {}),
      ...(opts.hospitalAcceptedAt ? { hospitalAcceptedAt: new Date() } : {}),
    },
  });

  return { ...s, reportId: report.id };
}

async function cleanupStudy(id: string, patientId: string) {
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

describe('Phase 5 — Review & Hospital Delivery', () => {
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

  // ---------------------------------------------------------------------------
  // REVIEW
  // ---------------------------------------------------------------------------
  describe('REVIEW', () => {
    it('REVIEW-1: manager enters MANAGER_REVIEW from RADIOLOGIST_SIGNED', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      const res = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('MANAGER_REVIEW');
      expect(db.managerReviewedAt).toBeTruthy();
      expect(res.body.data.status).toBe('MANAGER_REVIEW');
      await cleanupStudy(s.id, s.patientId);
    });

    it('REVIEW-2: radiologist cannot review (403)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      const res = await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/review`).send({});
      expect(res.status).toBe(403);
      await cleanupStudy(s.id, s.patientId);
    });

    it('REVIEW-3: hospital cannot review (403)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      const res = await cghAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({});
      expect(res.status).toBe(403);
      await cleanupStudy(s.id, s.patientId);
    });

    it('REVIEW-4: cannot review a study not in RADIOLOGIST_SIGNED (409)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.MANAGER_REVIEW, assignedRadiologist: rad1Id });
      const res = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({});
      expect(res.status).toBe(409);
      await cleanupStudy(s.id, s.patientId);
    });

    it('REVIEW-5: cannot review without a signed report', async () => {
      const s = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      const res = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({});
      expect(res.status).toBe(409);
      await cleanupStudy(s.id, s.patientId);
    });

    it('REVIEW-6: double review returns 409', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
      const res = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({});
      expect(res.status).toBe(409);
      await cleanupStudy(s.id, s.patientId);
    });

    it('REVIEW-7: review emits REPORT_VERIFIED + STUDY_STATUS_CHANGED audit', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
      const verified = await prisma.auditLog.findFirst({ where: { resourceId: s.reportId, action: 'REPORT_VERIFIED' } });
      expect(verified).toBeTruthy();
      expect(verified!.actorRole).toBe('MANAGER');
      const statusAudits = await prisma.auditLog.findMany({ where: { resourceId: s.id, action: 'STUDY_STATUS_CHANGED' } });
      expect(statusAudits.some((a: any) => (a.metadata as any)?.to === 'MANAGER_REVIEW')).toBe(true);
      await cleanupStudy(s.id, s.patientId);
    });
  });

  // ---------------------------------------------------------------------------
  // DELIVERY (approve + deliver)
  // ---------------------------------------------------------------------------
  describe('DELIVERY', () => {
    it('DELIVERY-1: manager approves MANAGER_REVIEW -> MANAGER_APPROVED', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.MANAGER_REVIEW, assignedRadiologist: rad1Id, managerApprovedAt: true });
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('MANAGER_APPROVED');
      expect(db.managerApprovedAt).toBeTruthy();
      await cleanupStudy(s.id, s.patientId);
    });

    it('DELIVERY-2: manager delivers MANAGER_APPROVED -> DELIVERED_TO_HOSPITAL with DeliveryAttempt', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.MANAGER_APPROVED, assignedRadiologist: rad1Id, managerApprovedAt: true });
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('DELIVERED_TO_HOSPITAL');
      expect(db.deliveredAt).toBeTruthy();
      const attempt = await prisma.deliveryAttempt.findFirst({ where: { studyId: s.id } });
      expect(attempt).toBeTruthy();
      expect(attempt!.hospitalId).toBe(CGH_HOSPITAL_ID);
      expect(attempt!.reportId).toBe(s.reportId);
      expect(attempt!.status).toBe('COMPLETED');
      await cleanupStudy(s.id, s.patientId);
    });

    it('DELIVERY-3: cannot approve before entering MANAGER_REVIEW (409)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      const res = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({});
      expect(res.status).toBe(409);
      await cleanupStudy(s.id, s.patientId);
    });

    it('DELIVERY-4: deliver uses the authoritative study.hospitalId (no client-supplied hospital)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.MANAGER_APPROVED, assignedRadiologist: rad1Id, managerApprovedAt: true });
      const res = await managerAgent
        .post(`/api/studies/${s.studyInstanceUid}/deliver`)
        .send({ hospitalId: MMC_HOSPITAL_ID });
      expect(res.status).toBe(201);
      const attempt = await prisma.deliveryAttempt.findFirst({ where: { studyId: s.id } });
      expect(attempt!.hospitalId).toBe(CGH_HOSPITAL_ID);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.hospitalId).toBe(CGH_HOSPITAL_ID);
      await cleanupStudy(s.id, s.patientId);
    });
  });

  // ---------------------------------------------------------------------------
  // HOSPITAL
  // ---------------------------------------------------------------------------
  describe('HOSPITAL', () => {
    it('HOSPITAL-1: hospital reviews DELIVERED_TO_HOSPITAL -> HOSPITAL_REVIEW', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.DELIVERED_TO_HOSPITAL, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true });
      const res = await cghAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({}).expect(201);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('HOSPITAL_REVIEW');
      expect(db.hospitalReviewedAt).toBeTruthy();
      expect(res.body.data.status).toBe('HOSPITAL_REVIEW');
      await cleanupStudy(s.id, s.patientId);
    });

    it('HOSPITAL-2: hospital accepts HOSPITAL_REVIEW -> HOSPITAL_ACCEPTED', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.HOSPITAL_REVIEW, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true });
      const res = await cghAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({}).expect(201);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('HOSPITAL_ACCEPTED');
      expect(db.hospitalAcceptedAt).toBeTruthy();
      expect(res.body.data.status).toBe('HOSPITAL_ACCEPTED');
      await cleanupStudy(s.id, s.patientId);
    });

    it('HOSPITAL-3: cross-tenant hospital cannot review/accept another hospital study (403)', async () => {
      const s = await seedSigned({ hospitalId: MMC_HOSPITAL_ID, status: StudyStatus.DELIVERED_TO_HOSPITAL, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true });
      const review = await cghAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({});
      expect(review.status).toBe(403);
      const accept = await cghAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({});
      expect(accept.status).toBe(403);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('DELIVERED_TO_HOSPITAL');
      await cleanupStudy(s.id, s.patientId);
    });

    it('HOSPITAL-4: hospital cannot accept before entering HOSPITAL_REVIEW (409)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.DELIVERED_TO_HOSPITAL, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true });
      const res = await cghAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({});
      expect(res.status).toBe(409);
      await cleanupStudy(s.id, s.patientId);
    });

    it('HOSPITAL-6: hospital cannot review a study not yet delivered (409)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.MANAGER_APPROVED, assignedRadiologist: rad1Id, managerApprovedAt: true });
      const res = await cghAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({});
      expect(res.status).toBe(409);
      await cleanupStudy(s.id, s.patientId);
    });

    it('HOSPITAL-7: hospital cannot set COMPLETED directly (403)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.HOSPITAL_ACCEPTED, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true, hospitalAcceptedAt: true });
      const res = await cghAgent.post(`/api/studies/${s.studyInstanceUid}/complete`).send({});
      expect(res.status).toBe(403);
      await cleanupStudy(s.id, s.patientId);
    });
  });

  // ---------------------------------------------------------------------------
  // COMPLETE
  // ---------------------------------------------------------------------------
  describe('COMPLETE', () => {
    it('COMPLETE-1: accepted study reaches COMPLETED via manager', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.HOSPITAL_ACCEPTED, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true, hospitalAcceptedAt: true });
      const res = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/complete`).send({}).expect(201);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('COMPLETED');
      expect(db.completedAt).toBeTruthy();
      expect(res.body.data.status).toBe('COMPLETED');
      await cleanupStudy(s.id, s.patientId);
    });

    it('COMPLETE-2: cannot complete before hospital acceptance (409)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.DELIVERED_TO_HOSPITAL, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true });
      const res = await managerAgent.post(`/api/studies/${s.studyInstanceUid}/complete`).send({});
      expect(res.status).toBe(409);
      await cleanupStudy(s.id, s.patientId);
    });
  });

  // ---------------------------------------------------------------------------
  // WORKFLOW
  // ---------------------------------------------------------------------------
  describe('WORKFLOW', () => {
    it('WORKFLOW-1: full happy path reaches COMPLETED', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
      await cghAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({}).expect(201);
      await cghAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/complete`).send({}).expect(201);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('COMPLETED');
      await cleanupStudy(s.id, s.patientId);
    });

    it('WORKFLOW-2: generic status PATCH cannot skip to MANAGER_APPROVED from RADIOLOGIST_SIGNED (400)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      const res = await managerAgent
        .patch(`/api/studies/${s.studyInstanceUid}/status`)
        .send({ status: 'MANAGER_APPROVED' });
      expect(res.status).toBe(400);
      await cleanupStudy(s.id, s.patientId);
    });

    it('WORKFLOW-3: generic status PATCH cannot bypass hospital accept (400 invalid transition)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.DELIVERED_TO_HOSPITAL, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true });
      const res = await cghAgent
        .patch(`/api/studies/${s.studyInstanceUid}/status`)
        .send({ status: 'HOSPITAL_ACCEPTED' });
      expect(res.status).toBe(400);
      await cleanupStudy(s.id, s.patientId);
    });

    it('WORKFLOW-4: report remains immutable through delivery (no edit after sign)', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.DELIVERED_TO_HOSPITAL, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true });
      const res = await rad1Agent
        .patch(`/api/reports/${s.studyInstanceUid}/draft`)
        .send({ findings: 'TAMPERED' });
      expect(res.status).toBe(409);
      const dbReport = await prisma.report.findFirst({ where: { studyId: s.id } });
      expect(dbReport!.findings).toBe('Phase5 findings');
      await cleanupStudy(s.id, s.patientId);
    });

    it('WORKFLOW-5: report not visible to hospital until delivered; visible after', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      const before = await cghAgent.get(`/api/reports/${s.studyInstanceUid}`);
      expect(before.status).toBe(403);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
      const after = await cghAgent.get(`/api/reports/${s.studyInstanceUid}`);
      expect(after.status).toBe(200);
      await cleanupStudy(s.id, s.patientId);
    });
  });

  // ---------------------------------------------------------------------------
  // AUTHZ
  // ---------------------------------------------------------------------------
  describe('AUTHZ', () => {
    it('AUTHZ-1: role matrix — manager operations denied for radiologist/hospital; hospital operations denied for manager', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      expect((await rad1Agent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({})).status).toBe(403);
      expect((await cghAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({})).status).toBe(403);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
      expect((await managerAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({})).status).toBe(403);
      expect((await managerAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({})).status).toBe(403);
      await cleanupStudy(s.id, s.patientId);
    });

    it('AUTHZ-2: delivery destination always equals study.hospitalId', async () => {
      const s = await seedSigned({ hospitalId: MMC_HOSPITAL_ID, status: StudyStatus.MANAGER_APPROVED, assignedRadiologist: rad1Id, managerApprovedAt: true });
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({ hospitalId: CGH_HOSPITAL_ID }).expect(201);
      const attempt = await prisma.deliveryAttempt.findFirst({ where: { studyId: s.id } });
      expect(attempt!.hospitalId).toBe(MMC_HOSPITAL_ID);
      await cleanupStudy(s.id, s.patientId);
    });

    it('AUTHZ-3: hospital of different tenant cannot read other hospitals delivered report (403 via DICOM path is pre-existing; report path blocked)', async () => {
      const s = await seedSigned({ hospitalId: MMC_HOSPITAL_ID, status: StudyStatus.DELIVERED_TO_HOSPITAL, assignedRadiologist: rad1Id, managerApprovedAt: true, deliveredAt: true });
      const res = await cghAgent.get(`/api/reports/${s.studyInstanceUid}`);
      expect(res.status).toBe(403);
      await cleanupStudy(s.id, s.patientId);
    });
  });

  // ---------------------------------------------------------------------------
  // AUDIT
  // ---------------------------------------------------------------------------
  describe('AUDIT', () => {
    it('AUDIT-1: delivery + accept emit DELIVERY_COMPLETED and HOSPITAL_ACCEPTED audit rows', async () => {
      const s = await seedSigned({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.RADIOLOGIST_SIGNED, assignedRadiologist: rad1Id });
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
      await managerAgent.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
      await cghAgent.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({}).expect(201);
      await cghAgent.post(`/api/studies/${s.studyInstanceUid}/accept`).send({}).expect(201);

      const deliveryAudit = await prisma.auditLog.findFirst({
        where: { resourceId: s.id, action: 'DELIVERY_COMPLETED' },
      });
      expect(deliveryAudit).toBeTruthy();
      expect((deliveryAudit!.metadata as any)?.hospitalId).toBe(CGH_HOSPITAL_ID);

      const acceptAudit = await prisma.auditLog.findFirst({
        where: { resourceId: s.id, action: 'HOSPITAL_ACCEPTED' },
      });
      expect(acceptAudit).toBeTruthy();
      expect(acceptAudit!.actorRole).toBe('HOSPITAL');
      await cleanupStudy(s.id, s.patientId);
    });
  });

  // ---------------------------------------------------------------------------
  // REGRESSION
  // ---------------------------------------------------------------------------
  describe('REGRESSION', () => {
    it('REGRESSION-1: radiologist draft + sign workflow still works', async () => {
      const s = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.ASSIGNED, assignedRadiologist: rad1Id });
      await rad1Agent
        .patch(`/api/reports/${s.studyInstanceUid}/draft`)
        .send({ findings: 'Regression findings', impression: 'Regression impression' })
        .expect(200);
      await rad1Agent.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
      const db = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
      expect(db.status).toBe('RADIOLOGIST_SIGNED');
      await cleanupStudy(s.id, s.patientId);
    });
  });
});
