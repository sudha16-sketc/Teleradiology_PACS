import 'reflect-metadata';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { StudyStatus } from '@prisma/client';
import { createHash } from 'crypto';

let app: INestApplication;
let server: any;

const manager = USERS.MANAGER;
const admin = USERS.ADMIN;
const rad1 = USERS.RAD1;
const rad2 = USERS.RAD2;
const h_cgh = USERS.H_CGH;
const CGH_HOSPITAL_ID = 'hosp-001';
const MMC_HOSPITAL_ID = 'hosp-002';

const seeded: Array<{ id: string; patientId: string }> = [];

async function seedStudy(opts: {
  hospitalId: string;
  status?: StudyStatus;
  assignedRadiologist?: string;
}): Promise<{ id: string; studyInstanceUid: string; patientId: string }> {
  const studyInstanceUid = `1.2.826.0.1.3680043.9.R-${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-P4-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: 'Phase4 Patient',
      hospitalId: opts.hospitalId,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber: `AX-P4-${Date.now()}`,
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

async function cleanupStudy(id: string, patientId: string) {
  await prisma.reportVersion.deleteMany({ where: { report: { studyId: id } } }).catch(() => undefined);
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

function expectedHash(content: Record<string, unknown>): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        content.clinicalHistory ?? '',
        content.findings ?? '',
        content.impression ?? '',
        content.technique ?? '',
        content.comparison ?? '',
        content.recommendations ?? '',
        content.criticalFinding ? 'critical' : 'normal',
      ]),
    )
    .digest('hex');
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

// ---------------------------------------------------------------------------
// PHASE 4 — REPORTING
// ---------------------------------------------------------------------------
describe('Phase 4 — Reporting', () => {
  let rad1Agent: any;
  let rad2Agent: any;
  let managerAgent: any;
  let adminAgent: any;
  let cghAgent: any;
  let rad1Id!: string;
  let rad2Id!: string;

  beforeAll(async () => {
    rad1Agent = await loginAgent(server, rad1);
    rad2Agent = await loginAgent(server, rad2);
    managerAgent = await loginAgent(server, manager);
    adminAgent = await loginAgent(server, admin);
    cghAgent = await loginAgent(server, h_cgh);
    rad1Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
    rad2Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad2.email } })).id;
  });

  // ---- REPORT-1: saveDraft creates a DRAFT report ----
  describe('REPORT-1: saveDraft creates a DRAFT report', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };
    const draftBody = {
      clinicalHistory: 'History of chest pain',
      findings: 'Bilateral ground-glass opacities',
      impression: 'Likely viral pneumonia',
      technique: 'Standard chest CT protocol',
      comparison: 'Prior CT 2024-01-01',
      recommendations: 'Follow up in 6 weeks',
      criticalFinding: false,
    };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.ASSIGNED, assignedRadiologist: rad1Id });
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-1: saveDraft on ASSIGNED study creates a v1 DRAFT with all content fields', async () => {
      const res = await rad1Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send(draftBody)
        .expect(200);

      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.clinicalHistory).toBe(draftBody.clinicalHistory);
      expect(res.body.data.findings).toBe(draftBody.findings);
      expect(res.body.data.impression).toBe(draftBody.impression);
      expect(res.body.data.technique).toBe(draftBody.technique);
      expect(res.body.data.comparison).toBe(draftBody.comparison);
      expect(res.body.data.recommendations).toBe(draftBody.recommendations);
      expect(res.body.data.criticalFinding).toBe(false);
      expect(res.body.data.contentHash).toBeTruthy();
      expect(res.body.data.contentHash).toHaveLength(64);

      const dbReport = await prisma.report.findFirst({ where: { studyId: study.id }, orderBy: { version: 'desc' } });
      expect(dbReport).toBeTruthy();
      expect(dbReport!.status).toBe('DRAFT');
      expect(dbReport!.contentHash).toBe(expectedHash(draftBody));
    });
  });

  // ---- REPORT-2: saveDraft transitions study to REPORT_DRAFT ----
  describe('REPORT-2: saveDraft transitions study to REPORT_DRAFT', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.ASSIGNED, assignedRadiologist: rad1Id });
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-2: ASSIGNED study becomes REPORT_DRAFT after first saveDraft', async () => {
      const dbBefore = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
      expect(dbBefore.status).toBe('ASSIGNED');

      await rad1Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'Test', impression: 'Test' })
        .expect(200);

      const dbAfter = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
      expect(dbAfter.status).toBe('REPORT_DRAFT');
    });
  });

  // ---- REPORT-3: saveDraft is idempotent (no duplicate drafts) ----
  describe('REPORT-3: saveDraft is idempotent', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-3: two saveDraft calls update in place, no duplicate reports', async () => {
      await rad1Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'V1 findings', impression: 'V1 impression' })
        .expect(200);

      await rad1Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'V2 findings', impression: 'V2 impression' })
        .expect(200);

      const allReports = await prisma.report.findMany({ where: { studyId: study.id } });
      expect(allReports.length).toBe(1);
      expect(allReports[0].findings).toBe('V2 findings');
      expect(allReports[0].impression).toBe('V2 impression');
    });
  });

  // ---- REPORT-4: non-radiologist cannot save draft ----
  describe('REPORT-4: non-radiologist cannot save draft', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.ASSIGNED, assignedRadiologist: rad1Id });
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-4a: manager gets 403 when saving draft', async () => {
      const res = await managerAgent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'Test', impression: 'Test' });
      expect(res.status).toBe(403);
    });

    it('REPORT-4b: admin gets 403 when saving draft', async () => {
      const res = await adminAgent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'Test', impression: 'Test' });
      expect(res.status).toBe(403);
    });

    it('REPORT-4c: hospital gets 403 when saving draft', async () => {
      const res = await cghAgent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'Test', impression: 'Test' });
      expect(res.status).toBe(403);
    });
  });

  // ---- REPORT-5: unassigned radiologist cannot save draft ----
  describe('REPORT-5: unassigned radiologist cannot save draft', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.ASSIGNED, assignedRadiologist: rad1Id });
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-5: RAD2 (unassigned) gets 403 on a study assigned to RAD1', async () => {
      const res = await rad2Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'Test', impression: 'Test' });
      expect(res.status).toBe(403);
    });
  });

  // ---- REPORT-6: saveDraft on non-existent study returns 404 ----
  it('REPORT-6: saveDraft on non-existent study returns 404', async () => {
    const res = await rad1Agent
      .patch('/api/reports/1.2.826.0.1.3680043.9.NONEXISTENT/draft')
      .send({ findings: 'Test', impression: 'Test' });
    expect(res.status).toBe(404);
  });

  // ---- REPORT-7: signOff requires findings and impression ----
  describe('REPORT-7: signOff requires findings and impression', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-7a: signOff without findings rejected (400)', async () => {
      await rad1Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ clinicalHistory: 'Some history', impression: 'An impression' })
        .expect(200);

      const res = await rad1Agent
        .post(`/api/reports/${study.studyInstanceUid}/sign`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('REPORT-7b: signOff without impression rejected (400)', async () => {
      await rad1Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'Some findings', impression: '' })
        .expect(200);

      const res = await rad1Agent
        .post(`/api/reports/${study.studyInstanceUid}/sign`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ---- REPORT-8: signOff with valid draft succeeds ----
  describe('REPORT-8: signOff with valid draft succeeds', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };
    const draftContent = {
      clinicalHistory: 'Chest pain, 3 days',
      findings: 'Right lower lobe consolidation with air bronchograms',
      impression: 'Right lower lobe pneumonia',
      technique: 'Standard CT chest protocol',
      comparison: 'None available',
      recommendations: 'Antibiotics, repeat in 6 weeks',
      criticalFinding: false,
    };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send(draftContent)
        .expect(200);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-8a: signOff returns 200 with signed report', async () => {
      const res = await rad1Agent
        .post(`/api/reports/${study.studyInstanceUid}/sign`)
        .send({})
        .expect(201);
      expect(res.body.data.status).toBe('SIGNED');
      expect(res.body.data.signedOffBy).toBe(rad1Id);
      expect(res.body.data.signedOffAt).toBeTruthy();
    });

    it('REPORT-8b: study transitions to RADIOLOGIST_SIGNED', async () => {
      const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
      expect(dbStudy.status).toBe('RADIOLOGIST_SIGNED');
      expect(dbStudy.signedOffAt).toBeTruthy();
    });

    it('REPORT-8c: contentHash matches expected full SHA-256', async () => {
      const dbReport = await prisma.report.findFirst({ where: { studyId: study.id } });
      expect(dbReport).toBeTruthy();
      expect(dbReport!.contentHash).toHaveLength(64);
      expect(dbReport!.contentHash).toBe(expectedHash(draftContent));
    });
  });

  // ---- REPORT-9: signOff creates ReportVersion snapshot ----
  describe('REPORT-9: signOff creates ReportVersion snapshot', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };
    const draftContent = {
      clinicalHistory: 'Shortness of breath',
      findings: 'Bilateral pleural effusions',
      impression: 'Bilateral pleural effusions',
      technique: 'CT chest',
      comparison: 'None',
      recommendations: 'Thoracentesis',
      criticalFinding: false,
    };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send(draftContent).expect(200);
      await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}).expect(201);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-9: ReportVersion created with all content fields', async () => {
      const report = await prisma.report.findFirst({ where: { studyId: study.id } });
      expect(report).toBeTruthy();

      const versions = await prisma.reportVersion.findMany({
        where: { reportId: report!.id },
        orderBy: { version: 'asc' },
      });
      expect(versions.length).toBe(1);
      expect(versions[0].status).toBe('SIGNED');
      expect(versions[0].version).toBe(1);
      expect(versions[0].clinicalHistory).toBe(draftContent.clinicalHistory);
      expect(versions[0].findings).toBe(draftContent.findings);
      expect(versions[0].impression).toBe(draftContent.impression);
      expect(versions[0].technique).toBe(draftContent.technique);
      expect(versions[0].comparison).toBe(draftContent.comparison);
      expect(versions[0].recommendations).toBe(draftContent.recommendations);
      expect(versions[0].authorId).toBe(rad1Id);
      expect(versions[0].contentHash).toBe(expectedHash(draftContent));
    });
  });

  // ---- REPORT-10: double-sign guard ----
  describe('REPORT-10: double-sign guard', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send({ findings: 'X', impression: 'Y' }).expect(200);
      await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}).expect(201);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-10: signing an already-signed report returns 409', async () => {
      const res = await rad1Agent
        .post(`/api/reports/${study.studyInstanceUid}/sign`)
        .send({});
      expect(res.status).toBe(409);
    });
  });

  // ---- REPORT-11: signOff emits audit rows ----
  describe('REPORT-11: signOff emits audit rows', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };
    let reportId!: string;

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send({ findings: 'Audit test', impression: 'Audit test' }).expect(200);
      const report = await prisma.report.findFirst({ where: { studyId: study.id } });
      reportId = report!.id;
      await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}).expect(201);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-11a: REPORT_SIGNED audit row exists', async () => {
      const audits = await prisma.auditLog.findMany({
        where: { resourceId: reportId, action: 'REPORT_SIGNED' },
      });
      expect(audits.length).toBe(1);
      expect(audits[0].actorId).toBe(rad1Id);
      expect(audits[0].actorRole).toBe('RADIOLOGIST');
      expect(audits[0].resource).toBe('REPORT');
      expect(audits[0].metadata).toMatchObject({
        studyUid: study.studyInstanceUid,
        signedBy: rad1Id,
      });
    });

    it('REPORT-11b: STUDY_STATUS_CHANGED audit row exists for RADIOLOGIST_SIGNED', async () => {
      const audits = await prisma.auditLog.findMany({
        where: { resourceId: study.id, action: 'STUDY_STATUS_CHANGED' },
      });
      expect(audits.length).toBeGreaterThanOrEqual(1);
      const signedAudit = audits.find((a: any) => (a.metadata as any)?.to === 'RADIOLOGIST_SIGNED');
      expect(signedAudit).toBeTruthy();
      expect(signedAudit!.actorId).toBe(rad1Id);
    });
  });

  // ---- REPORT-12: non-radiologist cannot sign ----
  describe('REPORT-12: non-radiologist cannot sign', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send({ findings: 'X', impression: 'Y' }).expect(200);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-12a: manager cannot sign (403)', async () => {
      const res = await managerAgent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({});
      expect(res.status).toBe(403);
    });

    it('REPORT-12b: admin cannot sign (403)', async () => {
      const res = await adminAgent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({});
      expect(res.status).toBe(403);
    });
  });

  // ---- REPORT-13: unassigned radiologist cannot sign ----
  describe('REPORT-13: unassigned radiologist cannot sign', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send({ findings: 'X', impression: 'Y' }).expect(200);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-13: RAD2 (unassigned) gets 403 when signing RAD1 draft', async () => {
      const res = await rad2Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({});
      expect(res.status).toBe(403);
    });
  });

  // ---- REPORT-14: saveDraft after sign is rejected (immutability) ----
  describe('REPORT-14: saveDraft after sign is rejected (immutability)', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send({ findings: 'Final', impression: 'Final' }).expect(200);
      await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}).expect(201);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-14: editing a signed report returns 409', async () => {
      const res = await rad1Agent
        .patch(`/api/reports/${study.studyInstanceUid}/draft`)
        .send({ findings: 'Modified after sign', impression: 'Modified' });
      expect(res.status).toBe(409);
    });
  });

  // ---- REPORT-15: GET /versions returns version history ----
  describe('REPORT-15: GET /versions returns version history', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send({ findings: 'V1', impression: 'V1' }).expect(200);
      await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}).expect(201);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-15: GET /versions returns the signed snapshot', async () => {
      const res = await rad1Agent
        .get(`/api/reports/${study.studyInstanceUid}/versions`)
        .expect(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe('SIGNED');
      expect(res.body.data[0].findings).toBe('V1');
      expect(res.body.data[0].authorId).toBe(rad1Id);
    });
  });

  // ---- REPORT-16: GET /versions access control ----
  describe('REPORT-16: GET /versions access control', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };
    let mmcStudy: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send({ findings: 'X', impression: 'Y' }).expect(200);
      await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}).expect(201);
      mmcStudy = await seedStudy({ hospitalId: MMC_HOSPITAL_ID, status: StudyStatus.UNASSIGNED });
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
      await cleanupStudy(mmcStudy.id, mmcStudy.patientId);
    });

    it('REPORT-16a: assigned radiologist can read versions', async () => {
      const res = await rad1Agent.get(`/api/reports/${study.studyInstanceUid}/versions`).expect(200);
      expect(res.body.data.length).toBe(1);
    });

    it('REPORT-16b: manager can read versions', async () => {
      const res = await managerAgent.get(`/api/reports/${study.studyInstanceUid}/versions`).expect(200);
      expect(res.body.data.length).toBe(1);
    });

    it('REPORT-16c: admin can read versions', async () => {
      const res = await adminAgent.get(`/api/reports/${study.studyInstanceUid}/versions`).expect(200);
      expect(res.body.data.length).toBe(1);
    });

    it('REPORT-16d: hospital cannot read versions before delivery (Phase 5 visibility)', async () => {
      const res = await cghAgent.get(`/api/reports/${study.studyInstanceUid}/versions`);
      expect(res.status).toBe(403);
    });

    it('REPORT-16d2: hospital can read versions for their hospital study after delivery', async () => {
      const delivered = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.DELIVERED_TO_HOSPITAL, assignedRadiologist: rad1Id });
      const res = await cghAgent.get(`/api/reports/${delivered.studyInstanceUid}/versions`);
      expect(res.status).toBe(200);
      await cleanupStudy(delivered.id, delivered.patientId);
    });

    it('REPORT-16e: hospital cannot read versions for another hospital study', async () => {
      const mmcH = await loginAgent(server, USERS.H_MMC);
      const res = await mmcH.get(`/api/reports/${study.studyInstanceUid}/versions`);
      expect(res.status).toBe(403);
    });

    it('REPORT-16f: unassigned radiologist cannot read versions', async () => {
      const res = await rad2Agent.get(`/api/reports/${study.studyInstanceUid}/versions`);
      expect(res.status).toBe(403);
    });
  });

  // ---- REPORT-17: saveDraft only allowed in draftable states ----
  describe('REPORT-17: saveDraft only allowed in draftable states', () => {
    let completedStudy: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      completedStudy = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.COMPLETED, assignedRadiologist: rad1Id });
    });

    afterAll(async () => {
      await cleanupStudy(completedStudy.id, completedStudy.patientId);
    });

    it('REPORT-17: saveDraft on COMPLETED study returns 400', async () => {
      const res = await rad1Agent
        .patch(`/api/reports/${completedStudy.studyInstanceUid}/draft`)
        .send({ findings: 'Test', impression: 'Test' });
      expect(res.status).toBe(400);
    });
  });

  // ---- REPORT-18: contentHash consistency ----
  describe('REPORT-18: contentHash consistency', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };
    const content = {
      clinicalHistory: 'Consistency check',
      findings: 'Findings text',
      impression: 'Impression text',
      technique: 'Protocol',
      comparison: 'None',
      recommendations: 'None',
      criticalFinding: true,
    };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send(content).expect(200);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-18a: contentHash is 64-char hex string', async () => {
      const res = await rad1Agent.get(`/api/reports/${study.studyInstanceUid}`).expect(200);
      const hash = res.body.data.contentHash;
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('REPORT-18b: contentHash matches expected SHA-256', async () => {
      const res = await rad1Agent.get(`/api/reports/${study.studyInstanceUid}`).expect(200);
      expect(res.body.data.contentHash).toBe(expectedHash(content));
    });
  });

  // ---- REPORT-19: amend creates a new version ----
  describe('REPORT-19: amend creates a new version', () => {
    let study: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${study.studyInstanceUid}/draft`).send({ findings: 'Original', impression: 'Original' }).expect(200);
      await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}).expect(201);
    });

    afterAll(async () => {
      await cleanupStudy(study.id, study.patientId);
    });

    it('REPORT-19: amend creates v2 DRAFT report after signed v1', async () => {
      const res = await rad1Agent
        .post(`/api/reports/${study.studyInstanceUid}/amend`)
        .send({ findings: 'Amended', impression: 'Amended' })
        .expect(201);

      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.findings).toBe('Amended');

      const versions = await prisma.reportVersion.findMany({
        where: { report: { studyId: study.id } },
        orderBy: { version: 'asc' },
      });
      expect(versions.length).toBe(1);
      expect(versions[0].version).toBe(1);
      expect(versions[0].status).toBe('SIGNED');
    });
  });

  // ---- REPORT-20: list endpoint filters correctly ----
  describe('REPORT-20: list endpoint filters correctly', () => {
    let studyA: { id: string; studyInstanceUid: string; patientId: string };
    let studyB: { id: string; studyInstanceUid: string; patientId: string };

    beforeAll(async () => {
      studyA = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
      await rad1Agent.patch(`/api/studies/${studyA.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad1Agent.patch(`/api/reports/${studyA.studyInstanceUid}/draft`).send({ findings: 'List A', impression: 'List A' }).expect(200);

      studyB = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad2Id });
      await rad2Agent.patch(`/api/studies/${studyB.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
      await rad2Agent.patch(`/api/reports/${studyB.studyInstanceUid}/draft`).send({ findings: 'List B', impression: 'List B' }).expect(200);
    });

    afterAll(async () => {
      await cleanupStudy(studyA.id, studyA.patientId);
      await cleanupStudy(studyB.id, studyB.patientId);
    });

    it('REPORT-20a: radiologist only sees their own reports', async () => {
      const res = await rad1Agent.get('/api/reports').expect(200);
      const uids = res.body.data.map((r: any) => r.study?.studyInstanceUid);
      expect(uids).toContain(studyA.studyInstanceUid);
      expect(uids).not.toContain(studyB.studyInstanceUid);
    });

    it('REPORT-20b: manager sees all reports', async () => {
      const res = await managerAgent.get('/api/reports').expect(200);
      const uids = res.body.data.map((r: any) => r.study?.studyInstanceUid);
      expect(uids).toContain(studyA.studyInstanceUid);
      expect(uids).toContain(studyB.studyInstanceUid);
    });
  });

  // ---- REPORT-21: signOff on non-existent study returns 404 ----
  it('REPORT-21: signOff on non-existent study returns 404', async () => {
    const res = await rad1Agent
      .post('/api/reports/1.2.826.0.1.3680043.9.NONEXISTENT/sign')
      .send({});
    expect(res.status).toBe(404);
  });

  // ---- REPORT-22: signOff with no draft report returns 404 ----
  it('REPORT-22: signOff with no draft report returns 404', async () => {
    const study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, status: StudyStatus.IN_READING, assignedRadiologist: rad1Id });
    await rad1Agent.patch(`/api/studies/${study.studyInstanceUid}/status`).send({ status: 'REPORT_DRAFT' }).expect(200);
    const res = await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({});
    expect(res.status).toBe(404);
    await cleanupStudy(study.id, study.patientId);
  });
});
