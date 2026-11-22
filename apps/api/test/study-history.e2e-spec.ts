import 'reflect-metadata';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';

let app: INestApplication;
let server: any;
let hospitalAgent: any;
let otherHospitalAgent: any;
let attachmentDirectory: string;
const previousAttachmentDirectory = process.env.AXIS_STUDY_HISTORY_DIR;
const createdStudyIds: string[] = [];

async function createStudy(agent: any, overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const studyUid = `1.2.826.0.1.3680043.8.498.history.${suffix}`;
  const response = await agent.post('/api/studies').send({
    patientName: `History Patient ${suffix}`,
    patientAge: 42,
    gender: 'F',
    clinicalHistory: 'Persistent cough for three weeks.',
    studyInstanceUid: studyUid,
    modality: 'CT',
    bodyPart: 'CHEST',
    ...overrides,
  });
  if (response.status !== 201) {
    throw new Error(`Study creation failed ${response.status}: ${response.text}`);
  }
  createdStudyIds.push(response.body.data.id);
  return { studyUid, response };
}

beforeAll(async () => {
  attachmentDirectory = await mkdtemp(join(tmpdir(), 'axis-history-e2e-'));
  process.env.AXIS_STUDY_HISTORY_DIR = attachmentDirectory;
  const built = await createTestApp();
  app = built.app;
  server = built.server;
  hospitalAgent = await loginAgent(server, USERS.H_CGH);
  otherHospitalAgent = await loginAgent(server, USERS.H_MMC);
});

afterAll(async () => {
  if (createdStudyIds.length) {
    await prisma.studyHistoryAttachment.deleteMany({
      where: { studyId: { in: createdStudyIds } },
    });
    await prisma.study.deleteMany({
      where: { id: { in: createdStudyIds } },
    });
  }
  await app.close();
  await prisma.$disconnect();
  await rm(attachmentDirectory, { recursive: true, force: true });
  if (previousAttachmentDirectory === undefined) {
    delete process.env.AXIS_STUDY_HISTORY_DIR;
  } else {
    process.env.AXIS_STUDY_HISTORY_DIR = previousAttachmentDirectory;
  }
});

describe('Study history form', () => {
  it.each([
    ['patient name', 'patientName'],
    ['patient age', 'patientAge'],
    ['patient gender', 'gender'],
    ['clinical history', 'clinicalHistory'],
  ])('rejects a submission missing %s', async (_label, missingField) => {
    const body: Record<string, unknown> = {
      patientName: 'Required History Patient',
      patientAge: 30,
      gender: 'U',
      clinicalHistory: 'Required clinical history',
    };
    delete body[missingField];
    await hospitalAgent.post('/api/studies').send(body).expect(400);
  });

  it('stores the required history against the exact created study', async () => {
    const { studyUid } = await createStudy(hospitalAgent, {
      patientName: 'Study-scoped history',
      patientAge: 0,
      gender: 'O',
      clinicalHistory: 'Detailed symptom chronology and relevant findings.',
      referringPhysician: 'Dr. Example',
    });
    const storedStudy = await prisma.study.findUniqueOrThrow({
      where: { studyInstanceUid: studyUid },
      select: { historyCreatedAt: true },
    });
    expect(storedStudy.historyCreatedAt).toBeInstanceOf(Date);

    const response = await hospitalAgent
      .get(`/api/studies/${studyUid}/history`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      studyInstanceUid: studyUid,
      patientName: 'Study-scoped history',
      patientAge: 0,
      gender: 'O',
      referringPhysician: 'Dr. Example',
      clinicalHistory: 'Detailed symptom chronology and relevant findings.',
      attachment: null,
    });
  });

  it('allows the owning hospital to upload and retrieve one private supporting file', async () => {
    const { studyUid } = await createStudy(hospitalAgent);
    const pdf = Buffer.from('%PDF-1.4\nHistory document\n%%EOF');
    const upload = await hospitalAgent
      .post(`/api/studies/${studyUid}/history/attachments`)
      .attach('file', pdf, {
        filename: 'history-notes.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const attachmentId = upload.body.data.id as string;

    const history = await hospitalAgent
      .get(`/api/studies/${studyUid}/history`)
      .expect(200);
    expect(history.body.data.attachment).toMatchObject({
      id: attachmentId,
      originalName: 'history-notes.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
    });

    const download = await hospitalAgent
      .get(`/api/studies/history-attachments/${attachmentId}`)
      .expect(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain('history-notes.pdf');
    expect(Number(download.headers['content-length'])).toBe(pdf.length);

    await hospitalAgent
      .post(`/api/studies/${studyUid}/history/attachments`)
      .attach('file', pdf, {
        filename: 'second.pdf',
        contentType: 'application/pdf',
      })
      .expect(409);
  });

  it('rejects unsupported or mismatched attachment content', async () => {
    const { studyUid } = await createStudy(hospitalAgent);
    await hospitalAgent
      .post(`/api/studies/${studyUid}/history/attachments`)
      .attach('file', Buffer.from('<svg></svg>'), {
        filename: 'history.svg',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('enforces hospital tenant isolation for history and attachment downloads', async () => {
    const { studyUid } = await createStudy(hospitalAgent);
    const upload = await hospitalAgent
      .post(`/api/studies/${studyUid}/history/attachments`)
      .attach('file', Buffer.from('%PDF-1.4\nTenant document\n%%EOF'), {
        filename: 'tenant.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    await otherHospitalAgent
      .get(`/api/studies/${studyUid}/history`)
      .expect(403);
    await otherHospitalAgent
      .get(`/api/studies/history-attachments/${upload.body.data.id}`)
      .expect(403);
  });

  it('requires authentication for history access', async () => {
    const { studyUid } = await createStudy(hospitalAgent);
    await request(server).get(`/api/studies/${studyUid}/history`).expect(401);
  });
});
