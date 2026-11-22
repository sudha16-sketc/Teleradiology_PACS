import 'reflect-metadata';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import { buildP10Dicom } from './dicom-fixture.js';
import { orthancBaseUrl } from '../src/common/config/orthanc-url.js';
import * as dicomCompression from '../src/dicom/dicom-compression.js';
import type { INestApplication } from '@nestjs/common';

jest.mock('../src/dicom/dicom-compression.js', () => {
  const actual = jest.requireActual('../src/dicom/dicom-compression.js');
  return {
    ...actual,
    compressDicomBuffer: jest.fn(),
    compressDicomBufferDetailed: jest.fn(),
  };
});

let app: INestApplication;
let server: any;
let hospitalAgent: any;

const ORTHANC_TEST_USERNAME = process.env.ORTHANC_USERNAME ?? 'orthanc';
const ORTHANC_TEST_PASSWORD = process.env.ORTHANC_PASSWORD ?? 'orthanc';

function orthancAuthHeader(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${ORTHANC_TEST_USERNAME}:${ORTHANC_TEST_PASSWORD}`).toString('base64')}`,
  };
}

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

function compressionFailure(
  failureStage = 'verify_pixel_integrity',
): dicomCompression.DicomCompressionError {
  return new dicomCompression.DicomCompressionError(
    'Lossless DICOM compression or pixel verification failed',
    {
      stage: failureStage,
      errorType: 'LosslessCompressionError',
      message: 'Synthetic compression failure',
      metadata: {
        source_transfer_syntax: '1.2.840.10008.1.2.4.50',
        target_transfer_syntax: '1.2.840.10008.1.2.4.90',
        rows: 8,
        columns: 8,
      },
    },
    failureStage,
  );
}

const compressMock = jest.mocked(dicomCompression.compressDicomBuffer);
const compressDetailedMock = jest.mocked(dicomCompression.compressDicomBufferDetailed);

function resetCompressionMock(): void {
  compressMock.mockReset();
  compressMock.mockImplementation(async (buffer) => buffer);
  compressDetailedMock.mockReset();
  compressDetailedMock.mockImplementation(async (buffer) => {
    const hash = createHash('sha256').update(buffer).digest('hex');
    return {
      buffer,
      pixelHash: hash,
      provenance: {
        sourceTransferSyntax: '1.2.840.10008.1.2.4.50',
        targetTransferSyntax: '1.2.840.10008.1.2.4.90',
        sourceCompressionType: 'jpeg-baseline',
        priorLossyCompression: true,
        lossyImageCompression: '01',
        lossyMethod: 'ISO_10918_1',
        lossyRatio: '4.0',
        reencodePolicyVersion: 'jpeg-baseline-lossless-v1',
        sourcePixelSha256: hash,
        outputPixelSha256: hash,
        pixelVerified: true,
      },
    };
  });
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
        headers: orthancAuthHeader(),
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

beforeEach(() => {
  resetCompressionMock();
});

afterEach(async () => {
  jest.restoreAllMocks();
  process.env.ORTHANC_USERNAME = ORTHANC_TEST_USERNAME;
  process.env.ORTHANC_PASSWORD = ORTHANC_TEST_PASSWORD;
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
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const upload = await hospitalAgent
      .post('/api/dicom/ingest')
      .attach('file', raw, { filename: 'archive-consistency.dcm', contentType: 'application/octet-stream' });
    expect(upload.status).toBe(201);

    const postIndex = fetchSpy.mock.calls.findIndex(([input, init]) => (
      String(input).endsWith('/instances') && init?.method === 'POST'
    ));
    expect(postIndex).toBeGreaterThanOrEqual(0);
    expect(fetchSpy.mock.invocationCallOrder[postIndex]).toBeGreaterThan(
      compressDetailedMock.mock.invocationCallOrder[0],
    );

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
      { headers: { ...orthancAuthHeader(), Accept: 'application/dicom+json' } },
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

  it('associates each provenance entry with its indexed instance', async () => {
    const studyUid = uid();
    const firstSopUid = `${studyUid}.31`;
    const secondSopUid = `${studyUid}.32`;
    const raws = [
      buildP10Dicom({ studyUid, seriesUid: `${studyUid}.3`, sopUid: firstSopUid, modality: 'CT' }),
      buildP10Dicom({ studyUid, seriesUid: `${studyUid}.3`, sopUid: secondSopUid, modality: 'CT' }),
    ];

    const upload = await hospitalAgent
      .post('/api/dicom/ingest')
      .attach('file', raws[0], { filename: 'instance-one.dcm', contentType: 'application/octet-stream' })
      .attach('file', raws[1], { filename: 'instance-two.dcm', contentType: 'application/octet-stream' });
    expect(upload.status).toBe(201);

    const study = await prisma.study.findUniqueOrThrow({ where: { studyInstanceUid: studyUid } });
    createdStudyIds.push(study.id);
    createdPatientIds.push(study.patientId);
    if (study.orthancStudyId) createdOrthancStudyIds.push(study.orthancStudyId);

    const instances = await prisma.instance.findMany({
      where: { studyId: study.id },
      select: { id: true, sopInstanceUid: true },
    });
    expect(instances).toHaveLength(2);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: study.id, action: 'DICOM_IMPORTED' },
      orderBy: { timestamp: 'desc' },
    });
    const metadata = audit.metadata as Record<string, unknown>;
    const provenance = metadata.compressionProvenance as Array<Record<string, unknown>>;
    expect(provenance).toHaveLength(2);
    expect(metadata.compressionProvenanceCount).toBe(2);
    expect(metadata.sourcePixelSha256).toBeUndefined();
    expect(metadata.outputPixelSha256).toBeUndefined();

    const expectedSopByKey = new Map(
      [firstSopUid, secondSopUid].map((sopUid) => [
        createHash('sha256')
          .update('axis-dicom-instance-key:v1\0')
          .update(sopUid)
          .digest('hex'),
        sopUid,
      ]),
    );
    const keys = new Set<string>();
    for (const entry of provenance) {
      expect(typeof entry.instanceId).toBe('string');
      expect(entry.instanceKey).toMatch(/^[a-f0-9]{64}$/);
      const expectedSopUid = expectedSopByKey.get(entry.instanceKey as string);
      expect(expectedSopUid).toBeTruthy();
      const linkedInstance = instances.find((instance) => instance.id === entry.instanceId);
      expect(normalizeUid(linkedInstance?.sopInstanceUid)).toBe(expectedSopUid);
      keys.add(entry.instanceKey as string);
    }
    expect(keys.size).toBe(2);
    const auditText = JSON.stringify(audit.metadata);
    expect(auditText).not.toContain(firstSopUid);
    expect(auditText).not.toContain(secondSopUid);
  });

  it.each([
    'validate_lossy_history',
    'encode_jpeg2000_lossless',
    'verify_pixel_integrity',
  ])('fails ingest before the Orthanc POST when %s fails', async (failureStage) => {
    const studyUid = uid();
    const raw = buildP10Dicom({
      studyUid,
      seriesUid: `${studyUid}.2`,
      sopUid: `${studyUid}.3`,
      modality: 'CT',
    });
    compressDetailedMock.mockRejectedValue(compressionFailure(failureStage));
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init });
      return probeResponse(200);
    });

    const upload = await hospitalAgent
      .post('/api/dicom/ingest')
      .attach('file', raw, { filename: 'compression-failure.dcm', contentType: 'application/octet-stream' });
    expect(upload.status).toBe(503);
    expect(calls.some((call) => call.url.endsWith('/instances') && call.init?.method === 'POST')).toBe(false);

    const failed = await prisma.study.findUniqueOrThrow({ where: { studyInstanceUid: studyUid } });
    createdStudyIds.push(failed.id);
    createdPatientIds.push(failed.patientId);
    expect(failed.status).toBe('CANCELLED');
    expect(failed.imagingAvailability).not.toBe('AVAILABLE');
    expect(failed.orthancStudyId).toBeNull();
    expect(failed.seriesCount).toBe(0);
    expect(failed.instanceCount).toBe(0);

    const failureAudit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: failed.id, action: 'DICOM_IMPORT_FAILED' },
      orderBy: { timestamp: 'desc' },
    });
    expect(failureAudit.correlationId).toBeTruthy();
    expect(failureAudit.metadata).toMatchObject({
      status: 'FAILED',
      failureStage,
      sourceTransferSyntax: '1.2.840.10008.1.2.4.50',
      targetTransferSyntax: '1.2.840.10008.1.2.4.90',
    });
    expect(
      await prisma.auditLog.findFirst({
        where: { resourceId: failed.id, action: 'DICOM_IMPORTED' },
      }),
    ).toBeNull();
  });

  it('leaves existing imaging intact when reingest compression fails', async () => {
    const { studyId, studyUid } = await createIndexedStudy({
      status: 'UNASSIGNED',
      imagingAvailability: 'AVAILABLE',
      orthancStudyId: 'orth-existing',
    });
    const seriesUid = `${studyUid}.2`;
    const sopUid = `${studyUid}.3`;
    const series = await prisma.series.create({
      data: {
        seriesInstanceUid: seriesUid,
        studyId,
        modality: 'CT',
        seriesNumber: 1,
        instanceCount: 1,
        orthancSeriesId: 'orth-series-existing',
      },
    });
    const instance = await prisma.instance.create({
      data: {
        sopInstanceUid: sopUid,
        seriesId: series.id,
        studyId,
        instanceNumber: 1,
        sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
        orthancInstanceId: 'orth-instance-existing',
      },
    });
    const raw = buildP10Dicom({ studyUid, seriesUid, sopUid, modality: 'CT' });
    compressDetailedMock.mockRejectedValue(compressionFailure());
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init });
      return probeResponse(200);
    });

    const res = await hospitalAgent
      .post(`/api/dicom/reingest/${encodeURIComponent(studyUid)}`)
      .attach('file', raw, { filename: 'failed-reingest.dcm', contentType: 'application/octet-stream' });
    expect(res.status).toBe(503);
    expect(calls.some((call) => call.url.endsWith('/instances') && call.init?.method === 'POST')).toBe(false);

    const preservedInstance = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(preservedInstance.orthancInstanceId).toBe('orth-instance-existing');
    const preservedStudy = await prisma.study.findUniqueOrThrow({ where: { id: studyId } });
    expect(preservedStudy.imagingAvailability).toBe('AVAILABLE');
    expect(preservedStudy.orthancStudyId).toBe('orth-existing');
    expect(preservedStudy.instanceCount).toBe(1);

    const failureAudit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: studyId, action: 'DICOM_REINGEST' },
      orderBy: { timestamp: 'desc' },
    });
    expect(failureAudit.metadata).toMatchObject({
      status: 'FAILED',
      failureStage: 'verify_pixel_integrity',
      sourceTransferSyntax: '1.2.840.10008.1.2.4.50',
    });
  });
});
