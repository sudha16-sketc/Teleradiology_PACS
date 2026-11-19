import 'reflect-metadata';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { Modality, StudyStatus } from '@prisma/client';
import { unlink } from 'fs/promises';
import path from 'path';

let app: INestApplication;
let server: any;

const CGH_HOSPITAL_ID = 'hosp-001';
const seeded: Array<{ id: string; patientId: string }> = [];
const templateIds: string[] = [];
const imageFiles: string[] = [];

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function seedStudy(opts: {
  assignedRadiologist: string;
  modality?: Modality;
  status?: StudyStatus;
}): Promise<{ id: string; studyInstanceUid: string; patientId: string }> {
  const studyInstanceUid = `1.2.826.0.1.3680043.9.RE-${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-RE-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: 'Report Editor Patient',
      hospitalId: CGH_HOSPITAL_ID,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber: `AX-RE-${Date.now()}`,
      patientId: patient.id,
      hospitalId: CGH_HOSPITAL_ID,
      studyDate: new Date(),
      modality: opts.modality ?? 'CT',
      bodyPart: 'CHEST',
      status: opts.status ?? StudyStatus.ASSIGNED,
      orthancStudyId: `orth-${studyInstanceUid}`,
      orthancPatientId: `orthp-${studyInstanceUid}`,
      assignedRadiologistId: opts.assignedRadiologist,
    },
  });
  seeded.push({ id: study.id, patientId: patient.id });
  return { id: study.id, studyInstanceUid, patientId: patient.id };
}

async function cleanupStudy(id: string, patientId: string) {
  await prisma.reportImage.deleteMany({ where: { studyId: id } }).catch(() => undefined);
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

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
});

afterAll(async () => {
  for (const image of await prisma.reportImage.findMany({
    where: { studyId: { in: seeded.map((s) => s.id) } },
    select: { storageKey: true },
  })) {
    imageFiles.push(image.storageKey);
  }
  for (const s of seeded) {
    await cleanupStudy(s.id, s.patientId);
  }
  if (templateIds.length > 0) {
    await prisma.reportTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(() => undefined);
  }
  const storageDir = process.env.AXIS_REPORT_IMAGE_DIR ?? path.join(process.cwd(), 'uploads', 'report-images');
  for (const storageKey of imageFiles) {
    await unlink(path.join(storageDir, storageKey)).catch(() => undefined);
  }
  await prisma.$disconnect();
  await app.close();
});

describe('Report editor and template workflow', () => {
  let rad1Agent: any;
  let rad2Agent: any;
  let managerAgent: any;
  let cghAgent: any;
  let rad1Id: string;
  let originalCompany: any;

  beforeAll(async () => {
    rad1Agent = await loginAgent(server, USERS.RAD1);
    rad2Agent = await loginAgent(server, USERS.RAD2);
    managerAgent = await loginAgent(server, USERS.MANAGER);
    cghAgent = await loginAgent(server, USERS.H_CGH);
    rad1Id = (await prisma.user.findUniqueOrThrow({ where: { email: USERS.RAD1.email } })).id;
    originalCompany = await prisma.companySettings.findUnique({ where: { id: 'default' } });
  });

  afterAll(async () => {
    if (originalCompany) {
      await prisma.companySettings.upsert({
        where: { id: 'default' },
        create: { ...originalCompany },
        update: {
          name: originalCompany.name,
          phone: originalCompany.phone,
          email: originalCompany.email,
          description: originalCompany.description,
          disclaimer: originalCompany.disclaimer,
          updatedById: originalCompany.updatedById,
        },
      });
    } else {
      await prisma.companySettings.deleteMany({ where: { id: 'default' } });
    }
  });

  it('company settings are readable and only managers/admins can update them', async () => {
    await rad1Agent.get('/api/company-settings').expect(200);

    await rad1Agent
      .put('/api/company-settings')
      .send({ name: 'Forbidden Radiology' })
      .expect(403);

    const updated = await managerAgent
      .put('/api/company-settings')
      .send({
        name: 'Axis Radiology E2E',
        phone: '5550100100',
        email: 'reports@example.test',
        disclaimer: 'Confidential diagnostic report.',
      })
      .expect(200);

    expect(updated.body.data.name).toBe('Axis Radiology E2E');
    expect(updated.body.data.phone).toBe('+915550100100');

    const read = await rad1Agent.get('/api/company-settings').expect(200);
    expect(read.body.data.name).toBe('Axis Radiology E2E');
  });

  it('template preview data is returned and loading it into a report does not modify the template', async () => {
    const study = await seedStudy({ assignedRadiologist: rad1Id });
    const templateHtml =
      '<h2>Findings</h2><p>No acute abnormality.</p><script>alert(1)</script><p onclick="alert(2)">Reviewed.</p>';

    const created = await managerAgent
      .post('/api/templates')
      .send({
        name: `E2E Template ${Date.now()}`,
        description: 'Template preview and load verification',
        modality: 'CT',
        bodyPart: 'CHEST',
        contentHtml: templateHtml,
        isActive: true,
      })
      .expect(201);

    const templateId = created.body.data.id;
    templateIds.push(templateId);
    const sanitizedHtml = created.body.data.contentHtml;
    expect(sanitizedHtml).toContain('No acute abnormality');
    expect(sanitizedHtml).not.toContain('<script');
    expect(sanitizedHtml).not.toContain('onclick');

    const available = await rad1Agent
      .get(`/api/templates/for-study/${encodeURIComponent(study.studyInstanceUid)}`)
      .expect(200);
    const preview = available.body.data.find((t: any) => t.id === templateId);
    expect(preview).toBeTruthy();
    expect(preview.name).toBe(created.body.data.name);
    expect(preview.contentHtml).toBe(sanitizedHtml);

    const report = await rad1Agent
      .post(`/api/reports/${encodeURIComponent(study.studyInstanceUid)}`)
      .send({ contentHtml: preview.contentHtml, criticalFinding: false })
      .expect(201);
    expect(report.body.data.contentHtml).toBe(sanitizedHtml);

    const unchanged = await managerAgent
      .get(`/api/templates/${encodeURIComponent(templateId)}`)
      .expect(200);
    expect(unchanged.body.data.contentHtml).toBe(sanitizedHtml);
    expect(unchanged.body.data.name).toBe(created.body.data.name);
  });

  it('report images upload, stream, enforce access, and delete', async () => {
    const study = await seedStudy({ assignedRadiologist: rad1Id });
    await rad1Agent
      .post(`/api/reports/${encodeURIComponent(study.studyInstanceUid)}`)
      .send({ contentHtml: '<h2>Findings</h2><p>Draft for image test.</p>' })
      .expect(201);

    const uploaded = await rad1Agent
      .post(`/api/reports/${encodeURIComponent(study.studyInstanceUid)}/images`)
      .attach('file', TINY_PNG, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(201);

    const imageId = uploaded.body.data.id;
    expect(uploaded.body.data.url).toBe(`/api/reports/images/${imageId}`);
    expect(uploaded.body.data.mimeType).toBe('image/png');
    imageFiles.push(uploaded.body.data.storageKey);

    const streamed = await rad1Agent.get(`/api/reports/images/${imageId}`).expect(200);
    expect(streamed.headers['content-type']).toContain('image/png');
    expect(streamed.headers['x-content-type-options']).toBe('nosniff');

    await rad2Agent.get(`/api/reports/images/${imageId}`).expect(403);
    await cghAgent.get(`/api/reports/images/${imageId}`).expect(403);
    await managerAgent.get(`/api/reports/images/${imageId}`).expect(200);

    await rad2Agent
      .post(`/api/reports/${encodeURIComponent(study.studyInstanceUid)}/images`)
      .attach('file', TINY_PNG, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(403);

    await rad1Agent
      .post(`/api/reports/${encodeURIComponent(study.studyInstanceUid)}/images`)
      .attach('file', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);

    await rad1Agent.delete(`/api/reports/images/${imageId}`).expect(200);
    await rad1Agent.get(`/api/reports/images/${imageId}`).expect(404);
  });

  it('rich report content is persisted and preserved by legacy draft saves', async () => {
    const study = await seedStudy({ assignedRadiologist: rad1Id });
    const richHtml = '<h2>Findings</h2><p>Rich <strong>content</strong>.</p>';

    await rad1Agent
      .post(`/api/reports/${encodeURIComponent(study.studyInstanceUid)}`)
      .send({ contentHtml: richHtml, criticalFinding: false })
      .expect(201);

    await rad1Agent
      .patch(`/api/reports/${encodeURIComponent(study.studyInstanceUid)}/draft`)
      .send({ findings: 'Legacy findings', impression: 'Legacy impression' })
      .expect(200);

    const read = await rad1Agent
      .get(`/api/reports/${encodeURIComponent(study.studyInstanceUid)}`)
      .expect(200);
    expect(read.body.data.contentHtml).toBe(richHtml);
    expect(read.body.data.findings).toBe('Legacy findings');
    expect(read.body.data.impression).toBe('Legacy impression');
    expect(read.body.data.studyId).toBe(study.id);
  });
});
