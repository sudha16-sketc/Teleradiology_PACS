import 'reflect-metadata';
import request from 'supertest';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { StudyStatus } from '@prisma/client';
import AdmZip from 'adm-zip';
import { readFileSync } from 'fs';

let app: INestApplication;
let server: any;

const admin = USERS.ADMIN;
const manager = USERS.MANAGER;
const rad1 = USERS.RAD1;
const rad2 = USERS.RAD2;
const h_cgh = USERS.H_CGH;
const h_mmc = USERS.H_MMC;

const REAL_DICOM = '/tmp/opencode/emri_small.dcm';
const CGH_HOSPITAL_ID = 'hosp-001';
const MMC_HOSPITAL_ID = 'hosp-002';

// Studies we create and must clean up at the end.
const seeded: Array<{ id: string; patientId: string }> = [];

/**
 * Seeds an UNASSIGNED study directly via Prisma (no Orthanc required) so the
 * workflow/authorization tests are deterministic. `orthanc` when true gives a
 * non-null orthancStudyId (enabling assignment), otherwise leaves DICOM absent.
 */
async function seedStudy(opts: {
  hospitalId: string;
  status?: StudyStatus;
  patientName?: string;
  orthanc?: boolean;
}): Promise<{ id: string; studyInstanceUid: string; patientId: string }> {
  const studyInstanceUid = `1.2.826.0.1.3680043.9.${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-P3-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: opts.patientName ?? 'Phase3 Patient',
      hospitalId: opts.hospitalId,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber: `AX-P3-${Date.now()}`,
      patientId: patient.id,
      hospitalId: opts.hospitalId,
      studyDate: new Date(),
      modality: 'MRI',
      bodyPart: 'BRAIN',
      status: opts.status ?? StudyStatus.UNASSIGNED,
      orthancStudyId: opts.orthanc === false ? null : `orth-${studyInstanceUid}`,
      orthancPatientId: `orthp-${studyInstanceUid}`,
    },
  });
  seeded.push({ id: study.id, patientId: patient.id });
  return { id: study.id, studyInstanceUid, patientId: patient.id };
}

/** Inserts a real DICOM through the full pipeline -> returns UNASSIGNED study. */
async function ingestReal(agent: any, filename = 'emri.zip'): Promise<request.Response> {
  const real = readFileSync(REAL_DICOM);
  return agent
    .post('/api/dicom/ingest')
    .attach('file', real, { filename, contentType: 'application/octet-stream' });
}

async function cleanupStudy(id: string, patientId: string) {
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

// ---------------------------------------------------------------------------
// PHASE 3 -- WORKLIST
// ---------------------------------------------------------------------------
describe('Phase 3 -- Worklist scoping', () => {
  let managerAgent: any;
  let cghAgent: any;
  let rad1Agent: any;
  let rad2Agent: any;

  // Study A (CGH, UNASSIGNED, DICOM present) -- manager & CGH can see.
  let studyA: { id: string; studyInstanceUid: string; patientId: string };
  // Study B (MMC, UNASSIGNED) -- CGH must not see.
  let studyB: { id: string; studyInstanceUid: string; patientId: string };

  beforeAll(async () => {
    managerAgent = await loginAgent(server, manager);
    cghAgent = await loginAgent(server, h_cgh);
    rad1Agent = await loginAgent(server, rad1);
    rad2Agent = await loginAgent(server, rad2);
    studyA = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'Worklist A', status: StudyStatus.UNASSIGNED });
    studyB = await seedStudy({ hospitalId: MMC_HOSPITAL_ID, patientName: 'Worklist B', status: StudyStatus.UNASSIGNED });
  });

  it('WORKLIST-1: Manager can see an UNASSIGNED study in the operational queue', async () => {
    const res = await managerAgent.get('/api/worklist/my').expect(200);
    const uids = res.body.data.map((it: any) => it.study?.studyInstanceUid);
    expect(uids).toContain(studyA.studyInstanceUid);
  });

  it('WORKLIST-2: Hospital A cannot see Hospital B study', async () => {
    const res = await cghAgent.get(`/api/studies/${studyB.studyInstanceUid}`).expect(403);
    expect(res.body.message).toContain('access');
  });

  it('WORKLIST-3: Radiologist A cannot see Radiologist B assigned study', async () => {
    const rad2Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad2.email } })).id;
    // Assign studyA to RAD2 via the canonical operation.
    await managerAgent
      .post(`/api/worklist/${studyA.studyInstanceUid}/assign`)
      .send({ radiologistId: rad2Id })
      .expect(201);

    // RAD1's worklist must NOT contain studyA (assigned to RAD2).
    const rad1Res = await rad1Agent.get('/api/worklist/my').expect(200);
    const rad1Uids = rad1Res.body.data.map((it: any) => it.study?.studyInstanceUid);
    expect(rad1Uids).not.toContain(studyA.studyInstanceUid);

    // RAD2's worklist DOES contain it.
    const rad2Res = await rad2Agent.get('/api/worklist/my').expect(200);
    const rad2Uids = rad2Res.body.data.map((it: any) => it.study?.studyInstanceUid);
    expect(rad2Uids).toContain(studyA.studyInstanceUid);

    // RAD1 is rejected from viewing the study directly.
    const deny = await rad1Agent.get(`/api/studies/${studyA.studyInstanceUid}`).expect(403);
    expect(deny.body.message).toContain('assigned');
  });
});

// ---------------------------------------------------------------------------
// PHASE 3 -- ASSIGNMENT
// ---------------------------------------------------------------------------
describe('Phase 3 -- Assignment (canonical, transactional)', () => {
  let managerAgent: any;
  let cghAgent: any;
  let rad1Agent: any;
  let rad1Id!: string;

  let study: { id: string; studyInstanceUid: string; patientId: string };

  beforeAll(async () => {
    managerAgent = await loginAgent(server, manager);
    cghAgent = await loginAgent(server, h_cgh);
    rad1Agent = await loginAgent(server, rad1);
    rad1Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
    study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'Assign Study', status: StudyStatus.UNASSIGNED });
  });

  it('ASSIGN-1: Manager can assign an UNASSIGNED study; persist Study/Assignment/WorklistItem/status', async () => {
    const res = await managerAgent
      .post(`/api/worklist/${study.studyInstanceUid}/assign`)
      .send({ radiologistId: rad1Id })
      .expect(201);
    expect(res.body.data.status).toBe('ASSIGNED');
    expect(res.body.data.assignedRadiologistId).toBe(rad1Id);

    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
    expect(dbStudy.status).toBe('ASSIGNED');
    expect(dbStudy.assignedRadiologistId).toBe(rad1Id);
    expect(dbStudy.assignedBy).toBeTruthy();
    expect(dbStudy.assignedAt).toBeTruthy();

    const wl = await prisma.worklistItem.findUniqueOrThrow({ where: { studyId: study.id } });
    expect(wl.assignedAt).toBeTruthy();

    const active = await prisma.assignment.findMany({ where: { studyId: study.id, isActive: true } });
    expect(active.length).toBe(1);
    expect(active[0].radiologistId).toBe(rad1Id);
  });

  it('ASSIGN-2: Hospital cannot assign', async () => {
    const other = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'Assign Deny', status: StudyStatus.UNASSIGNED });
    const res = await cghAgent
      .post(`/api/worklist/${other.studyInstanceUid}/assign`)
      .send({ radiologistId: rad1Id });
    expect(res.status).toBe(403);
    // No assignment was created.
    const active = await prisma.assignment.findMany({ where: { studyId: other.id, isActive: true } });
    expect(active.length).toBe(0);
  });

  it('ASSIGN-3: Radiologist cannot assign', async () => {
    const other = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'Assign Deny Rad', status: StudyStatus.UNASSIGNED });
    const res = await rad1Agent
      .post(`/api/worklist/${other.studyInstanceUid}/assign`)
      .send({ radiologistId: rad1Id });
    expect(res.status).toBe(403);
  });

  it('ASSIGN-4: Assignment creates a STUDY_ASSIGNED audit event', async () => {
    const audits = await prisma.auditLog.findMany({
      where: { resourceId: study.id, action: 'STUDY_ASSIGNED' },
    });
    expect(audits.length).toBe(1);
    expect(audits[0].resource).toBe('ASSIGNMENT');
    expect(audits[0].metadata).toMatchObject({
      studyUid: study.studyInstanceUid,
      radiologistId: rad1Id,
      assignedBy: audits[0].actorId,
      previousRadiologistId: null,
    });
  });

  it('ASSIGN-5: Reassignment deactivates previous Assignment, preserves history, emits STUDY_REASSIGNED', async () => {
    const rad2Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad2.email } })).id;
    const res = await managerAgent
      .post(`/api/worklist/${study.studyInstanceUid}/assign`)
      .send({ radiologistId: rad2Id })
      .expect(201);
    expect(res.body.data.assignedRadiologistId).toBe(rad2Id);

    // Two historical rows: first inactive, second active.
    const all = await prisma.assignment.findMany({
      where: { studyId: study.id },
      orderBy: { assignedAt: 'asc' },
    });
    expect(all.length).toBe(2);
    expect(all[0].isActive).toBe(false);
    expect(all[0].unassignedAt).toBeTruthy();
    expect(all[0].radiologistId).toBe(rad1Id);
    expect(all[1].isActive).toBe(true);
    expect(all[1].radiologistId).toBe(rad2Id);

    const reassigned = await prisma.auditLog.findMany({
      where: { resourceId: study.id, action: 'STUDY_REASSIGNED' },
    });
    expect(reassigned.length).toBe(1);
    expect(reassigned[0].metadata).toMatchObject({ previousRadiologistId: rad1Id });
  });

  it('INVARIANT-REGRESSION: direct PATCH to ASSIGNED is rejected and cannot create ASSIGNED without an active Assignment', async () => {
    const other = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'Invariant', status: StudyStatus.UNASSIGNED });
    const res = await managerAgent
      .patch(`/api/studies/${other.studyInstanceUid}/status`)
      .send({ status: 'ASSIGNED' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('assign');

    // Study must NOT be ASSIGNED and must have no active Assignment.
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: other.id } });
    expect(dbStudy.status).not.toBe('ASSIGNED');
    expect(dbStudy.assignedRadiologistId).toBeNull();
    const active = await prisma.assignment.findMany({ where: { studyId: other.id, isActive: true } });
    expect(active.length).toBe(0);
  });

  it('TRANS-5: Reassignment from REPORT_DRAFT (clinically active) is rejected', async () => {
    const rad2Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad2.email } })).id;
    // Put study into REPORT_DRAFT via canonical assign + assigned-rad transitions.
    const other = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'Active Reassign', status: StudyStatus.UNASSIGNED });
    await managerAgent
      .post(`/api/worklist/${other.studyInstanceUid}/assign`)
      .send({ radiologistId: rad1Id })
      .expect(201);
    await rad1Agent
      .patch(`/api/studies/${other.studyInstanceUid}/status`)
      .send({ status: 'IN_READING' })
      .expect(200);
    await rad1Agent
      .patch(`/api/studies/${other.studyInstanceUid}/status`)
      .send({ status: 'REPORT_DRAFT' })
      .expect(200);

    // Attempting to reassign from REPORT_DRAFT must be rejected.
    const res = await managerAgent
      .post(`/api/worklist/${other.studyInstanceUid}/assign`)
      .send({ radiologistId: rad2Id });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('REPORT_DRAFT');

    // Study remains assigned to RAD1.
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: other.id } });
    expect(dbStudy.assignedRadiologistId).toBe(rad1Id);
    const active = await prisma.assignment.findMany({ where: { studyId: other.id, isActive: true } });
    expect(active.length).toBe(1);
    expect(active[0].radiologistId).toBe(rad1Id);
  });
});

// ---------------------------------------------------------------------------
// PHASE 3 -- WORKFLOW TRANSITIONS
// ---------------------------------------------------------------------------
describe('Phase 3 -- Workflow transitions', () => {
  let managerAgent: any;
  let rad1Agent: any;
  let rad2Agent: any;
  let rad1Id: string;
  let rad2Id: string;

  let study: { id: string; studyInstanceUid: string; patientId: string };

  beforeAll(async () => {
    managerAgent = await loginAgent(server, manager);
    rad1Agent = await loginAgent(server, rad1);
    rad2Agent = await loginAgent(server, rad2);
    rad1Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
    rad2Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad2.email } })).id;
    study = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'Transitions', status: StudyStatus.UNASSIGNED });
    await managerAgent
      .post(`/api/worklist/${study.studyInstanceUid}/assign`)
      .send({ radiologistId: rad1Id })
      .expect(201);
  });

  it('TRANS-1: UNASSIGNED -> ASSIGNED succeeds through canonical assignment', async () => {
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
    expect(dbStudy.status).toBe('ASSIGNED');
    expect(dbStudy.assignedRadiologistId).toBe(rad1Id);
  });

  it('TRANS-2: Assigned radiologist can transition ASSIGNED -> IN_READING', async () => {
    const res = await rad1Agent
      .patch(`/api/studies/${study.studyInstanceUid}/status`)
      .send({ status: 'IN_READING' })
      .expect(200);
    expect(res.body.data.status).toBe('IN_READING');
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
    expect(dbStudy.reportingStartedAt).toBeTruthy();
  });

  it('TRANS-3: An unassigned/other radiologist cannot transition that study to IN_READING', async () => {
    const unassigned = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'No Assign', status: StudyStatus.UNASSIGNED });
    const res = await rad2Agent
      .patch(`/api/studies/${unassigned.studyInstanceUid}/status`)
      .send({ status: 'IN_READING' });
    expect(res.status).toBe(403);
  });

  it('TRANS-3b: Manager cannot move an unassigned study into IN_READING', async () => {
    const unassigned = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, patientName: 'No Assign Mgr', status: StudyStatus.UNASSIGNED });
    const res = await managerAgent
      .patch(`/api/studies/${unassigned.studyInstanceUid}/status`)
      .send({ status: 'IN_READING' });
    // UNASSIGNED -> IN_READING is an invalid transition, so it is rejected and
    // an unassigned case can never be driven into the reading workflow.
    expect(res.status).toBe(400);
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: unassigned.id } });
    expect(dbStudy.status).toBe(StudyStatus.UNASSIGNED);
  });

  it('TRANS-3c: IN_READING is blocked when the study has no assigned radiologist', async () => {
    // Simulate an inconsistent state: ASSIGNED status but no assigned radiologist.
    // The workflow must refuse to enter IN_READING for such a study.
    const siu = `1.2.826.0.1.3680043.9.T-${Date.now()}`;
    const patient = await prisma.patient.create({
      data: { patientId: `P-P3-NR-${Date.now()}`, displayName: 'No Rad Assigned', hospitalId: CGH_HOSPITAL_ID, gender: 'U' },
    });
    const study = await prisma.study.create({
      data: {
        studyInstanceUid: siu,
        accessionNumber: `AX-NR-${Date.now()}`,
        patientId: patient.id,
        hospitalId: CGH_HOSPITAL_ID,
        studyDate: new Date(),
        modality: 'CT',
        bodyPart: 'CHEST',
        status: StudyStatus.ASSIGNED,
        orthancStudyId: `orth-${siu}`,
      },
    });
    seeded.push({ id: study.id, patientId: patient.id });

    const res = await managerAgent
      .patch(`/api/studies/${siu}/status`)
      .send({ status: 'IN_READING' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('assigned to a radiologist');
  });

  it('TRANS-4: IN_READING -> REPORT_DRAFT requires the assigned radiologist', async () => {
    // RAD2 (not assigned) cannot advance to REPORT_DRAFT.
    const deny = await rad2Agent
      .patch(`/api/studies/${study.studyInstanceUid}/status`)
      .send({ status: 'REPORT_DRAFT' });
    expect(deny.status).toBe(403);

    // Assigned RAD1 can.
    const ok = await rad1Agent
      .patch(`/api/studies/${study.studyInstanceUid}/status`)
      .send({ status: 'REPORT_DRAFT' })
      .expect(200);
    expect(ok.body.data.status).toBe('REPORT_DRAFT');
  });
});

// ---------------------------------------------------------------------------
// PHASE 3 -- DICOMweb authorization
// ---------------------------------------------------------------------------
describe('Phase 3 -- DICOMweb authorization', () => {
  let cghAgent: any;
  let mmcAgent: any;
  let rad1Agent: any;
  let rad2Agent: any;
  let managerAgent: any;
  let rad1Id: string;
  let rad2Id: string;

  // Real DICOM-backed study (CGH) used for the "granted" and "assigned" flows.
  let real: { id: string; studyInstanceUid: string; patientId: string };

  // MMC study used for cross-hospital denial.
  let mmcStudy: { id: string; studyInstanceUid: string; patientId: string };

  beforeAll(async () => {
    cghAgent = await loginAgent(server, h_cgh);
    mmcAgent = await loginAgent(server, h_mmc);
    rad1Agent = await loginAgent(server, rad1);
    rad2Agent = await loginAgent(server, rad2);
    managerAgent = await loginAgent(server, manager);
    rad1Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
    rad2Id = (await prisma.user.findUniqueOrThrow({ where: { email: rad2.email } })).id;

    // Real ingest -> a real Orthanc-backed UNASSIGNED study owned by CGH.
    const res = await ingestReal(cghAgent);
    expect(res.status).toBe(201);
    const studyId: string = res.body.data.study.id;
    real = { id: studyId, studyInstanceUid: res.body.data.study.studyInstanceUid, patientId: res.body.data.study.patientId };
    seeded.push(real);

    // Assign to RAD1.
    await managerAgent
      .post(`/api/worklist/${real.studyInstanceUid}/assign`)
      .send({ radiologistId: rad1Id })
      .expect(201);

    mmcStudy = await seedStudy({ hospitalId: MMC_HOSPITAL_ID, patientName: 'MMC Study', status: StudyStatus.UNASSIGNED, orthanc: true });
  });

  it('DICOM-ACCESS-1: Assigned radiologist can access the study through DICOMweb', async () => {
    const res = await rad1Agent.get(`/api/dicom-web/studies/${real.studyInstanceUid}/series`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('DICOM-ACCESS-2: Unassigned radiologist receives 403', async () => {
    const res = await rad2Agent.get(`/api/dicom-web/studies/${real.studyInstanceUid}/series`);
    expect(res.status).toBe(403);
  });

  it('DICOM-ACCESS-3: Radiologist A cannot access Radiologist B study', async () => {
    // Assign mmcStudy... no, keep it assigned to RAD2 to prove cross-rad denial.
    await managerAgent
      .post(`/api/worklist/${mmcStudy.studyInstanceUid}/assign`)
      .send({ radiologistId: rad2Id })
      .expect(201);
    // RAD1 is not assigned to mmcStudy -> 403 (even though hospital of study is
    // MMC, radiologists are scoped to assignment, not hospital).
    const res = await rad1Agent.get(`/api/dicom-web/studies/${mmcStudy.studyInstanceUid}/series`);
    expect(res.status).toBe(403);
    // RAD2 (assigned) gets 200? mmcStudy has no real Orthanc data, so WADO
    // would 404 from Orthanc; but the authz gate passes. We assert not-403 and
    // that the gate permits it (status is 404 from upstream, not 403).
    const rad2Res = await rad2Agent.get(`/api/dicom-web/studies/${mmcStudy.studyInstanceUid}/series`);
    expect(rad2Res.status).not.toBe(403);
  });

  it('DICOM-ACCESS-4: Hospital A cannot access Hospital B study', async () => {
    const res = await cghAgent.get(`/api/dicom-web/studies/${mmcStudy.studyInstanceUid}/series`);
    expect(res.status).toBe(403);
    // Owner hospital MMC passes the gate (404 from Orthanc, not 403).
    const owner = await mmcAgent.get(`/api/dicom-web/studies/${mmcStudy.studyInstanceUid}/series`);
    expect(owner.status).not.toBe(403);
  });

  it('DICOM-ACCESS-5: Manager has global operational DICOM access', async () => {
    const res = await managerAgent.get(`/api/dicom-web/studies/${real.studyInstanceUid}/series`);
    expect(res.status).toBe(200);
  });

  it('DICOM-ACCESS-6: Unknown/unindexed StudyInstanceUID does not bypass authorization', async () => {
    const unknown = '1.2.826.0.1.3680043.2.99999.000000.11111';
    // Even a manager gets 404 (study not indexed) rather than silent allow.
    const mgr = await managerAgent.get(`/api/dicom-web/studies/${unknown}/series`);
    expect(mgr.status).toBe(404);
    // A radiologist likewise gets 404.
    const rad = await rad1Agent.get(`/api/dicom-web/studies/${unknown}/series`);
    expect(rad.status).toBe(404);
    // A hospital likewise gets 404.
    const hosp = await cghAgent.get(`/api/dicom-web/studies/${unknown}/series`);
    expect(hosp.status).toBe(404);
  });
});
