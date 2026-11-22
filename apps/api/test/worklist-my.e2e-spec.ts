import 'reflect-metadata';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import { WorklistService } from '../src/worklist/worklist.service.js';
import type { INestApplication } from '@nestjs/common';
import { ReportStatus, StudyStatus, UserRole, UserStatus } from '@prisma/client';

let app: INestApplication;
let server: any;

const CGH_HOSPITAL_ID = 'hosp-001';
const MMC_HOSPITAL_ID = 'hosp-002';
const PASSWORD = 'Worklist@12345';

const seededStudies: Array<{ id: string; patientId: string }> = [];
const seededUsers: string[] = [];

interface StudyFixture {
  id: string;
  studyInstanceUid: string;
  patientId: string;
}

interface UserFixture {
  id: string;
  email: string;
  password: string;
}

async function createUser(opts: {
  email: string;
  displayName: string;
  role: UserRole;
  status?: UserStatus;
  hospitalId?: string;
}): Promise<UserFixture> {
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      displayName: opts.displayName,
      role: opts.role,
      status: opts.status ?? UserStatus.APPROVED,
      isActive: true,
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      hospitalId: opts.hospitalId ?? null,
      phone: '+919876501234',
    },
  });
  seededUsers.push(user.id);
  return { id: user.id, email: user.email, password: PASSWORD };
}

async function seedStudy(opts: {
  hospitalId: string;
  status?: StudyStatus;
  assignedRadiologistId?: string;
  patientName?: string;
  withWorklistItem?: boolean;
}): Promise<StudyFixture> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const studyInstanceUid = `1.2.826.0.1.3680043.9.WL.${suffix}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-WL-${suffix}`,
      displayName: opts.patientName ?? 'Worklist Patient',
      hospitalId: opts.hospitalId,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber: `AX-WL-${suffix}`,
      patientId: patient.id,
      hospitalId: opts.hospitalId,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: opts.status ?? StudyStatus.UNASSIGNED,
      assignedRadiologistId: opts.assignedRadiologistId ?? null,
      orthancStudyId: `orth-${studyInstanceUid}`,
      orthancPatientId: `orthp-${studyInstanceUid}`,
    },
  });
  if (opts.withWorklistItem) {
    await prisma.worklistItem.create({
      data: { studyId: study.id, assignedAt: new Date() },
    });
  }
  seededStudies.push({ id: study.id, patientId: patient.id });
  return { id: study.id, studyInstanceUid, patientId: patient.id };
}

async function seedReport(studyId: string, authorId: string) {
  await prisma.report.create({
    data: {
      studyId,
      authorId,
      version: 1,
      status: ReportStatus.DRAFT,
      contentHash: 'worklist-my-test',
    },
  });
}

async function cleanupStudy(id: string, patientId: string) {
  await prisma.reportVersion.deleteMany({ where: { report: { studyId: id } } }).catch(() => undefined);
  await prisma.report.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.instance.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.series.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.worklistItem.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.assignment.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => undefined);
  await prisma.study.delete({ where: { id } }).catch(() => undefined);
  const remaining = await prisma.study.count({ where: { patientId } }).catch(() => 0);
  if (remaining === 0) {
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
  }
}

async function cleanupUser(id: string) {
  await prisma.notification.deleteMany({ where: { recipientUserId: id } }).catch(() => undefined);
  await prisma.report.deleteMany({ where: { authorId: id } }).catch(() => undefined);
  await prisma.assignment.deleteMany({
    where: { OR: [{ radiologistId: id }, { assignedById: id }] },
  }).catch(() => undefined);
  await prisma.auditLog.deleteMany({ where: { actorId: id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

function uids(body: any): string[] {
  if (!Array.isArray(body?.data)) {
    throw new Error(`unexpected worklist response: ${JSON.stringify(body)}`);
  }
  return body.data.map((item: any) => item.study?.studyInstanceUid).filter(Boolean);
}

function expectNoAuthorSecrets(item: any) {
  const author = item?.study?.reports?.[0]?.author;
  expect(author).toBeDefined();
  expect(author).not.toHaveProperty('passwordHash');
  expect(author).not.toHaveProperty('authVersion');
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
});

afterAll(async () => {
  for (const study of seededStudies) {
    await cleanupStudy(study.id, study.patientId);
  }
  for (const userId of seededUsers) {
    await cleanupUser(userId);
  }
  await prisma.$disconnect();
  await app.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/worklist/my', () => {
  let managerAgent: any;
  let adminAgent: any;
  let radAssignedAgent: any;
  let radOtherAgent: any;
  let hcgAgent: any;

  let radAssigned: UserFixture;
  let radOther: UserFixture;
  let hospitalWithoutScope: UserFixture;

  let assignedStudy: StudyFixture;
  let reassignedStudy: StudyFixture;
  let noOptionalStudy: StudyFixture;
  let inReadingStudy: StudyFixture;
  let signedStudy: StudyFixture;
  let managerQueueStudy: StudyFixture;
  let hospitalStudy: StudyFixture;
  let mmcStudy: StudyFixture;

  beforeAll(async () => {
    managerAgent = await loginAgent(server, USERS.MANAGER);
    adminAgent = await loginAgent(server, USERS.ADMIN);
    hcgAgent = await loginAgent(server, USERS.H_CGH);

    radAssigned = await createUser({
      email: `wl-rad-assigned-${Date.now()}@example.test`,
      displayName: 'Worklist Assigned Radiologist',
      role: UserRole.RADIOLOGIST,
    });
    radOther = await createUser({
      email: `wl-rad-other-${Date.now()}@example.test`,
      displayName: 'Worklist Other Radiologist',
      role: UserRole.RADIOLOGIST,
    });
    hospitalWithoutScope = await createUser({
      email: `wl-hospital-unscoped-${Date.now()}@example.test`,
      displayName: 'Worklist Hospital Without Scope',
      role: UserRole.HOSPITAL,
    });

    radAssignedAgent = await loginAgent(server, radAssigned);
    radOtherAgent = await loginAgent(server, radOther);

    assignedStudy = await seedStudy({
      hospitalId: CGH_HOSPITAL_ID,
      status: StudyStatus.ASSIGNED,
      assignedRadiologistId: radAssigned.id,
      withWorklistItem: true,
    });
    await seedReport(assignedStudy.id, radAssigned.id);

    reassignedStudy = await seedStudy({
      hospitalId: CGH_HOSPITAL_ID,
      status: StudyStatus.ASSIGNED,
      assignedRadiologistId: radAssigned.id,
    });
    noOptionalStudy = await seedStudy({
      hospitalId: CGH_HOSPITAL_ID,
      status: StudyStatus.UNASSIGNED,
    });
    inReadingStudy = await seedStudy({
      hospitalId: CGH_HOSPITAL_ID,
      status: StudyStatus.IN_READING,
      assignedRadiologistId: radAssigned.id,
    });
    signedStudy = await seedStudy({
      hospitalId: CGH_HOSPITAL_ID,
      status: StudyStatus.RADIOLOGIST_SIGNED,
      assignedRadiologistId: radAssigned.id,
    });
    managerQueueStudy = await seedStudy({
      hospitalId: CGH_HOSPITAL_ID,
      status: StudyStatus.MANAGER_APPROVED,
      withWorklistItem: true,
    });
    hospitalStudy = await seedStudy({
      hospitalId: CGH_HOSPITAL_ID,
      status: StudyStatus.HOSPITAL_ACCEPTED,
    });
    await seedReport(managerQueueStudy.id, radAssigned.id);
    await seedReport(hospitalStudy.id, radAssigned.id);
    mmcStudy = await seedStudy({
      hospitalId: MMC_HOSPITAL_ID,
      status: StudyStatus.UNASSIGNED,
    });
  });

  it('returns assigned studies with safe report-author fields', async () => {
    const res = await radAssignedAgent.get('/api/worklist/my').expect(200);
    expect(uids(res.body)).toContain(assignedStudy.studyInstanceUid);

    const item = res.body.data.find((entry: any) => entry.study?.studyInstanceUid === assignedStudy.studyInstanceUid);
    expect(item.study.assignedRadiologistId).toBe(radAssigned.id);
    expect(item.study.reports).toHaveLength(1);
    expect(item.study.reports[0].author.id).toBe(radAssigned.id);
    expect(item.study.reports[0].author).not.toHaveProperty('passwordHash');
    expect(item.study.reports[0].author).not.toHaveProperty('authVersion');
  });

  it('returns an empty worklist for a radiologist with no assignments', async () => {
    const res = await radOtherAgent.get('/api/worklist/my').expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('moves a reassigned study to the new radiologist worklist', async () => {
    const before = await radOtherAgent.get('/api/worklist/my').expect(200);
    expect(uids(before.body)).not.toContain(reassignedStudy.studyInstanceUid);

    const manager = await prisma.user.findUniqueOrThrow({ where: { email: USERS.MANAGER.email } });
    await managerAgent
      .post(`/api/worklist/${reassignedStudy.studyInstanceUid}/assign`)
      .send({ radiologistId: radOther.id })
      .expect(201);

    const previous = await radAssignedAgent.get('/api/worklist/my').expect(200);
    expect(uids(previous.body)).not.toContain(reassignedStudy.studyInstanceUid);
    const current = await radOtherAgent.get('/api/worklist/my').expect(200);
    expect(uids(current.body)).toContain(reassignedStudy.studyInstanceUid);
    expect(manager.role).toBe(UserRole.MANAGER);
  });

  it('handles studies without an assigned radiologist or reports', async () => {
    const res = await managerAgent.get('/api/worklist/my').expect(200);
    const item = res.body.data.find((entry: any) => entry.study?.studyInstanceUid === noOptionalStudy.studyInstanceUid);
    expect(item).toBeDefined();
    expect(item.study.assignedRadiologistId).toBeNull();
    expect(item.study.assignedRadiologist).toBeNull();
    expect(item.study.reports).toEqual([]);
  });

  it('applies the documented status sets for radiologist, manager/admin, and hospital roles', async () => {
    const radRes = await radAssignedAgent.get('/api/worklist/my').expect(200);
    expect(uids(radRes.body)).toContain(inReadingStudy.studyInstanceUid);
    expect(uids(radRes.body)).toContain(signedStudy.studyInstanceUid);
    expect(uids(radRes.body)).not.toContain(hospitalStudy.studyInstanceUid);

    const managerRes = await managerAgent.get('/api/worklist/my').expect(200);
    expect(uids(managerRes.body)).toContain(managerQueueStudy.studyInstanceUid);
    expect(uids(managerRes.body)).toContain(signedStudy.studyInstanceUid);
    expect(uids(managerRes.body)).not.toContain(inReadingStudy.studyInstanceUid);
    expect(uids(managerRes.body)).not.toContain(hospitalStudy.studyInstanceUid);

    const adminRes = await adminAgent.get('/api/worklist/my').expect(200);
    expect(uids(adminRes.body)).toContain(managerQueueStudy.studyInstanceUid);
    expect(uids(adminRes.body)).toContain(mmcStudy.studyInstanceUid);
    expectNoAuthorSecrets(
      adminRes.body.data.find((entry: any) => entry.study?.studyInstanceUid === managerQueueStudy.studyInstanceUid),
    );

    const hospitalRes = await hcgAgent.get('/api/worklist/my').expect(200);
    expect(uids(hospitalRes.body)).toContain(hospitalStudy.studyInstanceUid);
    expectNoAuthorSecrets(
      hospitalRes.body.data.find((entry: any) => entry.study?.studyInstanceUid === hospitalStudy.studyInstanceUid),
    );
    expect(uids(hospitalRes.body)).not.toContain(managerQueueStudy.studyInstanceUid);
    expect(uids(hospitalRes.body)).not.toContain(mmcStudy.studyInstanceUid);
  });

  it('preserves the documented global manager/admin queue and hospital-role isolation', async () => {
    const managerRes = await managerAgent.get('/api/worklist/my').expect(200);
    expect(uids(managerRes.body)).toContain(mmcStudy.studyInstanceUid);

    const hospitalRes = await hcgAgent.get('/api/worklist/my').expect(200);
    expect(uids(hospitalRes.body)).not.toContain(mmcStudy.studyInstanceUid);

    const denied = await hcgAgent.get(`/api/studies/${mmcStudy.studyInstanceUid}`).expect(403);
    expect(denied.body.message).toContain('access');
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(server).get('/api/worklist/my').expect(401);
    expect(res.body).not.toHaveProperty('data');
  });

  it('rejects a hospital user without hospital scope', async () => {
    const unscopedAgent = await loginAgent(server, hospitalWithoutScope);
    const res = await unscopedAgent.get('/api/worklist/my').expect(403);
    expect(res.body.message).toContain('hospital');
  });

  it('does not hide Prisma/database query failures', async () => {
    const worklistService = app.get(WorklistService);
    jest.spyOn(worklistService, 'my').mockRejectedValueOnce(new Error('simulated Prisma failure'));

    const res = await radAssignedAgent.get('/api/worklist/my').expect(500);
    expect(res.body.message).toBe('Internal server error');
    expect(res.body).not.toHaveProperty('data');
  });

  it('supports pagination and filtering on the general worklist', async () => {
    const manager = await prisma.user.findUniqueOrThrow({ where: { email: USERS.MANAGER.email } });
    const result = await app.get(WorklistService).list(
      { status: StudyStatus.ASSIGNED, page: '1', pageSize: '1' },
      { id: manager.id, role: UserRole.MANAGER },
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].study.status).toBe(StudyStatus.ASSIGNED);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.pageSize).toBe(1);
    expect(result.pagination.total).toBeGreaterThanOrEqual(1);
    expect(result.pagination.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('preserves radiologist and hospital isolation regressions', async () => {
    const assignedToOther = await seedStudy({
      hospitalId: MMC_HOSPITAL_ID,
      status: StudyStatus.ASSIGNED,
      assignedRadiologistId: radOther.id,
    });

    const radRes = await radAssignedAgent.get('/api/worklist/my').expect(200);
    expect(uids(radRes.body)).not.toContain(assignedToOther.studyInstanceUid);

    const hospitalRes = await hcgAgent.get('/api/worklist/my').expect(200);
    expect(uids(hospitalRes.body)).not.toContain(assignedToOther.studyInstanceUid);
  });
});
