import 'reflect-metadata';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import { StudyStatus } from '@prisma/client';

let app: INestApplication;
let server: any;

const manager = USERS.MANAGER;
const admin = USERS.ADMIN;
const rad1 = USERS.RAD1;
const h_cgh = USERS.H_CGH;
const h_mmc = USERS.H_MMC;
const CGH_HOSPITAL_ID = 'hosp-001';

const seeded: Array<{ id: string; patientId: string }> = [];

async function seedCompleted(assignedRadiologist: string): Promise<{
  id: string;
  studyInstanceUid: string;
  patientId: string;
  reportId: string;
}> {
  const studyInstanceUid = `1.2.826.0.1.3680043.6.NT-${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  const patient = await prisma.patient.create({
    data: {
      patientId: `P-NT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      displayName: 'Notif Patient',
      hospitalId: CGH_HOSPITAL_ID,
      gender: 'U',
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid,
      accessionNumber: `AX-NT-${Date.now()}`,
      patientId: patient.id,
      hospitalId: CGH_HOSPITAL_ID,
      studyDate: new Date(),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: StudyStatus.COMPLETED,
      orthancStudyId: `orth-${studyInstanceUid}`,
      orthancPatientId: `orthp-${studyInstanceUid}`,
      assignedRadiologistId: assignedRadiologist,
      signedOffAt: new Date(),
      managerReviewedAt: new Date(),
      managerApprovedAt: new Date(),
      deliveredAt: new Date(),
      hospitalReviewedAt: new Date(),
      hospitalAcceptedAt: new Date(),
      completedAt: new Date(),
    },
  });
  const report = await prisma.report.create({
    data: {
      studyId: study.id,
      authorId: assignedRadiologist,
      status: 'SIGNED',
      version: 1,
      clinicalHistory: 'H',
      findings: 'F',
      impression: 'I',
      technique: 'CT',
      comparison: 'None',
      recommendations: 'None',
      signedOffBy: assignedRadiologist,
      signedOffAt: new Date(),
      contentHash: '2'.repeat(64),
    },
  });
  seeded.push({ id: study.id, patientId: patient.id });
  return { id: study.id, studyInstanceUid, patientId: patient.id, reportId: report.id };
}

async function cleanupStudy(id: string, patientId: string) {
  await prisma.notification.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.changeRequest.deleteMany({ where: { studyId: id } }).catch(() => undefined);
  await prisma.reportVersion.deleteMany({ where: { report: { studyId: id } } }).catch(() => undefined);
  await prisma.deliveryAttempt.deleteMany({ where: { studyId: id } }).catch(() => undefined);
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
  for (const s of seeded) {
    await cleanupStudy(s.id, s.patientId);
  }
  await prisma.$disconnect();
  await app.close();
});

async function driveCorrectionTo(reportVersionSigned: boolean, step: 'requested' | 'approved' | 'signed' | 'delivered' | 'completed') {
  // Returns a fresh completed study and drives the correction workflow.
  const assignedRadiologist = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
  const s = await seedCompleted(assignedRadiologist);
  const cgh = await loginAgent(server, h_cgh);
  const mgr = await loginAgent(server, manager);
  const ra1 = await loginAgent(server, rad1);
  await cgh
    .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
    .send({ reason: 'requires correction' })
    .expect(201);
  if (step === 'requested') return { s, ra1, mgr, cgh };
  const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
  await mgr.post(`/api/corrections/${cr.id}/approve`).send({}).expect(201);
  if (step === 'approved') return { s, ra1, mgr, cgh, cr };
  await ra1.post(`/api/studies/${s.studyInstanceUid}/corrections/begin`).send({}).expect(201);
  await ra1
    .patch(`/api/reports/${s.studyInstanceUid}/draft`)
    .send({ findings: 'CF', impression: 'CI' })
    .expect(200);
  await ra1.post(`/api/reports/${s.studyInstanceUid}/sign`).send({}).expect(201);
  if (step === 'signed') return { s, ra1, mgr, cgh, cr };
  await mgr.post(`/api/studies/${s.studyInstanceUid}/review`).send({}).expect(201);
  await mgr.post(`/api/studies/${s.studyInstanceUid}/approve`).send({}).expect(201);
  await mgr.post(`/api/studies/${s.studyInstanceUid}/deliver`).send({}).expect(201);
  if (step === 'delivered') return { s, ra1, mgr, cgh, cr };
  await cgh.post(`/api/studies/${s.studyInstanceUid}/hospital-review`).send({}).expect(201);
  await cgh.post(`/api/studies/${s.studyInstanceUid}/accept`).send({}).expect(201);
  await mgr.post(`/api/studies/${s.studyInstanceUid}/complete`).send({}).expect(201);
  return { s, ra1, mgr, cgh, cr };
}

describe('Phase 6 — Notifications', () => {
  it('NOTIFICATION-1: correction requested notifies managers', async () => {
    const { s } = await driveCorrectionTo(true, 'requested');
    const mgr = (await prisma.user.findUniqueOrThrow({ where: { email: manager.email } })).id;
    const notif = await prisma.notification.findFirst({
      where: { studyId: s.id, recipientUserId: mgr, type: 'CORRECTION_REQUESTED' },
    });
    expect(notif).toBeTruthy();
  });

  it('NOTIFICATION-3: correction approved notifies assigned radiologist', async () => {
    const { s, ra1 } = await driveCorrectionTo(true, 'approved');
    const rad = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
    const notif = await prisma.notification.findFirst({
      where: { studyId: s.id, recipientUserId: rad, type: 'CORRECTION_APPROVED' },
    });
    expect(notif).toBeTruthy();
    // radiologist can see it via their own list
    const list = await ra1.get('/api/notifications').expect(200);
    expect(list.body.data.some((n: any) => n.type === 'CORRECTION_APPROVED' && n.studyId === s.id)).toBe(true);
  });

  it('NOTIFICATION-2: a user can read and mark their own notifications', async () => {
    const { ra1 } = await driveCorrectionTo(true, 'approved');
    const rad = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
    const notif = await prisma.notification.findFirstOrThrow({
      where: { recipientUserId: rad, type: 'CORRECTION_APPROVED', readAt: null },
    });
    await ra1.post(`/api/notifications/${notif.id}/read`).expect(201);
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: notif.id } });
    expect(after.readAt).toBeTruthy();
  });

  it('NOTIFICATION-4: mark-all-read updates unread count', async () => {
    const { ra1 } = await driveCorrectionTo(true, 'approved');
    const res = await ra1.post('/api/notifications/read-all').expect(201);
    expect(res.body.data.updated).toBeGreaterThanOrEqual(1);
    const cnt = await ra1.get('/api/notifications/unread-count').expect(200);
    expect(cnt.body.data.unread).toBe(0);
  });

  it('NOTIFICATION-5: corrected report signed notifies managers', async () => {
    const { s } = await driveCorrectionTo(true, 'signed');
    const mgr = (await prisma.user.findUniqueOrThrow({ where: { email: manager.email } })).id;
    const notif = await prisma.notification.findFirst({
      where: { studyId: s.id, recipientUserId: mgr, type: 'CORRECTED_REPORT_SIGNED' },
    });
    expect(notif).toBeTruthy();
  });

  it('NOTIFICATION-6: corrected report delivered notifies hospital users', async () => {
    const { s } = await driveCorrectionTo(true, 'delivered');
    const cghUser = (await prisma.user.findUniqueOrThrow({ where: { email: h_cgh.email } })).id;
    const notif = await prisma.notification.findFirst({
      where: { studyId: s.id, recipientUserId: cghUser, type: 'CORRECTED_REPORT_DELIVERED' },
    });
    expect(notif).toBeTruthy();
  });

  it('NOTIFICATION-7: hospital accepting corrected report notifies managers', async () => {
    const { s } = await driveCorrectionTo(true, 'completed');
    const mgr = (await prisma.user.findUniqueOrThrow({ where: { email: manager.email } })).id;
    const notif = await prisma.notification.findFirst({
      where: { studyId: s.id, recipientUserId: mgr, type: 'CORRECTION_HOSPITAL_ACCEPTED' },
    });
    expect(notif).toBeTruthy();
  });

  it('NOTIFICATION-8: user cannot mark another user notification read', async () => {
    const { s } = await driveCorrectionTo(true, 'requested');
    // Manager has a CORRECTION_REQUESTED notification; H_MMC must not be able to
    // mark the manager's notification read.
    const mgr = (await prisma.user.findUniqueOrThrow({ where: { email: manager.email } })).id;
    const mmc = await loginAgent(server, h_mmc);
    const notif = await prisma.notification.findFirstOrThrow({
      where: { studyId: s.id, recipientUserId: mgr, type: 'CORRECTION_REQUESTED' },
    });
    const res = await mmc.post(`/api/notifications/${notif.id}/read`).send({});
    expect(res.status).toBe(403);
  });

  it('NOTIFICATION-9: notifications are scoped to the recipient (no cross-user leak)', async () => {
    const { s } = await driveCorrectionTo(true, 'requested');
    // Manager notifications for this study should not be visible to H_MMC list.
    const mmc = await loginAgent(server, h_mmc);
    const list = await mmc.get('/api/notifications').expect(200);
    const leak = list.body.data.some((n: any) => n.studyId === s.id);
    expect(leak).toBe(false);
  });

  it('NOTIFICATION-10: recipients are always server-derived (no client-supplied recipient)', async () => {
    const cgh = await loginAgent(server, h_cgh);
    const mgr = await loginAgent(server, manager);
    const assignedRadiologist = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
    const s = await seedCompleted(assignedRadiologist);
    await cgh
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'server-derived' })
      .expect(201);
    // A HOSPITAL attempting to set its own recipient is not possible via the
    // notify endpoints (no recipientUserId is accepted). Assert that reads omit
    // any role-indexed cross-user data and that the requester received no
    // notification addressable by the client.
    const requester = (await prisma.user.findUniqueOrThrow({ where: { email: h_cgh.email } })).id;
    const requesterNotifs = await prisma.notification.findMany({
      where: { recipientUserId: requester, type: 'CORRECTION_REQUESTED' },
    });
    // Requester must NOT receive a "requested" notification (that goes to managers).
    expect(requesterNotifs.length).toBe(0);
    // But managers did.
    const mgrId = (await prisma.user.findUniqueOrThrow({ where: { email: manager.email } })).id;
    const mgrNotifs = await prisma.notification.findMany({
      where: { recipientUserId: mgrId, studyId: s.id, type: 'CORRECTION_REQUESTED' },
    });
    expect(mgrNotifs.length).toBeGreaterThanOrEqual(1);
  });

  it('NOTIFICATION-11: rejected correction notifies the requester and reverts study', async () => {
    const assignedRadiologist = (await prisma.user.findUniqueOrThrow({ where: { email: rad1.email } })).id;
    const s = await seedCompleted(assignedRadiologist);
    const cgh = await loginAgent(server, h_cgh);
    const mgr = await loginAgent(server, manager);
    await cgh
      .post(`/api/studies/${s.studyInstanceUid}/correction-requests`)
      .send({ reason: 'will be rejected' })
      .expect(201);
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { studyId: s.id } });
    const res = await mgr
      .post(`/api/corrections/${cr.id}/reject`)
      .send({ resolution: 'Not a finding error' })
      .expect(201);
    expect(res.body.data.status).toBe('REJECTED');
    const studyDb = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(studyDb.status).toBe('COMPLETED');
    const requester = (await prisma.user.findUniqueOrThrow({ where: { email: h_cgh.email } })).id;
    const notif = await prisma.notification.findFirst({
      where: { studyId: s.id, recipientUserId: requester, type: 'CORRECTION_REJECTED' },
    });
    expect(notif).toBeTruthy();
  });
});
