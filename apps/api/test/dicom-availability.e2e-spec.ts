import 'reflect-metadata';
import request from 'supertest';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { StudyStatus } from '@prisma/client';

let app: INestApplication;
let server: any;
let adminAgent: ReturnType<typeof request.agent>;
let radAgent: ReturnType<typeof request.agent>;
let hospitalAgent: ReturnType<typeof request.agent>;

const CGH_HOSPITAL_ID = 'hosp-001';
const MMC_HOSPITAL_ID = 'hosp-002';

interface Seeded {
  studyId: string;
  patientId: string;
  studyUid: string;
  seriesUid: string;
  sopUid: string;
  reportId?: string;
  runIds: string[];
}

const seeded: Seeded[] = [];
const createdHospitalIds: string[] = [];

function jsonResponse(body: unknown, status = 200): globalThis.Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: { cancel: async () => undefined },
  } as unknown as globalThis.Response;
}

function padEven(value: string): Buffer {
  const buffer = Buffer.from(value, 'latin1');
  if (buffer.length % 2 === 0) return buffer;
  return Buffer.concat([buffer, Buffer.from([0])]);
}

function dicomElement(
  group: number,
  element: number,
  vr: string,
  value: string | Buffer,
): Buffer {
  const bytes = Buffer.isBuffer(value) ? value : padEven(value);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(element, 2);
  header.write(vr, 4, 2, 'latin1');
  header.writeUInt16LE(bytes.length, 6);
  return Buffer.concat([header, bytes]);
}

function makeDicom(studyUid: string, seriesUid: string, sopUid: string): Buffer {
  const transferSyntax = dicomElement(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
  const groupLength = Buffer.alloc(4);
  groupLength.writeUInt32LE(transferSyntax.length, 0);

  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM', 'latin1'),
    dicomElement(0x0002, 0x0000, 'UL', groupLength),
    transferSyntax,
    dicomElement(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
    dicomElement(0x0008, 0x0018, 'UI', sopUid),
    dicomElement(0x0008, 0x0020, 'DA', '19950922'),
    dicomElement(0x0008, 0x0030, 'TM', '121803'),
    dicomElement(0x0008, 0x0060, 'CS', 'CT'),
    dicomElement(0x0010, 0x0010, 'PN', 'Test^Patient'),
    dicomElement(0x0010, 0x0020, 'LO', 'P-AVAILABILITY'),
    dicomElement(0x0020, 0x000d, 'UI', studyUid),
    dicomElement(0x0020, 0x000e, 'UI', seriesUid),
    dicomElement(0x0020, 0x0011, 'IS', '1'),
    dicomElement(0x0020, 0x0013, 'IS', '1'),
  ]);
}

async function createIsolatedHospital(): Promise<string> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const hospital = await prisma.hospital.create({
    data: {
      name: 'Availability Test Hospital',
      code: `AVAIL-${suffix}`,
    },
  });
  createdHospitalIds.push(hospital.id);
  return hospital.id;
}

async function seedStudy(opts: {
  hospitalId: string;
  withHierarchy?: boolean;
  withReport?: boolean;
  withAssignment?: boolean;
}): Promise<Seeded> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const studyUid = `1.2.826.0.1.3680043.99.${suffix}.1`;
  const seriesUid = `1.2.826.0.1.3680043.99.${suffix}.2`;
  const sopUid = `1.2.826.0.1.3680043.99.${suffix}.3`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-AVAIL-${suffix}`,
      displayName: 'Availability Patient',
      hospitalId: opts.hospitalId,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid: studyUid,
      accessionNumber: `AX-AVAIL-${suffix}`,
      patientId: patient.id,
      hospitalId: opts.hospitalId,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: opts.withAssignment ? StudyStatus.ASSIGNED : StudyStatus.UNASSIGNED,
      orthancStudyId: null,
      seriesCount: opts.withHierarchy ? 1 : 0,
      instanceCount: opts.withHierarchy ? 1 : 0,
    },
  });

  if (opts.withHierarchy) {
    const series = await prisma.series.create({
      data: {
        seriesInstanceUid: seriesUid,
        studyId: study.id,
        modality: 'CT',
        seriesNumber: 1,
        instanceCount: 1,
      },
    });
    await prisma.instance.create({
      data: {
        sopInstanceUid: sopUid,
        seriesId: series.id,
        studyId: study.id,
        instanceNumber: 1,
        sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
      },
    });
  }

  let reportId: string | undefined;
  if (opts.withReport) {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: USERS.ADMIN.email },
    });
    const report = await prisma.report.create({
      data: {
        studyId: study.id,
        authorId: admin.id,
        contentHash: `hash-${suffix}`,
        findings: 'Preserved finding',
        contentHtml: '<p>Preserved finding</p>',
      },
    });
    reportId = report.id;
  }

  if (opts.withAssignment) {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: USERS.ADMIN.email },
    });
    const radiologist = await prisma.user.findUniqueOrThrow({
      where: { email: USERS.RAD1.email },
    });
    await prisma.assignment.create({
      data: {
        studyId: study.id,
        radiologistId: radiologist.id,
        assignedById: admin.id,
      },
    });
  }

  const entry: Seeded = {
    studyId: study.id,
    patientId: patient.id,
    studyUid,
    seriesUid,
    sopUid,
    reportId,
    runIds: [],
  };
  seeded.push(entry);
  return entry;
}

function mockOrthanc(opts: {
  qido?: unknown[];
  series?: unknown[];
  instances?: unknown[];
  fail?: boolean;
}) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (opts.fail) throw new Error('offline');
    const url = String(input);
    if (init?.method === 'POST' && url.endsWith('/instances')) {
      return jsonResponse({
        Status: 'Success',
        ID: 'orth-instance',
        ParentSeries: 'orth-series',
        ParentStudy: 'orth-study',
        ParentPatient: 'orth-patient',
      });
    }
    if (url.includes('/dicom-web/studies?StudyInstanceUID=')) {
      return jsonResponse(opts.qido ?? []);
    }
    if (url.includes('/dicom-web/studies/') && url.includes('/series/')) {
      return jsonResponse(opts.instances ?? []);
    }
    if (url.includes('/dicom-web/studies/') && url.includes('/series')) {
      return jsonResponse(opts.series ?? []);
    }
    return jsonResponse([]);
  });
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
  adminAgent = await loginAgent(server, USERS.ADMIN);
  radAgent = await loginAgent(server, USERS.RAD1);
  hospitalAgent = await loginAgent(server, USERS.H_CGH);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  for (const item of seeded) {
    for (const runId of item.runIds) {
      await prisma.auditLog.deleteMany({ where: { resourceId: runId } }).catch(() => undefined);
      await prisma.studyReconciliationRun.deleteMany({ where: { id: runId } }).catch(() => undefined);
    }
    await prisma.auditLog.deleteMany({ where: { resourceId: item.studyId } }).catch(() => undefined);
    await prisma.report.deleteMany({ where: { studyId: item.studyId } }).catch(() => undefined);
    await prisma.assignment.deleteMany({ where: { studyId: item.studyId } }).catch(() => undefined);
    await prisma.instance.deleteMany({ where: { studyId: item.studyId } }).catch(() => undefined);
    await prisma.series.deleteMany({ where: { studyId: item.studyId } }).catch(() => undefined);
    await prisma.worklistItem.deleteMany({ where: { studyId: item.studyId } }).catch(() => undefined);
    await prisma.study.delete({ where: { id: item.studyId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: item.patientId } }).catch(() => undefined);
  }
  for (const hospitalId of createdHospitalIds) {
    await prisma.hospital.delete({ where: { id: hospitalId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
  await app.close();
});

describe('DICOM imaging availability', () => {
  it('marks a study available only when QIDO, series, and instances all match', async () => {
    const item = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, withHierarchy: true });
    mockOrthanc({
      qido: [{ '0020000D': { Value: [item.studyUid] } }],
      series: [{ '0020000E': { Value: [item.seriesUid] } }],
      instances: [{ '00080018': { Value: [item.sopUid] } }],
    });

    const res = await adminAgent
      .get(`/api/dicom-web/availability/${encodeURIComponent(item.studyUid)}`)
      .expect(200);
    expect(res.body.data.state).toBe('AVAILABLE');

    const stored = await prisma.study.findUniqueOrThrow({ where: { id: item.studyId } });
    expect(stored.imagingAvailability).toBe('AVAILABLE');
  });

  it('marks an empty QIDO result as MISSING and preserves reports and assignments', async () => {
    const item = await seedStudy({
      hospitalId: CGH_HOSPITAL_ID,
      withHierarchy: true,
      withReport: true,
      withAssignment: true,
    });
    mockOrthanc({ qido: [] });

    const res = await adminAgent
      .get(`/api/dicom-web/availability/${encodeURIComponent(item.studyUid)}`)
      .expect(200);
    expect(res.body.data.state).toBe('MISSING');

    const report = await adminAgent.get(`/api/reports/${encodeURIComponent(item.studyUid)}`);
    expect(report.status).toBe(200);
    const assignment = await prisma.assignment.count({
      where: { studyId: item.studyId, isActive: true },
    });
    expect(assignment).toBe(1);
  });

  it('distinguishes a temporarily unavailable imaging service', async () => {
    const item = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, withHierarchy: true });
    mockOrthanc({ fail: true });

    const res = await adminAgent
      .get(`/api/dicom-web/availability/${encodeURIComponent(item.studyUid)}`)
      .expect(200);
    expect(res.body.data.state).toBe('UNAVAILABLE');
  });

  it('marks an indexed study with absent series as INCOMPLETE', async () => {
    const item = await seedStudy({ hospitalId: CGH_HOSPITAL_ID, withHierarchy: true });
    mockOrthanc({ qido: [{ '0020000D': { Value: [item.studyUid] } }], series: [] });

    const res = await adminAgent
      .get(`/api/dicom-web/availability/${encodeURIComponent(item.studyUid)}`)
      .expect(200);
    expect(res.body.data.state).toBe('INCOMPLETE');
  });

  it('enforces hospital isolation for availability checks', async () => {
    const item = await seedStudy({ hospitalId: MMC_HOSPITAL_ID, withHierarchy: true });
    await hospitalAgent
      .get(`/api/dicom-web/availability/${encodeURIComponent(item.studyUid)}`)
      .expect(403);
  });
});

describe('Verified DICOM recovery', () => {
  it('rejects a file whose StudyInstanceUID does not match the record', async () => {
    const item = await seedStudy({ hospitalId: CGH_HOSPITAL_ID });
    const wrongUid = `${item.studyUid}.9`;
    const buffer = makeDicom(wrongUid, item.seriesUid, item.sopUid);

    await adminAgent
      .post(`/api/dicom/reingest/${encodeURIComponent(item.studyUid)}`)
      .attach('file', buffer, { filename: 'wrong.dcm', contentType: 'application/dicom' })
      .expect(400);

    const instances = await prisma.instance.count({ where: { studyId: item.studyId } });
    expect(instances).toBe(0);
  });

  it('re-ingests valid original files and is idempotent', async () => {
    const item = await seedStudy({ hospitalId: CGH_HOSPITAL_ID });
    const buffer = makeDicom(item.studyUid, item.seriesUid, item.sopUid);
    const fetchMock = mockOrthanc({
      qido: [{ '0020000D': { Value: [item.studyUid] } }],
      series: [{ '0020000E': { Value: [item.seriesUid] } }],
      instances: [{ '00080018': { Value: [item.sopUid] } }],
    });

    const first = await adminAgent
      .post(`/api/dicom/reingest/${encodeURIComponent(item.studyUid)}`)
      .attach('file', buffer, { filename: 'original.dcm', contentType: 'application/dicom' })
      .expect(201);
    expect(first.body.data.availability.state).toBe('AVAILABLE');

    const countsAfterFirst = await prisma.instance.count({ where: { studyId: item.studyId } });
    expect(countsAfterFirst).toBe(1);

    fetchMock.mockClear();
    await adminAgent
      .post(`/api/dicom/reingest/${encodeURIComponent(item.studyUid)}`)
      .attach('file', buffer, { filename: 'original.dcm', contentType: 'application/dicom' })
      .expect(201);

    expect(await prisma.instance.count({ where: { studyId: item.studyId } })).toBe(1);
    const stored = await prisma.study.findUniqueOrThrow({ where: { id: item.studyId } });
    expect(stored.imagingAvailability).toBe('AVAILABLE');
  });
});

describe('Administrative reconciliation', () => {
  it('is forbidden for radiologists', async () => {
    await radAgent.post('/api/admin/dicom-reconciliation').send({ pageSize: 1 }).expect(403);
  });

  it('records paginated findings for administrators', async () => {
    const hospitalId = await createIsolatedHospital();
    const item = await seedStudy({ hospitalId, withHierarchy: true });
    mockOrthanc({ qido: [] });

    const res = await adminAgent
      .post('/api/admin/dicom-reconciliation')
      .send({ page: 1, pageSize: 50, hospitalId })
      .expect(201);
    item.runIds.push(res.body.data.id);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studyInstanceUid: item.studyUid, state: 'MISSING' }),
      ]),
    );

    const list = await adminAgent.get('/api/admin/dicom-reconciliation').expect(200);
    expect(list.body.meta.pageSize).toBe(20);
  });
});
