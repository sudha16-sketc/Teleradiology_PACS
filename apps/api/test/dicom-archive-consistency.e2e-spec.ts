import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import { buildP10Dicom } from './dicom-fixture.js';
import { orthancBaseUrl } from '../src/common/config/orthanc-url.js';
import type { INestApplication } from '@nestjs/common';

let app: INestApplication;
let server: any;
let hospitalAgent: any;

const createdStudyIds: string[] = [];
const createdPatientIds: string[] = [];
const createdOrthancStudyIds: string[] = [];

const uid = () => `1.2.826.0.1.3680043.98.${Date.now()}.${parseInt(randomUUID().replace(/-/g, '').slice(0, 12), 16)}`;

function probeResponse(status: number, body?: unknown): globalThis.Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? {},
    body: { cancel: async () => undefined },
  } as unknown as globalThis.Response;
}

function normalizeUid(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .split('')
    .filter((char) => char !== '\u0000' && !/\s/.test(char))
    .join('');
}

async function createIndexedStudy(data: {
  imagingAvailability?: 'AVAILABLE' | 'MISSING';
  orthancStudyId?: string | null;
  status?: 'CANCELLED' | 'UNASSIGNED';
  withCounts?: boolean;
}): Promise<{ studyId: string; studyUid: string }> {
  const studyUid = uid();
  const patientId = `ARCH-${randomUUID().slice(0, 8)}`;
  const res = await hospitalAgent.post('/api/studies').send({
    patientName: 'Archive Consistency Patient',
    patientId,
    studyInstanceUid: studyUid,
    modality: 'CT',
  });
  expect(res.status).toBe(201);
  const studyId = res.body.data.id as string;
  createdStudyIds.push(studyId);
  createdPatientIds.push(res.body.data.patientId as string);

  await prisma.study.update({
    where: { id: studyId },
    data: {
      seriesCount: data.withCounts === false ? 0 : 1,
      instanceCount: data.withCounts === false ? 0 : 1,
      status: data.status ?? 'UNASSIGNED',
      imagingAvailability: data.imagingAvailability ?? 'MISSING',
      orthancStudyId: data.orthancStudyId ?? null,
      imagingCheckedAt: data.imagingAvailability === 'AVAILABLE' ? new Date() : null,
    },
  });
  return { studyId, studyUid };
}

async function cleanupCreated(): Promise<void> {
  for (const studyId of createdStudyIds.splice(0)) {
    await prisma.auditLog.deleteMany({ where: { resourceId: studyId } }).catch(() => undefined);
    await prisma.worklistItem.deleteMany({ where: { studyId } }).catch(() => undefined);
    await prisma.instance.deleteMany({ where: { studyId } }).catch(() => undefined);
    await prisma.series.deleteMany({ where: { studyId } }).catch(() => undefined);
    await prisma.study.delete({ where: { id: studyId } }).catch(() => undefined);
  }
  for (const patientId of createdPatientIds.splice(0)) {
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
  }
  const orthancBase = orthancBaseUrl();
  if (/localhost|127\.0\.0\.1|axis-orthanc/.test(orthancBase)) {
    for (const orthancStudyId of createdOrthancStudyIds.splice(0)) {
      await fetch(`${orthancBase}/studies/${encodeURIComponent(orthancStudyId)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  }
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
  hospitalAgent = await loginAgent(server, USERS.H_CGH);
});

afterEach(async () => {
  jest.restoreAllMocks();
  delete process.env.ORTHANC_USERNAME;
  delete process.env.ORTHANC_PASSWORD;
  await cleanupCreated();
});

afterAll(async () => {
  await cleanupCreated();
  await prisma.$disconnect();
  await app.close();
});

describe('DICOM archive consistency', () => {
  it('does not treat a DB-only cancelled study as an expected Orthanc study', async () => {
    await createIndexedStudy({
      status: 'CANCELLED',
      imagingAvailability: 'MISSING',
      orthancStudyId: null,
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) return probeResponse(200, []);
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready').expect(200);
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'up' });
      const qido = calls.find((call) => call.url.includes('/dicom-web/studies'));
      expect(qido?.url).toContain('limit=1');
      expect(qido?.url).not.toContain('StudyInstanceUID=');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('detects a verified study that is missing from Orthanc', async () => {
    const { studyUid } = await createIndexedStudy({
      status: 'UNASSIGNED',
      imagingAvailability: 'AVAILABLE',
      orthancStudyId: `orth-${randomUUID()}`,
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) return probeResponse(200, []);
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready').expect(200);
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'down' });
      const qido = calls.find((call) => call.url.includes('/dicom-web/studies'));
      expect(qido?.url).toContain(`StudyInstanceUID=${encodeURIComponent(studyUid)}`);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('matches the exact QIDO 0020000D value for a verified study', async () => {
    const { studyUid } = await createIndexedStudy({
      status: 'UNASSIGNED',
      imagingAvailability: 'AVAILABLE',
      orthancStudyId: `orth-${randomUUID()}`,
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) {
        return probeResponse(200, [{ '0020000D': { Value: [`  ${studyUid}\u0000`] } }]);
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

  it('reports DICOMweb down on an unexpected status', async () => {
    await createIndexedStudy({
      status: 'UNASSIGNED',
      imagingAvailability: 'AVAILABLE',
      orthancStudyId: `orth-${randomUUID()}`,
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) return probeResponse(503);
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready').expect(200);
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'down' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reports unauthorized DICOMweb probes and sends configured Orthanc credentials', async () => {
    process.env.ORTHANC_USERNAME = 'axis-probe-user';
    process.env.ORTHANC_PASSWORD = 'axis-probe-password';
    await createIndexedStudy({
      status: 'UNASSIGNED',
      imagingAvailability: 'AVAILABLE',
      orthancStudyId: `orth-${randomUUID()}`,
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/system')) return probeResponse(200);
      if (url.endsWith('/plugins')) return probeResponse(200, [{ Name: 'dicom-web' }]);
      if (url.includes('/dicom-web/studies')) return probeResponse(401);
      return probeResponse(200);
    });

    try {
      const res = await request(server).get('/api/health/ready').expect(200);
      const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
      expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'down' });
      const qido = calls.find((call) => call.url.includes('/dicom-web/studies'));
      expect(qido?.url.startsWith(orthancBaseUrl())).toBe(true);
      expect(qido?.init?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from('axis-probe-user:axis-probe-password').toString('base64')}`,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does not index a failed upload as an expected Orthanc study', async () => {
    const studyUid = uid();
    const raw = buildP10Dicom({
      studyUid,
      seriesUid: `${studyUid}.2`,
      sopUid: `${studyUid}.3`,
      modality: 'CT',
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/instances')) {
        return probeResponse(200, { Status: 'Rejected' });
      }
      return probeResponse(200);
    });

    try {
      const upload = await hospitalAgent
        .post('/api/dicom/ingest')
        .attach('file', raw, { filename: 'failed-upload.dcm', contentType: 'application/octet-stream' });
      expect(upload.status).toBe(503);
    } finally {
      fetchSpy.mockRestore();
    }

    const failed = await prisma.study.findUniqueOrThrow({ where: { studyInstanceUid: studyUid } });
    createdStudyIds.push(failed.id);
    createdPatientIds.push(failed.patientId);
    expect(failed.status).toBe('CANCELLED');
    expect(failed.imagingAvailability).not.toBe('AVAILABLE');
    expect(failed.orthancStudyId).toBeNull();
    expect(failed.seriesCount).toBe(0);
    expect(failed.instanceCount).toBe(0);

    const res = await request(server).get('/api/health/ready').expect(200);
    const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
    expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'up' });
  });

  it('keeps PostgreSQL and Orthanc consistent after synthetic upload finalization', async () => {
    const studyUid = uid();
    const seriesUid = `${studyUid}.2`;
    const sopUid = `${studyUid}.3`;
    const raw = buildP10Dicom({ studyUid, seriesUid, sopUid, modality: 'CT' });

    const upload = await hospitalAgent
      .post('/api/dicom/ingest')
      .attach('file', raw, { filename: 'archive-consistency.dcm', contentType: 'application/octet-stream' });
    expect(upload.status).toBe(201);

    const study = await prisma.study.findUniqueOrThrow({ where: { studyInstanceUid: studyUid } });
    createdStudyIds.push(study.id);
    createdPatientIds.push(study.patientId);
    expect(study.status).toBe('UNASSIGNED');
    expect(study.imagingAvailability).toBe('AVAILABLE');
    expect(study.orthancStudyId).toBeTruthy();
    expect(study.seriesCount).toBe(1);
    expect(study.instanceCount).toBe(1);
    createdOrthancStudyIds.push(study.orthancStudyId as string);

    const qido = await fetch(
      `${orthancBaseUrl()}/dicom-web/studies?StudyInstanceUID=${encodeURIComponent(studyUid)}`,
      { headers: { Accept: 'application/dicom+json' } },
    );
    expect(qido.status).toBe(200);
    const body = (await qido.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    const returnedUid = normalizeUid((body[0] as Record<string, { Value?: unknown[] }>)?.['0020000D']?.Value?.[0]);
    expect(returnedUid).toBe(normalizeUid(studyUid));

    const res = await request(server).get('/api/health/ready').expect(200);
    const dicomweb = res.body.components.find((component: { name: string }) => component.name === 'dicomweb');
    expect(dicomweb).toMatchObject({ name: 'dicomweb', status: 'up' });
  });
});
