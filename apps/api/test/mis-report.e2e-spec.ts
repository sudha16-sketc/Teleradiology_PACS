import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import ExcelJS from 'exceljs';
import type { INestApplication } from '@nestjs/common';
import {
  AuditAction,
  AuditResource,
  Gender,
  Modality,
  ReportStatus,
  StudyPriority,
  StudyStatus,
} from '@prisma/client';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';
import { MIS_REPORT_HEADERS } from '../src/mis-report/mis-excel.generator.js';

const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

let app: INestApplication;
let server: any;
let adminAgent: any;
let managerAgent: any;
let radiologistAgent: any;
let managerHospitalId: string;
let managerHospitalName: string;
let otherHospitalId: string;
let managerUserId: string;
let adminUserId: string;
let adminDisplayName: string;
let originalManagerHospitalId: string | null;
let managerDisplayName: string;
let radiologistUserId: string;
let radiologistDisplayName: string;
let secondRadiologistUserId: string;
let secondRadiologistDisplayName: string;

const suiteStart = new Date();
const seeded: Array<{ studyId: string; patientInternalId: string; reportIds: string[] }> = [];

function binaryParser(
  response: any,
  callback: (error: Error | null, body?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

type SeedOptions = {
  hospitalId: string;
  studyDate: Date;
  patientId?: string;
  patientName?: string;
  dateOfBirth?: Date | null;
  gender?: Gender;
  studyTime?: string;
  modality?: Modality;
  description?: string;
  instanceCount?: number;
  referringPhysician?: string;
  status?: StudyStatus;
  priority?: StudyPriority;
  createdAt?: Date;
  receivedAt?: Date | null;
  uploadCompletedAt?: Date | null;
};

async function seedStudy(options: SeedOptions) {
  const suffix = randomUUID();
  const patient = await prisma.patient.create({
    data: {
      patientId: options.patientId ?? `MIS-${suffix}`,
      displayName: options.patientName ?? 'MIS Patient',
      dateOfBirth: options.dateOfBirth ?? null,
      gender: options.gender ?? Gender.F,
      hospitalId: options.hospitalId,
    },
  });
  const study = await prisma.study.create({
    data: {
      studyInstanceUid: `1.2.826.0.1.3680043.9.mis.${suffix}`,
      accessionNumber: `MIS-${suffix}`,
      patientId: patient.id,
      hospitalId: options.hospitalId,
      studyDate: options.studyDate,
      studyTime: options.studyTime ?? '',
      modality: options.modality ?? Modality.CT,
      bodyPart: 'HEAD',
      studyDescription: options.description ?? 'MIS Study',
      referringPhysician: options.referringPhysician ?? 'Dr Referrer',
      priority: options.priority ?? StudyPriority.ROUTINE,
      status: options.status ?? StudyStatus.COMPLETED,
      instanceCount: options.instanceCount ?? 0,
      createdAt: options.createdAt ?? options.studyDate,
      receivedAt: options.receivedAt ?? null,
      uploadCompletedAt: options.uploadCompletedAt ?? null,
    },
  });
  seeded.push({ studyId: study.id, patientInternalId: patient.id, reportIds: [] });
  return { study, patient };
}

function seedFor(studyId: string) {
  const item = seeded.find((entry) => entry.studyId === studyId);
  if (!item) throw new Error(`Study ${studyId} was not seeded by this suite`);
  return item;
}

async function createHistory(studyId: string, createdAt: Date, content = 'history') {
  return prisma.patientHistory.create({
    data: { studyId, content, createdAt },
  });
}

async function createAssignment(
  studyId: string,
  radiologistId: string,
  assignedById: string,
  assignedAt: Date,
  unassignedAt: Date | null = null,
) {
  return prisma.assignment.create({
    data: {
      studyId,
      radiologistId,
      assignedById,
      assignedAt,
      unassignedAt,
      reason: unassignedAt ? 'Reassigned' : 'Assigned',
      isActive: !unassignedAt,
    },
  });
}

async function createReport(
  studyId: string,
  options: {
    version: number;
    authorId: string;
    createdAt: Date;
    status?: ReportStatus;
    signedOffAt?: Date | null;
    signedOffBy?: string | null;
  },
) {
  const report = await prisma.report.create({
    data: {
      studyId,
      version: options.version,
      authorId: options.authorId,
      status: options.status ?? ReportStatus.DRAFT,
      createdAt: options.createdAt,
      signedOffAt: options.signedOffAt ?? null,
      signedOffBy: options.signedOffBy ?? null,
      contentHash: `mis-${randomUUID()}`,
    },
  });
  seedFor(studyId).reportIds.push(report.id);
  return report;
}

async function createVerification(
  reportId: string,
  timestamp: Date,
  actorId: string,
  actorName: string,
) {
  return prisma.auditLog.create({
    data: {
      actorId,
      actorName,
      actorRole: 'MANAGER',
      action: AuditAction.REPORT_VERIFIED,
      resource: AuditResource.REPORT,
      resourceId: reportId,
      timestamp,
    },
  });
}

async function createInstances(studyId: string, count: number, label: string) {
  const suffix = randomUUID();
  const series = await prisma.series.create({
    data: {
      seriesInstanceUid: `1.2.826.0.1.3680043.9.mis.series.${suffix}`,
      studyId,
      modality: Modality.CT,
      seriesNumber: 1,
      instanceCount: count,
    },
  });
  for (let index = 0; index < count; index += 1) {
    await prisma.instance.create({
      data: {
        sopInstanceUid: `1.2.826.0.1.3680043.9.mis.sop.${suffix}.${index}`,
        seriesId: series.id,
        studyId,
        instanceNumber: index + 1,
        sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
        orthancInstanceId: `orthanc-${label}-${index}`,
      },
    });
  }
}

async function cleanup() {
  for (const item of seeded) {
    await prisma.auditLog.deleteMany({
      where: { resourceId: { in: [...item.reportIds, item.studyId] } },
    });
    await prisma.reportVersion.deleteMany({
      where: { reportId: { in: item.reportIds } },
    });
    await prisma.report.deleteMany({ where: { studyId: item.studyId } });
    await prisma.assignment.deleteMany({ where: { studyId: item.studyId } });
    await prisma.instance.deleteMany({ where: { studyId: item.studyId } });
    await prisma.series.deleteMany({ where: { studyId: item.studyId } });
    await prisma.worklistItem.deleteMany({ where: { studyId: item.studyId } });
    await prisma.study.delete({ where: { id: item.studyId } }).catch(() => undefined);
    await prisma.patient
      .delete({ where: { id: item.patientInternalId } })
      .catch(() => undefined);
  }
  await prisma.auditLog.deleteMany({
    where: {
      action: AuditAction.STUDY_DOWNLOADED,
      timestamp: { gte: suiteStart },
      resourceId: { startsWith: 'mis-report-export:' },
    },
  });
}

async function loadWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.getWorksheet('MIS Report');
  expect(sheet).toBeTruthy();
  return sheet!;
}

function expectHeaders(sheet: ExcelJS.Worksheet) {
  expect(sheet.columnCount).toBe(24);
  for (let column = 1; column <= MIS_REPORT_HEADERS.length; column += 1) {
    expect(sheet.getCell(1, column).value).toBe(MIS_REPORT_HEADERS[column - 1]);
  }
}

function rowForPatient(sheet: ExcelJS.Worksheet, patientId: string): number {
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    if (String(sheet.getCell(row, 2).value ?? '') === patientId) return row;
  }
  throw new Error(`Patient ${patientId} not found in workbook`);
}

function maybeRowForPatient(sheet: ExcelJS.Worksheet, patientId: string): number | null {
  try {
    return rowForPatient(sheet, patientId);
  } catch {
    return null;
  }
}

function expectDateClose(value: unknown, expected: Date) {
  expect(value).toBeInstanceOf(Date);
  expect(Math.abs((value as Date).getTime() - expected.getTime())).toBeLessThanOrEqual(
    1000,
  );
}

function durationMs(value: unknown): number {
  if (value instanceof Date) return value.getTime() - EXCEL_EPOCH;
  return Number(value) * DAY_MS;
}

async function exportWorkbook(agent: any, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return agent
    .get(`/api/reports/mis/export${query ? `?${query}` : ''}`)
    .buffer(true)
    .parse(binaryParser)
    .expect(200);
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;

  const [manager, admin, radiologist, secondRadiologist] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { email: USERS.MANAGER.email },
      select: { id: true, displayName: true, hospitalId: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { email: USERS.ADMIN.email },
      select: { id: true, displayName: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { email: USERS.RAD1.email },
      select: { id: true, displayName: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { email: USERS.RAD2.email },
      select: { id: true, displayName: true },
    }),
  ]);

  managerUserId = manager.id;
  originalManagerHospitalId = manager.hospitalId ?? null;
  managerDisplayName = manager.displayName;
  adminUserId = admin.id;
  adminDisplayName = admin.displayName;
  radiologistUserId = radiologist.id;
  radiologistDisplayName = radiologist.displayName;
  secondRadiologistUserId = secondRadiologist.id;
  secondRadiologistDisplayName = secondRadiologist.displayName;

  managerHospitalId = manager.hospitalId ?? 'hosp-001';
  await prisma.user.update({
    where: { id: managerUserId },
    data: { hospitalId: managerHospitalId },
  });
  adminAgent = await loginAgent(server, USERS.ADMIN);
  managerAgent = await loginAgent(server, USERS.MANAGER);
  radiologistAgent = await loginAgent(server, USERS.RAD1);

  const managerHospital = await prisma.hospital.findUniqueOrThrow({
    where: { id: managerHospitalId },
    select: { name: true },
  });
  managerHospitalName = managerHospital.name;
  otherHospitalId = (
    await prisma.hospital.findFirst({
      where: { id: { not: managerHospitalId } },
      select: { id: true },
    })
  )?.id ?? 'hosp-002';
});

afterAll(async () => {
  await cleanup();
  await prisma.user.update({
    where: { id: managerUserId },
    data: { hospitalId: originalManagerHospitalId },
  });
  await prisma.$disconnect();
  await app.close();
});

describe('MIS Excel export remediation', () => {
  it('MIS-1: exports the reference header structure and corrected field values', async () => {
    const studyDate = new Date('2026-03-10T00:00:00.000Z');
    const studyCreatedAt = new Date('2026-03-10T07:00:00.000Z');
    const historyCreatedAt = new Date('2026-03-10T07:30:00.000Z');
    const receivedAt = new Date('2026-03-10T07:45:00.000Z');
    const uploadCompletedAt = new Date('2026-03-10T08:00:00.000Z');
    const assignedAt = new Date('2026-03-10T09:00:00.000Z');
    const reportCreatedAt = new Date('2026-03-10T09:15:00.000Z');
    const signedOffAt = new Date('2026-03-11T12:00:00.000Z');
    const verifiedAt = new Date('2026-03-11T12:30:00.000Z');

    const { study, patient } = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate,
      patientId: `MIS-STRUCT-${randomUUID()}`,
      patientName: 'MIS Structure Patient',
      dateOfBirth: new Date('1971-05-20T00:00:00.000Z'),
      gender: Gender.F,
      studyTime: '10:30:00',
      modality: Modality.CT,
      description: 'MIS CT Brain',
      instanceCount: 42,
      referringPhysician: 'Dr Structure',
      status: StudyStatus.COMPLETED,
      priority: StudyPriority.ROUTINE,
      createdAt: studyCreatedAt,
      receivedAt,
      uploadCompletedAt,
    });
    await createHistory(study.id, historyCreatedAt, 'MIS history');
    await createInstances(study.id, 3, 'struct');
    await createAssignment(study.id, radiologistUserId, managerUserId, assignedAt);
    const signedReport = await createReport(study.id, {
      version: 1,
      authorId: radiologistUserId,
      createdAt: reportCreatedAt,
      status: ReportStatus.SIGNED,
      signedOffAt,
      signedOffBy: radiologistUserId,
    });
    await createReport(study.id, {
      version: 2,
      authorId: radiologistUserId,
      createdAt: new Date('2026-03-11T13:00:00.000Z'),
    });
    await createVerification(signedReport.id, verifiedAt, managerUserId, managerDisplayName);

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-03-10',
      toDate: '2026-03-10',
    });
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="MIS_Report_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.xlsx"/,
    );
    expect(response.headers['x-mis-row-count']).toBe('1');

    const buffer = response.body as Buffer;
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    await writeFile('/tmp/opencode/mis-export-verification.xlsx', buffer);
    const sheet = await loadWorkbook(buffer);
    expectHeaders(sheet);
    expect(sheet.views[0]?.state).toBe('frozen');
    expect((sheet.views[0] as any)?.ySplit).toBe(1);
    expect(String((sheet as any).autoFilter)).toMatch(/^A1:X\d+$/);

    const row = rowForPatient(sheet, patient.patientId);
    expect(sheet.getCell(row, 1).value).toBe(managerHospitalName);
    expect(sheet.getCell(row, 2).value).toBe(patient.patientId);
    expect(sheet.getCell(row, 2).numFmt).toBe('@');
    expect(sheet.getCell(row, 3).value).toBe('MIS Structure Patient');
    expect(sheet.getCell(row, 4).value).toBe('054Y');
    expect(sheet.getCell(row, 5).value).toBe(Gender.F);
    expect(sheet.getCell(row, 6).value).toBe(Modality.CT);
    expect(sheet.getCell(row, 7).value).toBe('MIS CT Brain');
    expect(sheet.getCell(row, 8).value).toBe(3);
    expect(sheet.getCell(row, 9).value).toBe('Dr Structure');
    expect(sheet.getCell(row, 10).value).toBe(StudyStatus.COMPLETED);
    expect(sheet.getCell(row, 11).value).toBe(StudyPriority.ROUTINE);
    expect(sheet.getCell(row, 12).value).toBe(2);
    expectDateClose(sheet.getCell(row, 13).value, new Date('2026-03-10T10:30:00.000Z'));
    expectDateClose(sheet.getCell(row, 14).value, uploadCompletedAt);
    expectDateClose(sheet.getCell(row, 15).value, historyCreatedAt);
    expect(sheet.getCell(row, 15).value).not.toEqual(studyCreatedAt);
    expectDateClose(sheet.getCell(row, 16).value, assignedAt);
    expectDateClose(sheet.getCell(row, 17).value, signedOffAt);
    expectDateClose(sheet.getCell(row, 18).value, verifiedAt);
    expect(sheet.getCell(row, 19).value).toBe(managerDisplayName);
    expect(sheet.getCell(row, 20).value).toBe(radiologistDisplayName);
    expect(sheet.getCell(row, 21).value).toBe(radiologistDisplayName);
    expect(sheet.getCell(row, 22).value).toBe(managerDisplayName);
    expect(Math.abs(durationMs(sheet.getCell(row, 23).value) - 28 * 3_600_000)).toBeLessThanOrEqual(1000);
    expect(sheet.getCell(row, 23).numFmt).toBe('[h]:mm:ss');
    expect(Math.abs(durationMs(sheet.getCell(row, 24).value) - 27 * 3_600_000)).toBeLessThanOrEqual(1000);
    expect(sheet.getCell(row, 24).numFmt).toBe('[h]:mm:ss');
    for (const column of [13, 14, 15, 16, 17, 18]) {
      expect(sheet.getCell(row, column).numFmt).toBe('yyyy-mm-dd hh:mm:ss');
    }
  });

  it('MIS-REF: generated headers exactly match the supplied workbook', async () => {
    const reference = new ExcelJS.Workbook();
    await reference.xlsx.readFile('test/fixtures/mis_report.xlsx');
    const referenceSheet = reference.worksheets[0];
    const referenceHeaders = Array.from(
      { length: 24 },
      (_, index) => String(referenceSheet.getCell(1, index + 1).value ?? ''),
    );
    expect(referenceHeaders).toEqual([...MIS_REPORT_HEADERS]);

    const { patient } = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: new Date('2026-03-20T00:00:00.000Z'),
      patientId: `MIS-REF-${randomUUID()}`,
    });
    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-03-20',
      toDate: '2026-03-20',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    expectHeaders(sheet);
    expect(rowForPatient(sheet, patient.patientId)).toBeGreaterThan(1);
  });

  it('MIS-2: manager scope blocks other-hospital studies and query-parameter bypass', async () => {
    const date = new Date('2026-03-11T00:00:00.000Z');
    const own = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-MGR-${randomUUID()}`,
    });
    const other = await seedStudy({
      hospitalId: otherHospitalId,
      studyDate: date,
      patientId: `MIS-OTHER-${randomUUID()}`,
    });

    const response = await exportWorkbook(managerAgent, {
      fromDate: '2026-03-11',
      toDate: '2026-03-11',
      hospitalId: otherHospitalId,
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    expect(rowForPatient(sheet, own.patient.patientId)).toBeGreaterThan(1);
    expect(maybeRowForPatient(sheet, other.patient.patientId)).toBeNull();
  });

  it('MIS-3: denies radiologists and validates date ranges', async () => {
    await radiologistAgent.get('/api/reports/mis/export').expect(403);
    await adminAgent.get('/api/reports/mis/export?fromDate=not-a-date').expect(400);
    await adminAgent
      .get('/api/reports/mis/export?fromDate=2026-04-02&toDate=2026-04-01')
      .expect(400);
  });

  it('MIS-4: date filters are inclusive on studyDate', async () => {
    const boundary = new Date('2026-04-10T12:00:00.000Z');
    const seededStudy = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: boundary,
      patientId: `MIS-DATE-${randomUUID()}`,
    });
    await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: new Date('2026-04-09T12:00:00.000Z'),
      patientId: `MIS-BEFORE-${randomUUID()}`,
    });
    await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: new Date('2026-04-11T12:00:00.000Z'),
      patientId: `MIS-AFTER-${randomUUID()}`,
    });

    const fromOnly = await exportWorkbook(adminAgent, { fromDate: '2026-04-10' });
    const fromSheet = await loadWorkbook(fromOnly.body as Buffer);
    expect(rowForPatient(fromSheet, seededStudy.patient.patientId)).toBeGreaterThan(1);

    const toOnly = await exportWorkbook(adminAgent, { toDate: '2026-04-10' });
    const toSheet = await loadWorkbook(toOnly.body as Buffer);
    expect(rowForPatient(toSheet, seededStudy.patient.patientId)).toBeGreaterThan(1);
  });

  it('MIS-5: handles nulls, text identifiers, and formula injection safely', async () => {
    const seededStudy = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: new Date('2026-05-01T00:00:00.000Z'),
      patientId: '000123',
      patientName: '=1+1',
      dateOfBirth: null,
      receivedAt: new Date('2026-05-01T07:00:00.000Z'),
      uploadCompletedAt: null,
    });

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-05-01',
      toDate: '2026-05-01',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    const row = rowForPatient(sheet, seededStudy.patient.patientId);
    expect(sheet.getCell(row, 2).value).toBe('000123');
    expect(sheet.getCell(row, 2).numFmt).toBe('@');
    expect(sheet.getCell(row, 3).value).toBe("'=1+1");
    expect(sheet.getCell(row, 4).value).toBeNull();
    for (const column of [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) {
      expect(sheet.getCell(row, column).value).toBeNull();
    }
  });

  it('MIS-6: produces a headers-only workbook and audits metadata only', async () => {
    const before = new Date();
    const response = await exportWorkbook(adminAgent, {
      fromDate: '2099-01-01',
      toDate: '2099-01-31',
    });
    expect(response.headers['x-mis-row-count']).toBe('0');
    const sheet = await loadWorkbook(response.body as Buffer);
    expectHeaders(sheet);
    expect(sheet.rowCount).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: AuditAction.STUDY_DOWNLOADED,
        timestamp: { gte: before },
        resourceId: { startsWith: 'mis-report-export:' },
      },
      orderBy: { timestamp: 'desc' },
      select: { actorId: true, actorRole: true, metadata: true },
    });
    expect(audit?.actorId).toBeTruthy();
    expect(audit?.actorRole).toBe('ADMIN');
    const metadata = JSON.stringify(audit?.metadata ?? {});
    expect(metadata).toContain('MIS_EXCEL');
    expect(metadata).toContain('"rowCount":0');
    expect(metadata).not.toContain('displayName');
  });

  it('MIS-7: historyCreatedAt uses the history record, not study creation or update time', async () => {
    const date = new Date('2026-05-10T00:00:00.000Z');
    const studyCreatedAt = new Date('2026-05-10T06:00:00.000Z');
    const historyCreatedAt = new Date('2026-05-10T08:00:00.000Z');
    const noHistory = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-NOHIST-${randomUUID()}`,
      createdAt: studyCreatedAt,
    });
    const withHistory = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-HIST-${randomUUID()}`,
      createdAt: studyCreatedAt,
    });
    const history = await createHistory(withHistory.study.id, historyCreatedAt);
    await prisma.patientHistory.update({
      where: { id: history.id },
      data: { content: 'updated history' },
    });
    const secondCreatedAt = new Date('2026-05-10T09:00:00.000Z');
    const second = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-HIST2-${randomUUID()}`,
      createdAt: studyCreatedAt,
    });
    await createHistory(second.study.id, secondCreatedAt, 'second history');
    await expect(
      prisma.patientHistory.create({
        data: { studyId: second.study.id, content: 'duplicate', createdAt: new Date() },
      }),
    ).rejects.toThrow();

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-05-10',
      toDate: '2026-05-10',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    expect(sheet.getCell(rowForPatient(sheet, noHistory.patient.patientId), 15).value).toBeNull();
    expectDateClose(
      sheet.getCell(rowForPatient(sheet, withHistory.patient.patientId), 15).value,
      historyCreatedAt,
    );
    expectDateClose(
      sheet.getCell(rowForPatient(sheet, second.patient.patientId), 15).value,
      secondCreatedAt,
    );
  });

  it('MIS-8: assignment fields come from the single assignment event active when the report was created', async () => {
    const date = new Date('2026-05-20T00:00:00.000Z');
    const firstAt = new Date('2026-05-20T08:00:00.000Z');
    const reassignAt = new Date('2026-05-20T09:00:00.000Z');
    const reportCreatedAt = new Date('2026-05-20T09:30:00.000Z');
    const signedOffAt = new Date('2026-05-20T10:30:00.000Z');

    const reassigned = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-ASSIGN-${randomUUID()}`,
      uploadCompletedAt: new Date('2026-05-20T07:00:00.000Z'),
    });
    await createAssignment(reassigned.study.id, radiologistUserId, managerUserId, firstAt, reassignAt);
    await createAssignment(
      reassigned.study.id,
      secondRadiologistUserId,
      adminUserId,
      reassignAt,
    );
    await createAssignment(
      reassigned.study.id,
      radiologistUserId,
      managerUserId,
      new Date('2026-05-20T07:30:00.000Z'),
      new Date('2026-05-20T08:30:00.000Z'),
    );
    await createReport(reassigned.study.id, {
      version: 1,
      authorId: secondRadiologistUserId,
      createdAt: reportCreatedAt,
      status: ReportStatus.SIGNED,
      signedOffAt,
      signedOffBy: secondRadiologistUserId,
    });

    const noHistory = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-NOASSIGN-${randomUUID()}`,
    });
    await createReport(noHistory.study.id, {
      version: 1,
      authorId: radiologistUserId,
      createdAt: reportCreatedAt,
      status: ReportStatus.SIGNED,
      signedOffAt,
      signedOffBy: radiologistUserId,
    });

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-05-20',
      toDate: '2026-05-20',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    const reassignedRow = rowForPatient(sheet, reassigned.patient.patientId);
    expectDateClose(sheet.getCell(reassignedRow, 16).value, reassignAt);
    expect(sheet.getCell(reassignedRow, 19).value).toBe(adminDisplayName);
    expect(sheet.getCell(reassignedRow, 20).value).toBe(secondRadiologistDisplayName);

    const noAssignmentRow = rowForPatient(sheet, noHistory.patient.patientId);
    for (const column of [16, 19, 20, 24]) {
      expect(sheet.getCell(noAssignmentRow, column).value).toBeNull();
    }
  });

  it('MIS-9: noOfReports counts Report records and ignores ReportVersion snapshots', async () => {
    const date = new Date('2026-05-30T00:00:00.000Z');
    const single = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-ONEREP-${randomUUID()}`,
    });
    const singleReport = await createReport(single.study.id, {
      version: 1,
      authorId: radiologistUserId,
      createdAt: new Date('2026-05-30T08:00:00.000Z'),
      status: ReportStatus.SIGNED,
      signedOffAt: new Date('2026-05-30T09:00:00.000Z'),
      signedOffBy: radiologistUserId,
    });
    await prisma.reportVersion.create({
      data: {
        reportId: singleReport.id,
        version: 1,
        status: ReportStatus.SIGNED,
        findings: 'f',
        impression: 'i',
        authorId: radiologistUserId,
        contentHash: `mis-version-${randomUUID()}`,
      },
    });

    const multiple = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-MULTIREP-${randomUUID()}`,
    });
    await createReport(multiple.study.id, {
      version: 1,
      authorId: radiologistUserId,
      createdAt: new Date('2026-05-30T08:00:00.000Z'),
      status: ReportStatus.SIGNED,
      signedOffAt: new Date('2026-05-30T09:00:00.000Z'),
      signedOffBy: radiologistUserId,
    });
    await createReport(multiple.study.id, {
      version: 2,
      authorId: radiologistUserId,
      createdAt: new Date('2026-05-30T10:00:00.000Z'),
      status: ReportStatus.SIGNED,
      signedOffAt: new Date('2026-05-30T11:00:00.000Z'),
      signedOffBy: radiologistUserId,
    });
    await createReport(multiple.study.id, {
      version: 3,
      authorId: radiologistUserId,
      createdAt: new Date('2026-05-30T12:00:00.000Z'),
    });

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-05-30',
      toDate: '2026-05-30',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    expect(sheet.getCell(rowForPatient(sheet, single.patient.patientId), 12).value).toBe(1);
    expect(sheet.getCell(rowForPatient(sheet, multiple.patient.patientId), 12).value).toBe(3);
  });

  it('MIS-10: ImageCount uses stored Instance rows, not the denormalized counter', async () => {
    const seededStudy = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: new Date('2026-06-01T00:00:00.000Z'),
      patientId: `MIS-IMAGES-${randomUUID()}`,
      instanceCount: 42,
    });
    await createInstances(seededStudy.study.id, 3, 'images');

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-06-01',
      toDate: '2026-06-01',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    const row = rowForPatient(sheet, seededStudy.patient.patientId);
    expect(sheet.getCell(row, 8).value).toBe(3);
    expect(await prisma.instance.count({ where: { studyId: seededStudy.study.id } })).toBe(3);
  });

  it('MIS-11: uploadCompletedAt is authoritative and receivedAt is not used as a fallback', async () => {
    const date = new Date('2026-06-05T00:00:00.000Z');
    const receivedAt = new Date('2026-06-05T07:00:00.000Z');
    const uploadCompletedAt = new Date('2026-06-05T08:00:00.000Z');
    const withUpload = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-UPLOAD-${randomUUID()}`,
      receivedAt,
      uploadCompletedAt,
    });
    const withoutUpload = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-NUPLOAD-${randomUUID()}`,
      receivedAt,
      uploadCompletedAt: null,
    });

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-06-05',
      toDate: '2026-06-05',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    expectDateClose(
      sheet.getCell(rowForPatient(sheet, withUpload.patient.patientId), 14).value,
      uploadCompletedAt,
    );
    expect(
      sheet.getCell(rowForPatient(sheet, withoutUpload.patient.patientId), 14).value,
    ).toBeNull();
  });

  it('MIS-12: Verified At and Study Verified By come from the same newest verification event', async () => {
    const date = new Date('2026-06-10T00:00:00.000Z');
    const olderVerifiedAt = new Date('2026-06-10T10:30:00.000Z');
    const newerVerifiedAt = new Date('2026-06-10T11:30:00.000Z');
    const study = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-VERIFY-${randomUUID()}`,
    });
    const report = await createReport(study.study.id, {
      version: 1,
      authorId: radiologistUserId,
      createdAt: new Date('2026-06-10T08:00:00.000Z'),
      status: ReportStatus.SIGNED,
      signedOffAt: new Date('2026-06-10T09:00:00.000Z'),
      signedOffBy: radiologistUserId,
    });
    await createVerification(report.id, olderVerifiedAt, managerUserId, managerDisplayName);
    await createVerification(report.id, newerVerifiedAt, adminUserId, adminDisplayName);

    const staleStudy = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: date,
      patientId: `MIS-STALEVERIFY-${randomUUID()}`,
    });
    const oldSigned = await createReport(staleStudy.study.id, {
      version: 1,
      authorId: radiologistUserId,
      createdAt: new Date('2026-06-10T08:00:00.000Z'),
      status: ReportStatus.SIGNED,
      signedOffAt: new Date('2026-06-10T09:00:00.000Z'),
      signedOffBy: radiologistUserId,
    });
    await createVerification(oldSigned.id, olderVerifiedAt, managerUserId, managerDisplayName);
    await createReport(staleStudy.study.id, {
      version: 2,
      authorId: radiologistUserId,
      createdAt: new Date('2026-06-10T12:00:00.000Z'),
      status: ReportStatus.SIGNED,
      signedOffAt: new Date('2026-06-10T13:00:00.000Z'),
      signedOffBy: radiologistUserId,
    });

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-06-10',
      toDate: '2026-06-10',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    const row = rowForPatient(sheet, study.patient.patientId);
    expectDateClose(sheet.getCell(row, 18).value, newerVerifiedAt);
    expect(sheet.getCell(row, 22).value).toBe(adminDisplayName);

    const staleRow = rowForPatient(sheet, staleStudy.patient.patientId);
    expect(sheet.getCell(staleRow, 18).value).toBeNull();
    expect(sheet.getCell(staleRow, 22).value).toBeNull();
  });

  it('MIS-13: negative TAT values remain blank and are counted in audit metadata', async () => {
    const before = new Date();
    const seededStudy = await seedStudy({
      hospitalId: managerHospitalId,
      studyDate: new Date('2026-06-15T00:00:00.000Z'),
      patientId: `MIS-NEGTAT-${randomUUID()}`,
      uploadCompletedAt: new Date('2026-06-15T12:00:00.000Z'),
    });
    await createAssignment(
      seededStudy.study.id,
      radiologistUserId,
      managerUserId,
      new Date('2026-06-15T13:00:00.000Z'),
    );
    await createReport(seededStudy.study.id, {
      version: 1,
      authorId: radiologistUserId,
      createdAt: new Date('2026-06-15T13:10:00.000Z'),
      status: ReportStatus.SIGNED,
      signedOffAt: new Date('2026-06-15T11:00:00.000Z'),
      signedOffBy: radiologistUserId,
    });

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    const row = rowForPatient(sheet, seededStudy.patient.patientId);
    expect(sheet.getCell(row, 23).value).toBeNull();
    expect(sheet.getCell(row, 24).value).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: AuditAction.STUDY_DOWNLOADED,
        timestamp: { gte: before },
        resourceId: { startsWith: 'mis-report-export:' },
      },
      orderBy: { timestamp: 'desc' },
      select: { metadata: true },
    });
    expect(JSON.stringify(audit?.metadata ?? {})).toContain('"negativeTatCount":2');
  });

  it('MIS-14: includes large filtered datasets without truncation', async () => {
    const date = new Date('2026-06-20T00:00:00.000Z');
    const created: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const seededStudy = await seedStudy({
        hospitalId: managerHospitalId,
        studyDate: date,
        patientId: `MIS-BULK-${Date.now()}-${index}-${randomUUID()}`,
      });
      created.push(seededStudy.patient.patientId);
    }

    const response = await exportWorkbook(adminAgent, {
      fromDate: '2026-06-20',
      toDate: '2026-06-20',
    });
    const sheet = await loadWorkbook(response.body as Buffer);
    expect(sheet.rowCount).toBeGreaterThanOrEqual(created.length + 1);
    for (const patientId of created) {
      expect(rowForPatient(sheet, patientId)).toBeGreaterThan(1);
    }
  });
});
