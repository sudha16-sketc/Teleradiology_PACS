import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { StudyStatus } from '@prisma/client';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';

let app: INestApplication;
let server: any;
let managerAgent: any;
let rad1Agent: any;
let rad2Agent: any;
let hospitalAgent: any;
let rad1Id: string;

const created: Array<{ studyId: string; patientId: string; reportIds: string[] }> = [];
const HOSPITAL_ID = 'hosp-001';

async function seedStudy(status: StudyStatus, assignedRadiologistId: string | null = rad1Id) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-RSM-${suffix}`,
      displayName: 'Report State Patient',
      hospitalId: HOSPITAL_ID,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid: `1.2.826.0.1.3680043.5.RSM-${suffix}`,
      accessionNumber: `AX-RSM-${suffix}`,
      patientId: patient.id,
      hospitalId: HOSPITAL_ID,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status,
      orthancStudyId: `orth-rsm-${suffix}`,
      orthancPatientId: `orthp-rsm-${suffix}`,
      assignedRadiologistId,
    },
  });
  const record = { studyId: study.id, patientId: patient.id, reportIds: [] as string[] };
  created.push(record);
  return { ...study, reportIds: record.reportIds };
}

async function seedDraft(
  status: StudyStatus = StudyStatus.REPORT_DRAFT,
  content: { findings?: string; impression?: string } = {
    findings: 'Draft findings',
    impression: 'Draft impression',
  },
) {
  const study = await seedStudy(status);
  const report = await prisma.report.create({
    data: {
      studyId: study.id,
      authorId: rad1Id,
      status: 'DRAFT',
      version: 1,
      findings: content.findings ?? '',
      impression: content.impression ?? '',
      contentHash: 'b'.repeat(64),
    },
  });
  study.reportIds.push(report.id);
  return { study, report };
}

async function seedSigned(status: StudyStatus, options: { version?: number } = {}) {
  const study = await seedStudy(status);
  const version = options.version ?? 1;
  const report = await prisma.report.create({
    data: {
      studyId: study.id,
      authorId: rad1Id,
      status: 'SIGNED',
      version,
      findings: 'Signed findings',
      impression: 'Signed impression',
      criticalFinding: false,
      signedOffBy: rad1Id,
      signedOffAt: new Date(),
      contentHash: 'c'.repeat(64),
    },
  });
  study.reportIds.push(report.id);
  await prisma.reportVersion.create({
    data: {
      reportId: report.id,
      version,
      status: 'SIGNED',
      findings: report.findings,
      impression: report.impression,
      authorId: rad1Id,
      contentHash: report.contentHash,
    },
  });
  await prisma.study.update({
    where: { id: study.id },
    data: {
      signedOffAt: new Date(),
      managerReviewedAt:
        status === StudyStatus.MANAGER_REVIEW ||
        status === StudyStatus.MANAGER_APPROVED ||
        status === StudyStatus.DELIVERED_TO_HOSPITAL ||
        status === StudyStatus.HOSPITAL_ACCEPTED ||
        status === StudyStatus.COMPLETED
          ? new Date()
          : null,
      managerApprovedAt:
        status === StudyStatus.MANAGER_APPROVED ||
        status === StudyStatus.DELIVERED_TO_HOSPITAL ||
        status === StudyStatus.HOSPITAL_ACCEPTED ||
        status === StudyStatus.COMPLETED
          ? new Date()
          : null,
      deliveredAt:
        status === StudyStatus.DELIVERED_TO_HOSPITAL ||
        status === StudyStatus.HOSPITAL_ACCEPTED ||
        status === StudyStatus.COMPLETED
          ? new Date()
          : null,
      hospitalAcceptedAt:
        status === StudyStatus.HOSPITAL_ACCEPTED || status === StudyStatus.COMPLETED
          ? new Date()
          : null,
      completedAt: status === StudyStatus.COMPLETED ? new Date() : null,
    },
  });
  return { study, report };
}

async function reportById(id: string) {
  return prisma.report.findUniqueOrThrow({ where: { id } });
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
  managerAgent = await loginAgent(server, USERS.MANAGER);
  rad1Agent = await loginAgent(server, USERS.RAD1);
  rad2Agent = await loginAgent(server, USERS.RAD2);
  hospitalAgent = await loginAgent(server, USERS.H_CGH);
  rad1Id = (await prisma.user.findUniqueOrThrow({ where: { email: USERS.RAD1.email } })).id;
});

afterAll(async () => {
  for (const record of created) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { resourceId: record.studyId },
          ...(record.reportIds.length ? [{ resourceId: { in: record.reportIds } }] : []),
        ],
      },
    });
    await prisma.reportVersion.deleteMany({
      where: { report: { studyId: record.studyId } },
    });
    await prisma.deliveryAttempt.deleteMany({ where: { studyId: record.studyId } });
    await prisma.report.deleteMany({ where: { studyId: record.studyId } });
    await prisma.study.delete({ where: { id: record.studyId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: record.patientId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
  await app.close();
});

describe('Report validation state machine', () => {
  it('does not sign an empty draft through validate', async () => {
    const { study, report } = await seedDraft(StudyStatus.REPORT_DRAFT, {
      findings: '',
      impression: '',
    });
    const res = await managerAgent
      .post(`/api/reports/${study.studyInstanceUid}/validate`)
      .send({ status: 'SIGNED' })
      .expect(409);

    expect(res.body.message).toBeTruthy();
    const after = await reportById(report.id);
    expect(after.status).toBe('DRAFT');
    expect(after.signedOffBy).toBeNull();
    expect(after.signedOffAt).toBeNull();
    expect(await prisma.reportVersion.count({ where: { reportId: report.id } })).toBe(0);
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
    expect(dbStudy.status).toBe(StudyStatus.REPORT_DRAFT);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: report.id, action: 'REPORT_VERIFIED' },
      }),
    ).toBe(0);
  });

  it('does not force MANAGER_REVIEW from COMPLETED', async () => {
    const { study, report } = await seedSigned(StudyStatus.COMPLETED);
    await managerAgent
      .post(`/api/reports/${study.studyInstanceUid}/validate`)
      .send({ status: 'SIGNED' })
      .expect(409);
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
    expect(dbStudy.status).toBe(StudyStatus.COMPLETED);
    expect((await reportById(report.id)).status).toBe('SIGNED');
  });

  it('does not revert a signed report to DRAFT', async () => {
    const { study, report } = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    const before = await reportById(report.id);
    const beforeVersion = await prisma.reportVersion.findFirstOrThrow({
      where: { reportId: report.id },
    });
    await managerAgent
      .post(`/api/reports/${study.studyInstanceUid}/validate`)
      .send({ status: 'DRAFT' })
      .expect(400);
    const after = await reportById(report.id);
    expect(after.status).toBe('SIGNED');
    expect(after.signedOffAt?.toISOString()).toBe(before.signedOffAt?.toISOString());
    expect(after.contentHash).toBe(before.contentHash);
    const afterVersion = await prisma.reportVersion.findFirstOrThrow({
      where: { reportId: report.id },
    });
    expect(afterVersion.contentHash).toBe(beforeVersion.contentHash);
  });

  it('accepts SIGNED validation only as the legal signed-report review transition', async () => {
    const { study, report } = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    await managerAgent
      .post(`/api/reports/${study.studyInstanceUid}/validate`)
      .send({ status: 'SIGNED' })
      .expect(201);
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
    expect(dbStudy.status).toBe(StudyStatus.MANAGER_REVIEW);
    expect((await reportById(report.id)).status).toBe('SIGNED');
    expect(
      await prisma.auditLog.count({
        where: { resourceId: report.id, action: 'REPORT_VERIFIED' },
      }),
    ).toBe(1);
  });

  it('rejects double verification, skipped release, and premature delivery', async () => {
    const reviewStudy = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    await managerAgent.post(`/api/reports/${reviewStudy.study.studyInstanceUid}/verify`).expect(201);
    await managerAgent.post(`/api/reports/${reviewStudy.study.studyInstanceUid}/verify`).expect(409);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: reviewStudy.report.id, action: 'REPORT_VERIFIED' },
      }),
    ).toBe(1);

    const releaseStudy = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    await managerAgent
      .post(`/api/reports/${releaseStudy.study.studyInstanceUid}/release`)
      .expect(409);
    expect((await prisma.study.findUniqueOrThrow({ where: { id: releaseStudy.study.id } })).status).toBe(
      StudyStatus.RADIOLOGIST_SIGNED,
    );

    const deliverStudy = await seedSigned(StudyStatus.MANAGER_REVIEW);
    await managerAgent
      .post(`/api/reports/${deliverStudy.study.studyInstanceUid}/deliver`)
      .expect(409);
    expect(
      await prisma.deliveryAttempt.count({ where: { studyId: deliverStudy.study.id } }),
    ).toBe(0);
  });

  it('rejects validation and workflow transitions from unauthorized roles', async () => {
    const { study } = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    for (const action of ['validate', 'verify', 'release', 'deliver']) {
      await rad1Agent
        .post(`/api/reports/${study.studyInstanceUid}/${action}`)
        .send(action === 'validate' ? { status: 'SIGNED' } : {})
        .expect(403);
      await hospitalAgent
        .post(`/api/reports/${study.studyInstanceUid}/${action}`)
        .send(action === 'validate' ? { status: 'SIGNED' } : {})
        .expect(403);
    }
  });

  it('rejects an unsupported validation target', async () => {
    const { study } = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    await managerAgent
      .post(`/api/reports/${study.studyInstanceUid}/validate`)
      .send({ status: 'MANAGER_APPROVED' })
      .expect(400);
  });

  it('allows only one concurrent sign and preserves one immutable version', async () => {
    const { study, report } = await seedDraft();
    const results = await Promise.allSettled([
      rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}),
      rad1Agent.post(`/api/reports/${study.studyInstanceUid}/sign`).send({}),
    ]);
    const statuses = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : 500,
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);
    expect(await prisma.reportVersion.count({ where: { reportId: report.id } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: report.id, action: 'REPORT_SIGNED' },
      }),
    ).toBe(1);
  });

  it('does not allow a generic status PATCH to sign an amended report', async () => {
    const { study } = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    await rad1Agent
      .post(`/api/reports/${study.studyInstanceUid}/amend`)
      .send({ findings: 'Amended findings', reason: 'Update impression' })
      .expect(201);
    await managerAgent
      .patch(`/api/studies/${study.studyInstanceUid}/status`)
      .send({ status: 'RADIOLOGIST_SIGNED' })
      .expect(403);
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
    expect(dbStudy.status).toBe(StudyStatus.REPORT_DRAFT);
  });
});

describe('Report amendment state machine', () => {
  it.each([
    StudyStatus.MANAGER_REVIEW,
    StudyStatus.MANAGER_APPROVED,
    StudyStatus.DELIVERED_TO_HOSPITAL,
    StudyStatus.HOSPITAL_ACCEPTED,
    StudyStatus.COMPLETED,
    StudyStatus.CORRECTION_REQUESTED,
  ])('rejects amendment from %s', async (status) => {
    const { study } = await seedSigned(status);
    await rad1Agent
      .post(`/api/reports/${study.studyInstanceUid}/amend`)
      .send({ reason: 'Should be rejected' })
      .expect(400);
    expect(await prisma.report.count({ where: { studyId: study.id } })).toBe(1);
  });

  it('rejects amendment from an unassigned radiologist and a non-signed latest version', async () => {
    const other = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    await rad2Agent
      .post(`/api/reports/${other.study.studyInstanceUid}/amend`)
      .send({ reason: 'Not assigned' })
      .expect(403);

    const draft = await seedDraft();
    await rad1Agent
      .post(`/api/reports/${draft.study.studyInstanceUid}/amend`)
      .send({ reason: 'Not signed' })
      .expect(400);
  });

  it('requires a reason and records amendment metadata atomically', async () => {
    const { study, report } = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    await rad1Agent
      .post(`/api/reports/${study.studyInstanceUid}/amend`)
      .send({ findings: 'No reason' })
      .expect(400);
    expect(await prisma.report.count({ where: { studyId: study.id } })).toBe(1);

    const res = await rad1Agent
      .post(`/api/reports/${study.studyInstanceUid}/amend`)
      .send({ findings: 'Amended findings', reason: 'Clarify impression' })
      .expect(201);
    expect(res.body.data.version).toBe(2);
    expect(res.body.data.status).toBe('DRAFT');

    const previous = await reportById(report.id);
    expect(previous.status).toBe('SIGNED');
    expect(previous.findings).toBe('Signed findings');
    const snapshot = await prisma.reportVersion.findFirstOrThrow({
      where: { reportId: report.id, version: 1 },
    });
    expect(snapshot.findings).toBe('Signed findings');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: res.body.data.id, action: 'REPORT_AMENDED' },
    });
    expect(audit.actorId).toBe(rad1Id);
    expect(audit.timestamp).toBeTruthy();
    expect(audit.metadata).toMatchObject({
      amendmentReason: 'Clarify impression',
      previousVersion: 1,
      newVersion: 2,
      amendedBy: rad1Id,
    });

    expect(
      await prisma.auditLog.count({
        where: { resourceId: study.id, action: 'STUDY_STATUS_CHANGED' },
      }),
    ).toBe(2);
    const dbStudy = await prisma.study.findUniqueOrThrow({ where: { id: study.id } });
    expect(dbStudy.status).toBe(StudyStatus.REPORT_DRAFT);
  });

  it('does not bypass signing, review, release, or delivery after amendment', async () => {
    const { study } = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    await rad1Agent
      .post(`/api/reports/${study.studyInstanceUid}/amend`)
      .send({ reason: 'Needs correction' })
      .expect(201);
    await rad1Agent.post(`/api/reports/${study.studyInstanceUid}/verify`).expect(403);
    await managerAgent.post(`/api/reports/${study.studyInstanceUid}/verify`).expect(409);
    await managerAgent.post(`/api/reports/${study.studyInstanceUid}/release`).expect(409);
    await managerAgent.post(`/api/reports/${study.studyInstanceUid}/deliver`).expect(409);
  });

  it('allows only one concurrent amendment to create a newer version', async () => {
    const { study, report } = await seedSigned(StudyStatus.RADIOLOGIST_SIGNED);
    const results = await Promise.allSettled([
      rad1Agent
        .post(`/api/reports/${study.studyInstanceUid}/amend`)
        .send({ reason: 'Concurrent amendment one' }),
      rad1Agent
        .post(`/api/reports/${study.studyInstanceUid}/amend`)
        .send({ reason: 'Concurrent amendment two' }),
    ]);
    const statuses = results.map((result) =>
      result.status === 'fulfilled' ? result.value.status : 500,
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(await prisma.report.count({ where: { studyId: study.id, version: 2 } })).toBe(1);
    expect((await reportById(report.id)).status).toBe('SIGNED');
  });
});
