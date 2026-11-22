import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.constants.js';
import { minutesBetween } from '../sla/tat.js';

const BATCH_SIZE = 500;
const MAX_DATA_ROWS_PER_SHEET = 1_048_575;

const HEADERS = [
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
] as const;

const STUDY_SELECT = {
  id: true,
  hospitalId: true,
  createdAt: true,
  studyDate: true,
  studyDateProvided: true,
  studyTime: true,
  sourceModality: true,
  modality: true,
  studyDescription: true,
  instanceCount: true,
  referringPhysician: true,
  status: true,
  priority: true,
  patientAge: true,
  historyCreatedAt: true,
  receivedAt: true,
  assignedAt: true,
  completedAt: true,
  patient: {
    select: {
      patientId: true,
      displayName: true,
      gender: true,
    },
  },
  hospital: { select: { name: true } },
  assignments: {
    where: { isActive: true },
    orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      assignedBy: { select: { displayName: true } },
      radiologist: { select: { displayName: true } },
    },
  },
  reports: {
    where: { signedOffAt: { not: null } },
    orderBy: [{ version: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      id: true,
      signedOffAt: true,
      author: { select: { displayName: true } },
    },
  },
  _count: { select: { reports: true } },
} satisfies Prisma.StudySelect;

type ExportStudy = Prisma.StudyGetPayload<{ select: typeof STUDY_SELECT }>;

export interface MisReportFile {
  filePath: string;
  cleanup: () => Promise<void>;
}

function isoUtc(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function studyDateTime(
  studyDate: Date,
  studyDateProvided: boolean,
  studyTime: string,
): string | null {
  if (!studyDateProvided) return null;
  const date = studyDate.toISOString().slice(0, 10);
  return studyTime ? `${date} ${studyTime}` : date;
}

function patientIdentifier(patientId: string, hospitalId: string): string {
  const tenantPrefix = `${hospitalId}:`;
  return patientId.startsWith(tenantPrefix)
    ? patientId.slice(tenantPrefix.length)
    : patientId;
}

@Injectable()
export class MisReportService {
  private readonly logger = new Logger(MisReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generate(user: AuthenticatedUser): Promise<MisReportFile> {
    const scope = this.studyScope(user);
    const directory = await mkdtemp(join(tmpdir(), 'axis-mis-export-'));
    const filePath = join(directory, 'MIS-Report.xlsx');
    const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
    let outputError: unknown;
    const outputFinished = finished(output).catch((error: unknown) => {
      outputError = error;
    });
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: false,
      useSharedStrings: false,
    });
    workbook.creator = 'Axis PACS';
    workbook.lastModifiedBy = 'Axis PACS';

    let sheetNumber = 1;
    let rowsInSheet = 0;
    let worksheet = this.createWorksheet(workbook, sheetNumber);
    let cursor: string | undefined;
    const exportStartedAt = new Date();
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(directory, { recursive: true, force: true });
    };

    try {
      while (true) {
        const studies = await this.prisma.study.findMany({
          where: {
            ...scope,
            createdAt: { lte: exportStartedAt },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          select: STUDY_SELECT,
        });
        if (studies.length === 0) break;

        const auditData = await this.auditDataForBatch(studies);
        for (const study of studies) {
          if (rowsInSheet === MAX_DATA_ROWS_PER_SHEET) {
            worksheet.commit();
            sheetNumber += 1;
            worksheet = this.createWorksheet(workbook, sheetNumber);
            rowsInSheet = 0;
          }

          worksheet.addRow(this.rowValues(study, auditData)).commit();
          rowsInSheet += 1;
        }
        cursor = studies[studies.length - 1].id;
      }

      worksheet.commit();
      await workbook.commit();
      await outputFinished;
      if (outputError) throw outputError;

      return { filePath, cleanup };
    } catch (error) {
      output.destroy();
      await outputFinished;
      try {
        await cleanup();
      } catch (cleanupError) {
        this.logCleanupError(cleanupError);
      }
      throw error;
    }
  }

  private studyScope(user: AuthenticatedUser): Prisma.StudyWhereInput {
    if (user.role === 'ADMIN') return {};
    if (user.role === 'MANAGER' && user.hospitalId) {
      return { hospitalId: user.hospitalId };
    }
    throw new ForbiddenException(
      'Your account is not authorized to export a hospital-scoped MIS report',
    );
  }

  private createWorksheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    sheetNumber: number,
  ) {
    const worksheet = workbook.addWorksheet(
      sheetNumber === 1 ? 'MIS Report' : `MIS Report ${sheetNumber}`,
    );
    worksheet.addRow([...HEADERS]).commit();
    return worksheet;
  }

  private async auditDataForBatch(studies: ExportStudy[]) {
    const studyIds = studies.map((study) => study.id);
    const reports = studies.flatMap((study) => study.reports);
    const reportIds = reports.map((report) => report.id);
    const [imports, verifications] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          action: { in: ['DICOM_IMPORTED', 'DICOM_REINGEST'] },
          resource: 'STUDY',
          resourceId: { in: studyIds },
        },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        select: { action: true, resourceId: true, timestamp: true, metadata: true },
      }),
      reportIds.length
        ? this.prisma.auditLog.findMany({
            where: {
              action: 'REPORT_VERIFIED',
              resource: 'REPORT',
              resourceId: { in: reportIds },
            },
            orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
            select: { resourceId: true, actorName: true, timestamp: true },
          })
        : Promise.resolve([]),
    ]);

    const importTimes = new Map<string, Date>();
    for (const entry of imports) {
      if (
        entry.action === 'DICOM_REINGEST' &&
        entry.metadata !== null &&
        typeof entry.metadata === 'object' &&
        !Array.isArray(entry.metadata) &&
        entry.metadata.status === 'FAILED'
      ) {
        continue;
      }
      if (!importTimes.has(entry.resourceId)) {
        importTimes.set(entry.resourceId, entry.timestamp);
      }
    }
    const verificationTimes = new Map<string, Date>();
    const verifierNames = new Map<string, string>();
    for (const entry of verifications) {
      if (!verificationTimes.has(entry.resourceId)) {
        verificationTimes.set(entry.resourceId, entry.timestamp);
        verifierNames.set(entry.resourceId, entry.actorName);
      }
    }

    return { importTimes, verificationTimes, verifierNames };
  }

  private rowValues(
    study: ExportStudy,
    auditData: {
      importTimes: Map<string, Date>;
      verificationTimes: Map<string, Date>;
      verifierNames: Map<string, string>;
    },
  ): Array<string | number | null> {
    const assignment = study.assignments[0];
    const report = study.reports[0];

    return [
      study.hospital.name,
      patientIdentifier(study.patient.patientId, study.hospitalId),
      study.patient.displayName,
      study.patientAge,
      study.patient.gender,
      study.sourceModality,
      study.studyDescription,
      study.instanceCount,
      study.referringPhysician,
      study.status,
      study.priority,
      study._count.reports,
      studyDateTime(study.studyDate, study.studyDateProvided, study.studyTime),
      isoUtc(auditData.importTimes.get(study.id)),
      isoUtc(study.historyCreatedAt),
      isoUtc(study.assignedAt),
      isoUtc(report?.signedOffAt),
      report ? isoUtc(auditData.verificationTimes.get(report.id)) : null,
      assignment?.assignedBy.displayName ?? null,
      assignment?.radiologist.displayName ?? null,
      report?.author.displayName ?? null,
      report ? auditData.verifierNames.get(report.id) ?? null : null,
      study.status === 'COMPLETED'
        ? minutesBetween(study.receivedAt ?? study.createdAt, study.completedAt)
        : null,
      minutesBetween(study.assignedAt, report?.signedOffAt),
    ];
  }

  private logCleanupError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`Unable to remove a completed MIS export file: ${detail}`);
  }
}
