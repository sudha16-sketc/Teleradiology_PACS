import 'reflect-metadata';
import request from 'supertest';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { StudyStatus } from '@prisma/client';

let app: INestApplication;
let server: any;

let studyId: string;
let patientId: string;
let studyInstanceUid: string;

const path = () => `/api/dicom-web/studies/${studyInstanceUid}/series`;

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;

  const rad1 = await prisma.user.findUniqueOrThrow({
    where: { email: USERS.RAD1.email },
    select: { id: true },
  });
  const hospital = await prisma.user.findUniqueOrThrow({
    where: { email: USERS.H_CGH.email },
    select: { hospitalId: true },
  });
  if (!hospital.hospitalId) throw new Error('CGH test user has no hospital');

  studyInstanceUid = `1.2.826.0.1.3680043.9.ohif.${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-OHIF-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: 'OHIF Auth Test',
      hospitalId: hospital.hospitalId,
      gender: 'U',
    },
  });
  patientId = patient.id;

  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber: `AX-OHIF-${Date.now()}`,
      patientId: patient.id,
      hospitalId: hospital.hospitalId,
      studyDate: new Date(),
      modality: 'MRI',
      bodyPart: 'BRAIN',
      status: StudyStatus.UNASSIGNED,
      orthancStudyId: `orth-${studyInstanceUid}`,
      orthancPatientId: `orthp-${studyInstanceUid}`,
      assignedRadiologistId: rad1.id,
    },
  });
  studyId = study.id;
});

afterAll(async () => {
  await prisma.study.deleteMany({ where: { id: studyId } }).catch(() => undefined);
  await prisma.patient.deleteMany({ where: { id: patientId } }).catch(() => undefined);
  await prisma.$disconnect();
  await app.close();
});

describe('single-login OHIF DICOMweb access', () => {
  it('returns 401 without a PACS session', async () => {
    await request(server).get(path()).expect(401);
  });

  it('returns 401 for an invalid session cookie', async () => {
    await request(server)
      .get(path())
      .set('Cookie', 'axis_session=not-a-signed-token')
      .expect(401);
  });

  it('returns 401 after logout revokes the session', async () => {
    const agent = await loginAgent(server, USERS.RAD1);
    await agent.post('/api/auth/logout');
    await agent.get(path()).expect(401);
  });

  it('rotates the Redis session on refresh without losing access', async () => {
    const agent = await loginAgent(server, USERS.RAD1);
    const refreshed = await agent.post('/api/auth/refresh').expect(201);
    expect(refreshed.body.data.success).toBe(true);
    await agent.get('/api/auth/me').expect(200);
    const res = await agent.get(path());
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('lets the assigned radiologist through the authorization gate', async () => {
    const agent = await loginAgent(server, USERS.RAD1);
    const res = await agent.get(path());
    expect([200, 404, 503]).toContain(res.status);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('returns 403 for an unassigned radiologist', async () => {
    const agent = await loginAgent(server, USERS.RAD2);
    await agent.get(path()).expect(403);
  });

  it('returns 403 for a different hospital', async () => {
    const agent = await loginAgent(server, USERS.H_MMC);
    await agent.get(path()).expect(403);
  });

  it('rejects DICOMweb mutations even for an assigned radiologist', async () => {
    const agent = await loginAgent(server, USERS.RAD1);
    await agent.post(path()).expect(405);
    await agent.put(path()).expect(405);
    await agent.delete(path()).expect(405);
  });

  it('does not forward accept-encoding or upstream compression headers', async () => {
    const agent = await loginAgent(server, USERS.RAD1);
    const upstream = new Response('[]', {
      status: 200,
      headers: {
        'content-type': 'application/dicom+json',
        'content-encoding': 'gzip',
        'content-length': '2',
      },
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);

    try {
      const res = await agent.get(path()).set('Accept-Encoding', 'gzip').expect(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.headers['content-length']).toBeUndefined();

      const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
      const forwarded = (init?.headers ?? {}) as Record<string, string>;
      expect(forwarded['accept-encoding']).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
