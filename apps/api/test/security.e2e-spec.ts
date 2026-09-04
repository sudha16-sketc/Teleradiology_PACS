import 'reflect-metadata';
import request from 'supertest';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import type { Test } from 'supertest';
import { randomUUID } from 'crypto';

let app: INestApplication;
let server: any;

const manager = USERS.MANAGER;
const h_cgh = USERS.H_CGH;
const h_mmc = USERS.H_MMC;
const rad1 = USERS.RAD1;
const rad2 = USERS.RAD2;

// Unique per-run study UIDs to avoid collisions in the shared test DB.
const UID = () => `1.2.826.0.1.3680043.8.498.test.${Date.now()}.${randomUUID().replace(/-/g, '').slice(0, 12)}`;

async function createStudy(agent: any, patientName: string): Promise<{ studyUid: string; studyId: string }> {
  const studyUid = UID();
  const res = await agent
    .post('/api/studies')
    .send({
      patientName,
      patientId: `T-${randomUUID().slice(0, 8)}`,
      studyInstanceUid: studyUid,
      modality: 'CT',
      bodyPart: 'CHEST',
      studyDescription: 'Security e2e fixture',
    });
  if (res.status !== 201) {
    throw new Error(`createStudy failed ${res.status}: ${res.text}`);
  }
  const studyId = res.body.data.id;
  return { studyUid, studyId };
}

async function enableDicomOnStudy(studyId: string): Promise<void> {
  await prisma.study.update({
    where: { id: studyId },
    data: { orthancStudyId: `orthanc-${studyId.slice(0, 16)}` },
  });
}

async function assignStudy(agent: any, studyUid: string, radiologistId: string): Promise<void> {
  const res = await agent
    .post(`/api/worklist/${studyUid}/assign`)
    .send({ radiologistId });
  if (res.status !== 201) {
    throw new Error(`assign failed ${res.status}: ${res.text}`);
  }
}

function transition(agent: any, studyUid: string, status: string): Test {
  return agent.patch(`/api/studies/${studyUid}/status`).send({ status });
}

let createdStudyIds: string[] = [];

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
});

afterAll(async () => {
  for (const studyId of createdStudyIds) {
    const reports = await prisma.report.findMany({
      where: { studyId },
      select: { id: true },
    });
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
    await prisma.study.delete({ where: { id: studyId } });
  }
  await prisma.$disconnect();
  await app.close();
});

describe('Phase 1 security -- tenant isolation (HOSPITAL)', () => {
  let cghAgent: any;
  let mmcAgent: any;

  beforeAll(async () => {
    cghAgent = await loginAgent(server, h_cgh);
    mmcAgent = await loginAgent(server, h_mmc);
  });

  it('HOSPITAL-1: can see only its own hospital studies in the list', async () => {
    const sel = await createStudy(cghAgent, 'Isolation CGH Patient');
    createdStudyIds.push(sel.studyId);

    const other = await createStudy(mmcAgent, 'Isolation MMC Patient');
    createdStudyIds.push(other.studyId);

    const cghList = await cghAgent.get('/api/studies').expect(200);
    const mmcList = await mmcAgent.get('/api/studies').expect(200);

    const cghUids = (cghList.body.data as any[]).map((s) => s.studyInstanceUid);
    const mmcUids = (mmcList.body.data as any[]).map((s) => s.studyInstanceUid);

    expect(cghUids).toContain(sel.studyUid);
    expect(cghUids).not.toContain(other.studyUid);
    expect(mmcUids).toContain(other.studyUid);
    expect(mmcUids).not.toContain(sel.studyUid);
  });

  it('HOSPITAL-2: cannot GET another hospital study detail', async () => {
    const sel = await createStudy(cghAgent, 'Isolation CGH Detail');
    createdStudyIds.push(sel.studyId);

    const res = await mmcAgent.get(`/api/studies/${sel.studyUid}`).expect(403);
    expect(res.body.message).toContain('access');
  });

  it('HOSPITAL-3: cannot transition another hospital study status', async () => {
    const sel = await createStudy(cghAgent, 'Isolation CGH Transition');
    createdStudyIds.push(sel.studyId);

    // MMC hospital cannot drive a CGH study forward (403).
    await transition(mmcAgent, sel.studyUid, 'RECEIVING').expect(403);

    // A manager can receive it (RECEIVING requires ADMIN/MANAGER).
    const mgr = await loginAgent(server, manager);
    await transition(mgr, sel.studyUid, 'RECEIVING').expect(200);
  });
});

describe('Phase 1 security -- radiologist case isolation', () => {
  let mgrAgent: any;
  let rad1Agent: any;
  let rad2Agent: any;

  beforeAll(async () => {
    mgrAgent = await loginAgent(server, manager);
    rad1Agent = await loginAgent(server, rad1);
    rad2Agent = await loginAgent(server, rad2);
  });

  it('RAD-1: unassigned radiologist cannot access a study assigned to another radiologist', async () => {
    const cghAgent = await loginAgent(server, h_cgh);
    const sel = await createStudy(cghAgent, 'Rad Isolation Patient');
    createdStudyIds.push(sel.studyId);
    await enableDicomOnStudy(sel.studyId);

    const radiologist = await prisma.user.findUnique({ where: { email: rad1.email } });
    const rad2User = await prisma.user.findUnique({ where: { email: rad2.email } });
    if (!radiologist || !rad2User) throw new Error('radiologists not seeded');
    await assignStudy(mgrAgent, sel.studyUid, radiologist.id);

    const res = await rad2Agent.get(`/api/studies/${sel.studyUid}`).expect(403);
    expect(res.body.message).toContain('access');

    const rad2List = await rad2Agent.get('/api/studies').expect(200);
    const uids = (rad2List.body.data as any[]).map((s) => s.studyInstanceUid);
    expect(uids).not.toContain(sel.studyUid);
  });

  it('RAD-2: assigned radiologist can view and drive their own study into reading', async () => {
    const cghAgent = await loginAgent(server, h_cgh);
    const sel = await createStudy(cghAgent, 'Rad Access Patient');
    createdStudyIds.push(sel.studyId);
    await enableDicomOnStudy(sel.studyId);

    const radiologist = await prisma.user.findUnique({ where: { email: rad1.email } });
    if (!radiologist) throw new Error('radiologist not seeded');
    await assignStudy(mgrAgent, sel.studyUid, radiologist.id);

    const detail = await rad1Agent.get(`/api/studies/${sel.studyUid}`).expect(200);
    expect(detail.body.data.assignedRadiologistId).toBe(radiologist.id);

    await transition(rad1Agent, sel.studyUid, 'IN_READING').expect(200);
  });

  it('RAD-3: unassigned radiologist cannot transition another radiologist study status', async () => {
    const cghAgent = await loginAgent(server, h_cgh);
    const sel = await createStudy(cghAgent, 'Rad Transition Patient');
    createdStudyIds.push(sel.studyId);
    await enableDicomOnStudy(sel.studyId);

    const radiologist = await prisma.user.findUnique({ where: { email: rad1.email } });
    if (!radiologist) throw new Error('radiologist not seeded');
    await assignStudy(mgrAgent, sel.studyUid, radiologist.id);

    await transition(rad2Agent, sel.studyUid, 'IN_READING').expect(403);
  });
});

describe('Phase 1 security -- role & status transition guards', () => {
  let mgrAgent: any;
  let cghAgent: any;

  beforeAll(async () => {
    mgrAgent = await loginAgent(server, manager);
    cghAgent = await loginAgent(server, h_cgh);
  });

  it('TRANS-1: hospital user is not authorized to drive a study to RECEIVING (role guard)', async () => {
    const sel = await createStudy(cghAgent, 'Trans Role Patient');
    createdStudyIds.push(sel.studyId);

    // RECEIVING is a valid target, but HOSPITAL is not in TRANSITION_ACTORS[RECEIVING].
    const res = await transition(cghAgent, sel.studyUid, 'RECEIVING').expect(403);
    expect(res.body.message).toContain('not authorized');
  });

  it('TRANS-2: invalid transition UNASSIGNED -> COMPLETED is rejected', async () => {
    const sel = await createStudy(cghAgent, 'Trans Invalid Patient');
    createdStudyIds.push(sel.studyId);

    await transition(mgrAgent, sel.studyUid, 'RECEIVING').expect(200);
    await transition(mgrAgent, sel.studyUid, 'VALIDATING').expect(200);
    await transition(mgrAgent, sel.studyUid, 'UNASSIGNED').expect(200);

    const res = await transition(mgrAgent, sel.studyUid, 'COMPLETED').expect(400);
    expect(res.body.message).toContain('Invalid status transition');
  });

  it('TRANS-3: manager can transition a study through receiving -> validating -> unassigned', async () => {
    const sel = await createStudy(cghAgent, 'Trans Happy Path');
    createdStudyIds.push(sel.studyId);

    await transition(mgrAgent, sel.studyUid, 'RECEIVING').expect(200);
    await transition(mgrAgent, sel.studyUid, 'VALIDATING').expect(200);
    await transition(mgrAgent, sel.studyUid, 'UNASSIGNED').expect(200);
  });
});

describe('Phase 1 security -- report content immutability', () => {
  let mgrAgent: any;
  let rad1Agent: any;
  let rad2Agent: any;

  beforeAll(async () => {
    mgrAgent = await loginAgent(server, manager);
    rad1Agent = await loginAgent(server, rad1);
    rad2Agent = await loginAgent(server, rad2);
  });

  async function newAssignedStudy(): Promise<string> {
    const cghAgent = await loginAgent(server, h_cgh);
    const sel = await createStudy(cghAgent, 'Immutability Patient');
    createdStudyIds.push(sel.studyId);
    await enableDicomOnStudy(sel.studyId);

    const radiologist = await prisma.user.findUnique({ where: { email: rad1.email } });
    if (!radiologist) throw new Error('radiologist not seeded');
    await assignStudy(mgrAgent, sel.studyUid, radiologist.id);
    return sel.studyUid;
  }

  it('IMM-1: manager cannot create report content (roles guard blocks non-radiologist)', async () => {
    const studyUid = await newAssignedStudy();
    const mgrUser = await prisma.user.findUnique({ where: { email: manager.email } });
    await mgrAgent
      .post(`/api/reports/${studyUid}`)
      .send({
        authorId: mgrUser!.id,
        findings: 'should not be writable by manager',
        impression: 'no',
      })
      .expect(403);
  });

  it('IMM-2: unassigned radiologist cannot create report content', async () => {
    const studyUid = await newAssignedStudy();
    const rad1User = await prisma.user.findUnique({ where: { email: rad1.email } });
    const rad2User = await prisma.user.findUnique({ where: { email: rad2.email } });
    await rad2Agent
      .post(`/api/reports/${studyUid}`)
      .send({
        authorId: rad2User!.id,
        findings: 'wrong radiologist',
        impression: 'no',
      })
      .expect(403);
  });

  it('IMM-3: assigned radiologist can create a draft report', async () => {
    const studyUid = await newAssignedStudy();
    const rad1User = await prisma.user.findUnique({ where: { email: rad1.email } });
    const res = await rad1Agent
      .post(`/api/reports/${studyUid}`)
      .send({
        authorId: rad1User!.id,
        findings: 'Normal chest',
        impression: 'No acute findings.',
      })
      .expect(201);
    expect(res.body.data.status).toBe('DRAFT');
  });

  it('IMM-4: manager cannot sign off a report (sign-off is radiologist-only)', async () => {
    const studyUid = await newAssignedStudy();
    const rad1User = await prisma.user.findUnique({ where: { email: rad1.email } });
    await rad1Agent
      .post(`/api/reports/${studyUid}`)
      .send({ authorId: rad1User!.id, findings: 'Findings', impression: 'Impression' })
      .expect(201);

    const mgrUser = await prisma.user.findUnique({ where: { email: manager.email } });
    await mgrAgent
      .post(`/api/reports/${studyUid}/sign`)
      .send({ signedOffBy: mgrUser!.id })
      .expect(403);
  });

  it('IMM-5: assigned radiologist signs and creates an immutable ReportVersion snapshot', async () => {
    const studyUid = await newAssignedStudy();
    const rad1User = await prisma.user.findUnique({ where: { email: rad1.email } });
    const created = await rad1Agent
      .post(`/api/reports/${studyUid}`)
      .send({ authorId: rad1User!.id, findings: 'Signed findings', impression: 'Signed impression' })
      .expect(201);
    const reportId = created.body.data.id;

    await rad1Agent
      .post(`/api/reports/${studyUid}/sign`)
      .send({ signedOffBy: rad1User!.id })
      .expect(201);

    const report = await prisma.report.findUnique({ where: { id: reportId } });
    expect(report?.status).toBe('SIGNED');
    expect(report?.signedOffBy).toBe(rad1User!.id);

    const version = await prisma.reportVersion.findFirst({
      where: { reportId },
      orderBy: { version: 'desc' },
    });
    expect(version).toBeTruthy();
    expect(version?.status).toBe('SIGNED');

    const study = await prisma.study.findUnique({ where: { studyInstanceUid: studyUid } });
    expect(study?.status).toBe('RADIOLOGIST_SIGNED');
  });
});

describe('Phase 1 security -- audit trail', () => {
  let mgrAgent: any;
  let rad1Agent: any;
  let cghAgent: any;

  beforeAll(async () => {
    mgrAgent = await loginAgent(server, manager);
    rad1Agent = await loginAgent(server, rad1);
    cghAgent = await loginAgent(server, h_cgh);
  });

  it('AUDIT-1: assignment records STUDY_ASSIGNED against ASSIGNMENT resource', async () => {
    const sel = await createStudy(cghAgent, 'Audit Assignment Patient');
    createdStudyIds.push(sel.studyId);
    await enableDicomOnStudy(sel.studyId);

    const radiologist = await prisma.user.findUnique({ where: { email: rad1.email } });
    const mgrUser = await prisma.user.findUnique({ where: { email: manager.email } });
    if (!radiologist || !mgrUser) throw new Error('seed users missing');
    await assignStudy(mgrAgent, sel.studyUid, radiologist.id);

    const res = await mgrAgent
      .get(`/api/audit?actorId=${mgrUser.id}&action=STUDY_ASSIGNED&resource=ASSIGNMENT`)
      .expect(200);
    const matches = (res.body.data as any[]).filter(
      (a) => (a.metadata?.studyUid as string) === sel.studyUid,
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it('AUDIT-2: report creation and sign-off are audited with REPORT_* actions', async () => {
    const sel = await createStudy(cghAgent, 'Audit Report Patient');
    createdStudyIds.push(sel.studyId);
    await enableDicomOnStudy(sel.studyId);

    const radiologist = await prisma.user.findUnique({ where: { email: rad1.email } });
    const mgrUser = await prisma.user.findUnique({ where: { email: manager.email } });
    if (!radiologist || !mgrUser) throw new Error('seed users missing');
    await assignStudy(mgrAgent, sel.studyUid, radiologist.id);

    await rad1Agent
      .post(`/api/reports/${sel.studyUid}`)
      .send({ authorId: radiologist.id, findings: 'Audit findings', impression: 'Audit impression' })
      .expect(201);
    await rad1Agent
      .post(`/api/reports/${sel.studyUid}/sign`)
      .send({ signedOffBy: radiologist.id })
      .expect(201);

    const res = await mgrAgent
      .get(`/api/audit?actorId=${radiologist.id}&resource=REPORT`)
      .expect(200);
    const actions = (res.body.data as any[]).map((a) => a.action);
    expect(actions).toContain('REPORT_CREATED');
    expect(actions).toContain('REPORT_SIGNED');
  });
});
