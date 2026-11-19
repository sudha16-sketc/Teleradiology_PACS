import 'reflect-metadata';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { StudyStatus } from '@prisma/client';

let app: INestApplication;
let server: any;
let adminAgent: any;
let studyId: string;
let patientId: string;
let studyUid: string;
let compositeId: string;

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
  adminAgent = await loginAgent(server, USERS.ADMIN);

  const hospital = await prisma.user.findUniqueOrThrow({
    where: { email: USERS.H_CGH.email },
    select: { hospitalId: true },
  });
  if (!hospital.hospitalId) throw new Error('CGH test user has no hospital');

  const mrnSuffix = `556342B-${Date.now()}`;
  studyUid = `1.2.826.0.1.3680043.9.ids.${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `hosp-001:${mrnSuffix}`,
      displayName: 'Identifier Mapping Test',
      hospitalId: hospital.hospitalId,
      gender: 'U',
    },
  });
  patientId = patient.id;

  const study = await prisma.study.create({
    data: {
      studyInstanceUid: studyUid,
      accessionNumber: `AX-IDS-${Date.now()}`,
      patientId: patient.id,
      hospitalId: hospital.hospitalId,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: StudyStatus.UNASSIGNED,
    },
  });
  studyId = study.id;
  compositeId = `${study.id}:${mrnSuffix}`;
});

afterAll(async () => {
  await prisma.study.deleteMany({ where: { id: studyId } }).catch(() => undefined);
  await prisma.patient.deleteMany({ where: { id: patientId } }).catch(() => undefined);
  await prisma.$disconnect();
  await app.close();
});

describe('study identifier mapping', () => {
  it('resolves an internal id plus MRN suffix to the canonical DICOM UID', async () => {
    const studyRes = await adminAgent
      .get(`/api/studies/${encodeURIComponent(compositeId)}`)
      .expect(200);
    expect(studyRes.body.data.id).toBe(studyId);
    expect(studyRes.body.data.studyInstanceUid).toBe(studyUid);

    const reportRes = await adminAgent
      .get(`/api/reports/${encodeURIComponent(compositeId)}`)
      .expect(200);
    expect(reportRes.body).toHaveProperty('data');
  });

  it('rejects a composite identifier with the wrong MRN suffix', async () => {
    await adminAgent
      .get(`/api/studies/${encodeURIComponent(`${studyId}:WRONG`)}`)
      .expect(404);
  });

  it('does not accept a composite identifier as a DICOM UID', async () => {
    await adminAgent
      .get(`/api/dicom-web/availability/${encodeURIComponent(compositeId)}`)
      .expect(400);
  });
});
