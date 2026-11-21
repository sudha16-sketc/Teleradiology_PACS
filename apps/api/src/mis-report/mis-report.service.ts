import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AuditAction,
  AuditResource,
  Prisma,
  ReportStatus,
  UserRole,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildMisWorkbook, MisExcelRow } from './mis-excel.generator.js';
import { MisExportQueryDto } from './dto/mis-export-query.dto.js';

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const BATCH_SIZE = 1000;

type MisStudy = {
  id: string;
  studyDate: Date;
  studyTime: string;
  modality: string;
  priority: string;
  status: string;
  referringPhysician: string;
  studyDescription: string;
  createdAt: Date;
  uploadCompletedAt: Date | null;
  signedOffAt: Date | null;
  hospital: { name: string };
  patient: {
    patientId: string;
    displayName: string;
    dateOfBirth: Date | null;
    gender: string | null;
  };
  patientHistory: { createdAt: Date } | null;
  assignments: Array<{
    assignedAt: Date;
    unassignedAt: Date | null;
    radiologistId: string;
    radiologist: { displayName: string };
    assignedBy: { displayName: string };
  }>;
  _count: { instances: number; reports: number };
};

type MisSignedReport = {
  id: string;
  studyId: string;
  version: number;
  createdAt: Date;
  signedOffAt: Date | null;
  authorId: string;
  signedOffBy: string | null;
  author: { displayName: string };
};

type MisVerification = {
  resourceId: string;
  actorName: string;
  timestamp: Date;
};

export type MisExportContext = {
  ipAddress?: string;
  userAgent?: string;
};

export type MisExportResult = {
  buffer: Buffer;
  filename: string;
  rowCount: number;
};

function parseBoundary(
  value: string | undefined,
  boundary: 'start' | 'end',
  field: string,
): Date | undefined {
  if (!value) return undefined;

  let parsed: Date;
  if (DATE_ONLY.test(value)) {
    parsed = new Date(`${value}T00:00:00.000Z`);
    if (boundary === 'end' && !Number.isNaN(parsed.getTime())) {
      parsed = new Date(parsed.getTime() + DAY_MS - 1);
    }
  } else {
    parsed = new Date(value);
  }

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date`);
  }
  return parsed;
}

function parseDateRange(query: MisExportQueryDto) {
  const fromDate = parseBoundary(query.fromDate, 'start', 'fromDate');
  const toDate = parseBoundary(query.toDate, 'end', 'toDate');
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new BadRequestException('fromDate cannot be later than toDate');
  }
  return { fromDate, toDate };
}

function formatAge(dateOfBirth: Date | null, asOf: Date): string | null {
  if (!dateOfBirth) return null;
  const years = asOf.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  if (!Number.isFinite(years) || years < 0) return null;
  const beforeBirthday =
    asOf.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (asOf.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      asOf.getUTCDate() < dateOfBirth.getUTCDate());
  const completedYears = beforeBirthday ? years - 1 : years;
  if (completedYears < 0) return null;
  return `${String(completedYears).padStart(3, '0')}Y`;
}

function studyDateTime(studyDate: Date, studyTime: string): Date {
  const value = (studyTime ?? '').trim();
  const colon = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  const compact = /^(\d{2})(\d{2})(\d{2})$/.exec(value);
  const parts = colon ?? compact;

  if (!parts) return new Date(studyDate.getTime());

  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);
  const seconds = Number(parts[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return new Date(studyDate.getTime());
  }

  return new Date(
    Date.UTC(
      studyDate.getUTCFullYear(),
      studyDate.getUTCMonth(),
      studyDate.getUTCDate(),
      hours,
      minutes,
      seconds,
    ),
  );
}

function durationDays(
  from: Date | null,
  to: Date | null,
  onInvalid: () => void,
): number | null {
  if (!from || !to) return null;
  const milliseconds = to.getTime() - from.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    onInvalid();
    return null;
  }
  return milliseconds / DAY_MS;
}

function filenameFor(timestamp: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `MIS_Report_${timestamp.getUTCFullYear()}-${pad(timestamp.getUTCMonth() + 1)}-${pad(timestamp.getUTCDate())}_${pad(timestamp.getUTCHours())}-${pad(timestamp.getUTCMinutes())}.xlsx`;
}

@Injectable()
export class MisReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async export(
    user: AuthenticatedUser,
    query: MisExportQueryDto,
    context: MisExportContext = {},
  ): Promise<MisExportResult> {
    const startedAt = new Date();
    const auditBase = {
      actorId: user.id,
      actorName: user.displayName || user.email,
      actorRole: user.role,
      action: AuditAction.STUDY_DOWNLOADED,
      resource: AuditResource.STUDY,
      resourceId: `mis-report-export:${startedAt.toISOString()}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    };

    try {
      const where = this.buildWhere(user, query);
      let negativeTatCount = 0;
      const result = await buildMisWorkbook(
        this.buildRows(where, () => {
          negativeTatCount += 1;
        }),
        startedAt,
      );
      const filename = filenameFor(startedAt);

      await this.audit.create({
        ...auditBase,
        metadata: {
          export: 'MIS_EXCEL',
          success: true,
          exportedAt: startedAt.toISOString(),
          rowCount: result.rowCount,
          negativeTatCount,
          filename,
          scope:
            user.role === UserRole.MANAGER
              ? { type: 'HOSPITAL', hospitalId: user.hospitalId }
              : { type: 'ALL' },
          filters: {
            fromDate: query.fromDate ?? null,
            toDate: query.toDate ?? null,
          },
          mappingRules: {
            history: 'PatientHistory.createdAt or null',
            imageCount: 'Instance rows for study',
            reportCount: 'Report records, not ReportVersion snapshots',
            upload: 'Study.uploadCompletedAt or null',
            assignment: 'Assignment active when signed report was created',
            verification: 'Latest REPORT_VERIFIED audit for signed report',
          },
        },
      });

      return {
        buffer: result.buffer,
        filename,
        rowCount: result.rowCount,
      };
    } catch (error) {
      await this.audit
        .create({
          ...auditBase,
          metadata: {
            export: 'MIS_EXCEL',
            success: false,
            exportedAt: startedAt.toISOString(),
            errorType: error instanceof Error ? error.name : 'UnknownError',
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private buildWhere(user: AuthenticatedUser, query: MisExportQueryDto) {
    const { fromDate, toDate } = parseDateRange(query);
    const where: Prisma.StudyWhereInput = {};

    if (user.role === UserRole.MANAGER) {
      if (!user.hospitalId) {
        throw new ForbiddenException(
          'Manager account has no hospital scope for MIS export',
        );
      }
      where.hospitalId = user.hospitalId;
    }

    if (fromDate || toDate) {
      where.studyDate = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      };
    }

    return where;
  }

  private async *studyBatches(
    where: Prisma.StudyWhereInput,
  ): AsyncGenerator<MisStudy[]> {
    let cursor: string | undefined;
    for (;;) {
      const studies = (await this.prisma.study.findMany({
        where,
        orderBy: [{ studyDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          studyDate: true,
          studyTime: true,
          modality: true,
          priority: true,
          status: true,
          referringPhysician: true,
          studyDescription: true,
          createdAt: true,
          uploadCompletedAt: true,
          signedOffAt: true,
          hospital: { select: { name: true } },
          patient: {
            select: {
              patientId: true,
              displayName: true,
              dateOfBirth: true,
              gender: true,
            },
          },
          patientHistory: { select: { createdAt: true } },
          assignments: {
            select: {
              assignedAt: true,
              unassignedAt: true,
              radiologistId: true,
              radiologist: { select: { displayName: true } },
              assignedBy: { select: { displayName: true } },
            },
          },
          _count: { select: { instances: true, reports: true } },
        },
      })) as MisStudy[];

      if (!studies.length) return;
      cursor = studies[studies.length - 1].id;
      yield studies;
    }
  }

  private async *buildRows(
    where: Prisma.StudyWhereInput,
    onInvalidTat: () => void,
  ): AsyncGenerator<MisExcelRow> {
    for await (const studies of this.studyBatches(where)) {
      const studyIds = studies.map((study) => study.id);
      const signedReports = (await this.prisma.report.findMany({
        where: { studyId: { in: studyIds }, status: ReportStatus.SIGNED },
        orderBy: [{ studyId: 'asc' }, { version: 'desc' }],
        select: {
          id: true,
          studyId: true,
          version: true,
          createdAt: true,
          signedOffAt: true,
          authorId: true,
          signedOffBy: true,
          author: { select: { displayName: true } },
        },
      })) as MisSignedReport[];

      const signedReportByStudy = new Map<string, MisSignedReport>();
      for (const report of signedReports) {
        if (!signedReportByStudy.has(report.studyId)) {
          signedReportByStudy.set(report.studyId, report);
        }
      }

      const reportIds = [...signedReportByStudy.values()].map((report) => report.id);
      const verifications = reportIds.length
        ? ((await this.prisma.auditLog.findMany({
            where: {
              action: AuditAction.REPORT_VERIFIED,
              resource: AuditResource.REPORT,
              resourceId: { in: reportIds },
            },
            orderBy: { timestamp: 'desc' },
            select: { resourceId: true, actorName: true, timestamp: true },
          })) as MisVerification[])
        : [];
      const verificationByReport = new Map<string, MisVerification>();
      for (const verification of verifications) {
        if (!verificationByReport.has(verification.resourceId)) {
          verificationByReport.set(verification.resourceId, verification);
        }
      }

      for (const study of studies) {
        const signedReport = signedReportByStudy.get(study.id) ?? null;
        const signedOffAt = signedReport?.signedOffAt ?? study.signedOffAt ?? null;
        const reporterIds = signedReport
          ? [signedReport.signedOffBy, signedReport.authorId].filter(
              (value): value is string => Boolean(value),
            )
          : [];
        const assignment = this.findAssignmentEvent(
          study.assignments,
          reporterIds,
          signedReport?.createdAt ?? signedReport?.signedOffAt ?? null,
        );
        const candidateVerification = signedReport
          ? verificationByReport.get(signedReport.id)
          : undefined;
        const verification =
          candidateVerification &&
          (!signedReport?.signedOffAt ||
            candidateVerification.timestamp.getTime() >=
              signedReport.signedOffAt.getTime())
            ? candidateVerification
            : undefined;
        const uploadCompletedAt = study.uploadCompletedAt;

        yield [
          study.hospital.name,
          study.patient.patientId,
          study.patient.displayName,
          formatAge(study.patient.dateOfBirth, study.studyDate),
          study.patient.gender,
          study.modality,
          study.studyDescription,
          study._count.instances,
          study.referringPhysician,
          study.status,
          study.priority,
          study._count.reports,
          studyDateTime(study.studyDate, study.studyTime),
          uploadCompletedAt,
          study.patientHistory?.createdAt ?? null,
          assignment?.assignedAt ?? null,
          signedOffAt,
          verification?.timestamp ?? null,
          assignment?.assignedBy.displayName ?? null,
          assignment?.radiologist.displayName ?? null,
          signedReport?.author.displayName ?? null,
          verification?.actorName ?? null,
          durationDays(uploadCompletedAt, signedOffAt, onInvalidTat),
          durationDays(assignment?.assignedAt ?? null, signedOffAt, onInvalidTat),
        ];
      }
    }
  }

  private findAssignmentEvent(
    assignments: MisStudy['assignments'],
    reporterIds: string[],
    reportCreatedAt: Date | null,
  ) {
    if (!reporterIds.length || !reportCreatedAt) return null;
    const reportTime = reportCreatedAt.getTime();
    return assignments
      .filter(
        (assignment) =>
          reporterIds.includes(assignment.radiologistId) &&
          assignment.assignedAt.getTime() <= reportTime &&
          (!assignment.unassignedAt ||
            assignment.unassignedAt.getTime() >= reportTime),
      )
      .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime())[0] ?? null;
  }
}
