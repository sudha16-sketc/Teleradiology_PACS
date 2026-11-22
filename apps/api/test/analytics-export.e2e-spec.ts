import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { hash } from 'bcryptjs';
import ExcelJS from 'exceljs';
import type { INestApplication } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS, type Agent } from './helpers.js';

const HOSPITAL_A = 'hosp-001';
const HOSPITAL_B = 'hosp-002';
const BATCH_RECORDS = 501;
const MIS_HEADERS = [
  'Center / Site',
  'Patient-Id',
  'Patient-Name',
  'Patient Age',
  'Gender',
  'Modality',
  'StudyName/ Study Discrption',
  'ImageCount',
  'Referring Physician Name',
  'Status',
  'Priority',
  'noOfReports',
  'studyDateTime',
  'uploadCompletedAt',
  'historyCreatedAt',
  'assignedAt',
  'signedOffAt',
  'Verified At',
  'Study Assigned By',
  'Study Assigned To',
  'Study Reported By',
  'Study Verified By',
  'TurnAroundTime',
  'TatAssignedToSSignedOff',
];

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let managerAgent: Agent;
let unscopedManagerAgent: Agent;
let adminAgent: Agent;
let hospitalAgent: Agent;
let managerId: string;
let otherHospitalPatientId: string;
let reportId: string;
let richStudyId: string;
let batchPatientIds: string[] = [];
let patientRowIds: string[] = [];
let studyIds: string[] = [];
let reportIds: string[] = [];

const suffix = randomUUID().replace(/-/g, '');
const managerEmail = `mis-manager-${suffix}@axis.test`;
const managerPassword = `Mis-Export-${suffix}`;
const receivedAt = new Date('2026-03-16T08:00:00.000Z');
const uploadCompletedAt = new Date('2026-03-16T08:05:00.000Z');
const reingestCompletedAt = new Date('2026-03-16T08:06:00.000Z');
const historyCreatedAt = new Date('2026-03-16T08:07:00.000Z');
const assignedAt = new Date('2026-03-16T09:00:00.000Z');
const signedOffAt = new Date('2026-03-16T09:45:00.000Z');
const verifiedAt = new Date('2026-03-16T10:00:00.000Z');
const completedAt = new Date('2026-03-16T11:00:00.000Z');

async function workbookFor(agent: Agent, path = '/api/analytics/mis-report') {
  const response = await agent
    .get(path)
    .buffer(true)
    .parse((stream, callback) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('error', callback);
      stream.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  expect(response.headers['content-type']).toContain(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(response.headers['content-disposition']).toContain('MIS-Report.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([response.body]));
  return { workbook, response };
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = app.getHttpServer();

  const manager = await prisma.user.create({
    data: {
      email: managerEmail,
      displayName: 'Scoped MIS Manager',
      role: UserRole.MANAGER,
      hospitalId: HOSPITAL_A,
      passwordHash: await hash(managerPassword, 10),
      status: UserStatus.APPROVED,
      isActive: true,
    },
    select: { id: true },
  });
  managerId = manager.id;

  const radiologist = await prisma.user.findUniqueOrThrow({
    where: { email: USERS.RAD1.email },
    select: { id: true },
  });
  const secondRadiologist = await prisma.user.findUniqueOrThrow({
    where: { email: USERS.RAD2.email },
    select: { id: true },
  });

  const richPatientExternalId = `MIS-RICH-${suffix}`;
  const richPatient = await prisma.patient.create({
    data: {
      patientId: `${HOSPITAL_A}:${richPatientExternalId}`,
      displayName: 'MIS Mapping Patient',
      gender: 'M',
      hospitalId: HOSPITAL_A,
    },
  });
  patientRowIds.push(richPatient.id);

  const richStudy = await prisma.study.create({
    data: {
      studyInstanceUid: `1.2.826.0.1.3680043.8.498.${Date.now()}.${Math.floor(Math.random() * 1e6)}`,
      accessionNumber: `MIS-RICH-${suffix}`,
      patientId: richPatient.id,
      hospitalId: HOSPITAL_A,
      patientAge: 63,
      historyCreatedAt,
      studyDate: new Date('2026-03-16T00:00:00.000Z'),
      studyDateProvided: true,
      studyTime: '101112',
      sourceModality: 'OT',
      modality: 'CT',
      bodyPart: 'CHEST',
      studyDescription: 'MIS mapping chest study',
      referringPhysician: 'Dr. History Form',
      instanceCount: 12,
      status: 'COMPLETED',
      priority: 'URGENT',
      receivedAt,
      createdAt: new Date('2026-03-16T07:55:00.000Z'),
      assignedAt,
      assignedBy: managerId,
      assignedRadiologistId: radiologist.id,
      signedOffAt,
      managerReviewedAt: new Date(verifiedAt.getTime() + 1_000),
      managerApprovedAt: new Date('2026-03-16T10:15:00.000Z'),
      deliveredAt: new Date('2026-03-16T10:20:00.000Z'),
      hospitalAcceptedAt: new Date('2026-03-16T10:30:00.000Z'),
      completedAt,
    },
    select: { id: true },
  });
  richStudyId = richStudy.id;
  studyIds.push(richStudy.id);

  const signedReport = await prisma.report.create({
    data: {
      studyId: richStudy.id,
      authorId: radiologist.id,
      status: 'SIGNED',
      version: 1,
      signedOffBy: secondRadiologist.id,
      signedOffAt,
      contentHash: 'a'.repeat(64),
    },
    select: { id: true },
  });
  reportId = signedReport.id;
  reportIds.push(signedReport.id);

  await prisma.report.create({
    data: {
      studyId: richStudy.id,
      authorId: secondRadiologist.id,
      status: 'DRAFT',
      version: 2,
      contentHash: 'b'.repeat(64),
    },
  });

  await prisma.assignment.create({
    data: {
      studyId: richStudy.id,
      radiologistId: radiologist.id,
      assignedById: managerId,
      assignedAt,
      isActive: true,
    },
  });

  const negativePatient = await prisma.patient.create({
    data: {
      patientId: `MIS-NEGATIVE-${suffix}`,
      displayName: 'Negative TAT Patient',
      hospitalId: HOSPITAL_A,
    },
    select: { id: true },
  });
  patientRowIds.push(negativePatient.id);
  const negativeStudy = await prisma.study.create({
    data: {
      studyInstanceUid: `1.2.826.0.1.3680043.8.498.${Date.now()}.${Math.floor(Math.random() * 1e6)}.3`,
      accessionNumber: `MIS-NEGATIVE-${suffix}`,
      patientId: negativePatient.id,
      hospitalId: HOSPITAL_A,
      studyDate: new Date('2026-03-16T00:00:00.000Z'),
      modality: 'CT',
      bodyPart: 'CHEST',
      status: 'COMPLETED',
      receivedAt: new Date('2026-03-16T12:00:00.000Z'),
      assignedAt: new Date('2026-03-16T10:00:00.000Z'),
      completedAt: new Date('2026-03-16T11:00:00.000Z'),
    },
    select: { id: true },
  });
  studyIds.push(negativeStudy.id);
  const negativeReport = await prisma.report.create({
    data: {
      studyId: negativeStudy.id,
      authorId: radiologist.id,
      status: 'SIGNED',
      version: 1,
      signedOffBy: radiologist.id,
      signedOffAt: new Date('2026-03-16T09:00:00.000Z'),
      contentHash: 'c'.repeat(64),
    },
    select: { id: true },
  });
  reportIds.push(negativeReport.id);

  await prisma.auditLog.createMany({
    data: [
      {
        actorId: managerId,
        actorName: 'Scoped MIS Manager',
        actorRole: 'MANAGER',
        action: 'DICOM_IMPORTED',
        resource: 'STUDY',
        resourceId: richStudy.id,
        timestamp: uploadCompletedAt,
      },
      {
        actorId: managerId,
        actorName: 'Scoped MIS Manager',
        actorRole: 'MANAGER',
        action: 'DICOM_REINGEST',
        resource: 'STUDY',
        resourceId: richStudy.id,
        timestamp: reingestCompletedAt,
        metadata: { storedCount: 12, availability: 'AVAILABLE' },
      },
      {
        actorId: managerId,
        actorName: 'Scoped MIS Manager',
        actorRole: 'MANAGER',
        action: 'DICOM_REINGEST',
        resource: 'STUDY',
        resourceId: richStudy.id,
        timestamp: new Date('2026-03-16T08:08:00.000Z'),
        metadata: { status: 'FAILED' },
      },
      {
        actorId: managerId,
        actorName: 'Scoped MIS Manager',
        actorRole: 'MANAGER',
        action: 'REPORT_VERIFIED',
        resource: 'REPORT',
        resourceId: signedReport.id,
        timestamp: verifiedAt,
        metadata: { studyId: richStudy.id, reportId: signedReport.id },
      },
    ],
  });

  const batchPatients = Array.from({ length: BATCH_RECORDS }, (_, index) => {
    const rowId = `mis-batch-patient-${suffix}-${index}`;
    patientRowIds.push(rowId);
    return {
      id: rowId,
      patientId: `MIS-BATCH-${suffix}-${index}`,
      displayName: `MIS Batch Patient ${index}`,
      hospitalId: HOSPITAL_A,
    };
  });
  batchPatientIds = batchPatients.map((patient) => patient.patientId);
  await prisma.patient.createMany({ data: batchPatients });

  const batchStudies = batchPatients.map((patient, index) => {
    const studyId = `mis-batch-study-${suffix}-${index}`;
    studyIds.push(studyId);
    return {
      id: studyId,
      studyInstanceUid: `1.2.826.0.1.3680043.8.498.${Date.now()}.${suffix.slice(0, 8)}.${index + 1}`,
      accessionNumber: `MIS-BATCH-${suffix}-${index}`,
      patientId: patient.id,
      hospitalId: HOSPITAL_A,
      studyDate: new Date('2026-03-16T00:00:00.000Z'),
      modality: 'CT' as const,
      bodyPart: 'CHEST',
      status: 'HOSPITAL_SUBMITTED' as const,
    };
  });
  await prisma.study.createMany({ data: batchStudies });

  const otherHospitalPatient = await prisma.patient.create({
    data: {
      patientId: `MIS-OTHER-${suffix}`,
      displayName: 'Other Hospital Patient',
      gender: 'F',
      hospitalId: HOSPITAL_B,
    },
  });
  otherHospitalPatientId = otherHospitalPatient.patientId;
  patientRowIds.push(otherHospitalPatient.id);

  const otherHospitalStudy = await prisma.study.create({
    data: {
      studyInstanceUid: `1.2.826.0.1.3680043.8.498.${Date.now()}.${Math.floor(Math.random() * 1e6)}.2`,
      accessionNumber: `MIS-OTHER-${suffix}`,
      patientId: otherHospitalPatient.id,
      hospitalId: HOSPITAL_B,
      studyDate: new Date('2026-03-16T00:00:00.000Z'),
      modality: 'MRI',
      bodyPart: 'BRAIN',
    },
    select: { id: true },
  });
  studyIds.push(otherHospitalStudy.id);

  managerAgent = await loginAgent(server, {
    email: managerEmail,
    password: managerPassword,
  });
  unscopedManagerAgent = await loginAgent(server, USERS.MANAGER);
  adminAgent = await loginAgent(server, USERS.ADMIN);
  hospitalAgent = await loginAgent(server, USERS.H_CGH);
});

afterAll(async () => {
  if (studyIds.length) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: managerId },
          { resourceId: { in: [...studyIds, ...reportIds] } },
        ],
      },
    });
    await prisma.deliveryAttempt.deleteMany({
      where: { studyId: { in: studyIds } },
    });
    await prisma.assignment.deleteMany({
      where: { studyId: { in: studyIds } },
    });
    await prisma.report.deleteMany({
      where: { studyId: { in: studyIds } },
    });
    await prisma.study.deleteMany({ where: { id: { in: studyIds } } });
  }
  if (patientRowIds.length) {
    await prisma.patient.deleteMany({ where: { id: { in: patientRowIds } } });
  }
  if (managerId) {
    await prisma.user.deleteMany({ where: { id: managerId } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe('MIS Excel export', () => {
  it('requires authentication and rejects roles without export access', async () => {
    await request(server).get('/api/analytics/mis-report').expect(401);
    await hospitalAgent.get('/api/analytics/mis-report').expect(403);
    await unscopedManagerAgent.get('/api/analytics/mis-report').expect(403);
  });

  it('exports the exact 24-column workbook with study-specific mappings', async () => {
    const { workbook } = await workbookFor(
      managerAgent,
      `/api/analytics/mis-report?hospitalId=${HOSPITAL_B}`,
    );
    const worksheet = workbook.getWorksheet('MIS Report');
    expect(worksheet).toBeDefined();
    expect(worksheet!.getRow(1).cellCount).toBe(24);
    const actualHeaders = Array.from(
      { length: 24 },
      (_, index) => worksheet!.getRow(1).getCell(index + 1).value,
    );
    expect(actualHeaders).toEqual(MIS_HEADERS);

    const richRow = worksheet!.getRows(2, worksheet!.rowCount - 1)!.find(
      (row) => row.getCell(2).value === richPatientExternalId,
    );
    expect(richRow).toBeDefined();
    expect(richRow!.getCell(1).value).toBe('City General Hospital');
    expect(richRow!.getCell(3).value).toBe('MIS Mapping Patient');
    expect(richRow!.getCell(4).value).toBe(63);
    expect(richRow!.getCell(5).value).toBe('M');
    expect(richRow!.getCell(6).value).toBe('OT');
    expect(richRow!.getCell(7).value).toBe('MIS mapping chest study');
    expect(richRow!.getCell(8).value).toBe(12);
    expect(richRow!.getCell(9).value).toBe('Dr. History Form');
    expect(richRow!.getCell(10).value).toBe('COMPLETED');
    expect(richRow!.getCell(11).value).toBe('URGENT');
    expect(richRow!.getCell(12).value).toBe(2);
    expect(richRow!.getCell(13).value).toBe('2026-03-16 101112');
    expect(richRow!.getCell(14).value).toBe(reingestCompletedAt.toISOString());
    expect(richRow!.getCell(15).value).toBe(historyCreatedAt.toISOString());
    expect(richRow!.getCell(16).value).toBe(assignedAt.toISOString());
    expect(richRow!.getCell(17).value).toBe(signedOffAt.toISOString());
    expect(richRow!.getCell(18).value).toBe(verifiedAt.toISOString());
    expect(richRow!.getCell(19).value).toBe('Scoped MIS Manager');
    expect(richRow!.getCell(20).value).toBe('Dr. Sarah Chen');
    expect(richRow!.getCell(21).value).toBe('Dr. Sarah Chen');
    expect(richRow!.getCell(22).value).toBe('Scoped MIS Manager');
    expect(richRow!.getCell(23).value).toBe(180);
    expect(richRow!.getCell(24).value).toBe(45);

    expect(
      worksheet!.getRows(2, worksheet!.rowCount - 1)!.some(
        (row) => row.getCell(2).value === otherHospitalPatientId,
      ),
    ).toBe(false);

    const negativeRow = worksheet!.getRows(2, worksheet!.rowCount - 1)!.find(
      (row) => row.getCell(2).value === `MIS-NEGATIVE-${suffix}`,
    );
    expect(negativeRow?.getCell(23).value).toBeNull();
    expect(negativeRow?.getCell(24).value).toBeNull();
  });

  it('exports all 501 batched studies exactly once with missing optional data blank', async () => {
    const { workbook } = await workbookFor(managerAgent);
    const worksheet = workbook.getWorksheet('MIS Report')!;
    const batchRows = worksheet
      .getRows(2, worksheet.rowCount - 1)!
      .filter((row) =>
        String(row.getCell(2).value ?? '').startsWith(`MIS-BATCH-${suffix}-`),
      );
    const exportedPatientIds = batchRows.map((row) => row.getCell(2).value);

    expect(batchRows).toHaveLength(BATCH_RECORDS);
    expect(new Set(exportedPatientIds).size).toBe(BATCH_RECORDS);
    expect(exportedPatientIds).toEqual(expect.arrayContaining(batchPatientIds));
    for (const column of [
      4, 5, 6, 9, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]) {
      expect(batchRows[0].getCell(column).value).toBeNull();
    }
  });

  it('allows admins to export across hospitals', async () => {
    const { workbook } = await workbookFor(adminAgent);
    const worksheet = workbook.getWorksheet('MIS Report')!;
    expect(
      worksheet
        .getRows(2, worksheet.rowCount - 1)!
        .some((row) => row.getCell(2).value === otherHospitalPatientId),
    ).toBe(true);
  });
});
