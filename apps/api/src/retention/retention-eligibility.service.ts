import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BackupStatus,
  BackupType,
  ImagingAvailability,
  Prisma,
  ReportStatus,
  StudyStatus,
} from '@prisma/client';
import type {
  RetentionAnchorSource,
  RetentionCandidate,
  RetentionLockReason,
  RetentionPolicy,
} from '@axis/types';
import { resolveBackupEnv } from '../backup/backup-ops.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RetentionActor } from './retention-audit.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NO_HOSPITAL_SCOPE = '__axis_no_hospital__';

const ACTIVE_CORRECTION_STATUSES = new Set([
  'OPEN',
  'ACKNOWLEDGED',
  'APPROVED',
  'IN_PROGRESS',
]);
const ACTIVE_REPORT_STATUSES = new Set<ReportStatus>([
  ReportStatus.DRAFT,
  ReportStatus.MANAGER_REVIEW,
  ReportStatus.HOSPITAL_REVIEW,
  ReportStatus.CORRECTION_REQUESTED,
]);
const ACTIVE_DELIVERY_STATUSES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'RETRYING',
]);
const DELIVERED_STATUSES = new Set(['COMPLETED', 'DELIVERED', 'SUCCESS']);

export const retentionStudyInclude = {
  hospital: { select: { id: true, name: true, isActive: true } },
  patient: {
    select: {
      id: true,
      hospitalId: true,
      patientId: true,
      displayName: true,
      dateOfBirth: true,
      gender: true,
    },
  },
  reports: {
    select: {
      id: true,
      status: true,
      signedOffAt: true,
      signedOffBy: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      contentHash: true,
      findings: true,
      impression: true,
      recommendations: true,
      clinicalHistory: true,
      comparison: true,
      technique: true,
      contentHtml: true,
      criticalFinding: true,
      criticalFindingAcknowledged: true,
      author: {
        select: {
          id: true,
          displayName: true,
          email: true,
          role: true,
        },
      },
      versions: {
        select: {
          id: true,
          reportId: true,
          version: true,
          status: true,
          findings: true,
          impression: true,
          authorId: true,
          contentHash: true,
          createdAt: true,
          recommendations: true,
          clinicalHistory: true,
          comparison: true,
          technique: true,
          contentHtml: true,
          author: {
            select: {
              id: true,
              displayName: true,
              email: true,
              role: true,
            },
          },
        },
      },
    },
  },
  changeRequests: { select: { id: true, status: true } },
  deliveryAttempts: { select: { id: true, status: true } },
  worklistItem: { select: { id: true, completedAt: true } },
  retention: {
    select: {
      id: true,
      status: true,
      retentionLocked: true,
      lockReason: true,
      lockedAt: true,
      cancelCount: true,
      ignoredCount: true,
      nextActionAt: true,
      eligibleAt: true,
      policyVersion: true,
    },
  },
  retentionArchives: {
    select: {
      id: true,
      archiveStatus: true,
      dicomDeleteAt: true,
      metadataDeleteAt: true,
    },
  },
} as const satisfies Prisma.StudyInclude;

export type RetentionStudy = Prisma.StudyGetPayload<{
  include: typeof retentionStudyInclude;
}>;

export interface VerifiedBackup {
  id: string;
  verifiedAt: Date | null;
}

export interface EligibilityResult extends RetentionCandidate {
  anchorAt: Date;
  anchorSource: RetentionAnchorSource;
  blockedByLock: boolean;
  mandatoryUntil: Date | null;
}

export type EligibilityMode = 'MANUAL' | 'LIFECYCLE';

@Injectable()
export class RetentionEligibilityService {
  assertActor(actor: RetentionActor): void {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') {
      throw new ForbiddenException('Only ADMIN or MANAGER may manage retention');
    }
  }

  assertStudyScope(actor: RetentionActor, hospitalId: string | null | undefined): void {
    this.assertActor(actor);
    if (actor.role === 'MANAGER' && (!actor.hospitalId || actor.hospitalId !== hospitalId)) {
      throw new NotFoundException('Study not found');
    }
  }

  actorName(actor: RetentionActor): string {
    return actor.displayName ?? actor.email ?? actor.id;
  }

  cutoff(retentionDays: number, now = new Date()): Date {
    return new Date(now.getTime() - retentionDays * MS_PER_DAY);
  }

  verifiedBackupWhere(): Prisma.BackupRunWhereInput {
    const env = resolveBackupEnv();
    const where: Prisma.BackupRunWhereInput = {
      status: BackupStatus.VERIFIED,
      verifiedAt: { not: null },
      completedAt: { not: null },
      failedAt: null,
      type: BackupType.FULL,
      databaseVerified: true,
      dicomVerified: true,
      databaseObjectKey: { not: null },
      dicomObjectKey: { not: null },
      databaseChecksum: { not: null },
      dicomChecksum: { not: null },
      storageProvider: env.provider,
      environment: env.environment,
    };
    if (env.provider === 'B2') where.remoteVerifiedAt = { not: null };
    return where;
  }

  async findVerifiedBackup(
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<VerifiedBackup | null> {
    return client.backupRun.findFirst({
      where: this.verifiedBackupWhere(),
      orderBy: { verifiedAt: 'desc' },
      select: { id: true, verifiedAt: true },
    });
  }

  async loadStudies(
    client: Prisma.TransactionClient | PrismaService,
    actor: RetentionActor,
    cutoff: Date,
    mode: EligibilityMode,
  ): Promise<RetentionStudy[]> {
    const where: Prisma.StudyWhereInput =
      mode === 'MANUAL'
        ? {
            archivedAt: null,
            OR: [
              { status: StudyStatus.COMPLETED },
              {
                status: { not: StudyStatus.COMPLETED },
                completedAt: null,
                hospitalAcceptedAt: { lte: cutoff },
              },
              {
                status: { not: StudyStatus.COMPLETED },
                completedAt: null,
                hospitalAcceptedAt: null,
                deliveredAt: { lte: cutoff },
              },
              {
                status: { not: StudyStatus.COMPLETED },
                completedAt: null,
                hospitalAcceptedAt: null,
                deliveredAt: null,
                studyDate: { lte: cutoff },
              },
            ],
          }
        : {
            archivedAt: null,
            OR: [
              { status: StudyStatus.COMPLETED, completedAt: { lte: cutoff } },
              {
                status: StudyStatus.HOSPITAL_ACCEPTED,
                hospitalAcceptedAt: { lte: cutoff },
              },
            ],
          };
    if (actor.role === 'MANAGER') {
      where.hospitalId = actor.hospitalId ?? NO_HOSPITAL_SCOPE;
    }
    return client.study.findMany({
      where,
      include: retentionStudyInclude,
      orderBy: [{ studyDate: 'asc' }, { id: 'asc' }],
    });
  }

  evaluate(
    study: RetentionStudy,
    backup: VerifiedBackup | null,
    policy: RetentionPolicy,
    cutoff: Date,
    now: Date,
    mode: EligibilityMode,
  ): EligibilityResult {
    const anchor = this.anchorFor(study, mode);
    const hasActiveCorrection = study.changeRequests.some((changeRequest) =>
      ACTIVE_CORRECTION_STATUSES.has(changeRequest.status),
    );
    const hasActiveReport = study.reports.some((report) =>
      ACTIVE_REPORT_STATUSES.has(report.status),
    );
    const hasActiveDelivery = study.deliveryAttempts.some((attempt) =>
      ACTIVE_DELIVERY_STATUSES.has(attempt.status),
    );
    const hasActiveWorklist =
      Boolean(study.worklistItem) && !study.worklistItem?.completedAt;
    const invalidTenant = study.patient.hospitalId !== study.hospitalId;
    const inactiveHospital = !study.hospital.isActive;
    const imagingNotAvailable =
      study.imagingAvailability !== ImagingAvailability.AVAILABLE;
    const archivalLocked =
      invalidTenant ||
      inactiveHospital ||
      imagingNotAvailable ||
      hasActiveCorrection ||
      hasActiveReport ||
      hasActiveDelivery ||
      hasActiveWorklist;
    const retentionLocked = study.retentionLocked || Boolean(study.retention?.retentionLocked);
    const lockReason = study.retentionLockReason ?? study.retention?.lockReason ?? null;
    const verifiedBackupExists = Boolean(backup);
    const archive = study.retentionArchives[0] ?? null;

    let reason: string | undefined;
    if (study.status !== StudyStatus.COMPLETED && mode === 'MANUAL') {
      reason = 'NOT_TERMINAL';
    } else if (
      mode === 'LIFECYCLE' &&
      study.status !== StudyStatus.COMPLETED &&
      study.status !== StudyStatus.HOSPITAL_ACCEPTED
    ) {
      reason = 'NOT_TERMINAL';
    } else if (anchor.source === 'STUDY_DATE' && mode === 'MANUAL') {
      reason = 'MISSING_LIFECYCLE_ANCHOR';
    } else if (anchor.at.getTime() > cutoff.getTime()) {
      reason = 'RETENTION_NOT_ELAPSED';
    } else if (retentionLocked) {
      reason = 'LEGAL_HOLD';
    } else if (invalidTenant) {
      reason = 'INVALID_TENANT';
    } else if (inactiveHospital) {
      reason = 'INACTIVE_HOSPITAL';
    } else if (imagingNotAvailable) {
      reason = 'IMAGING_NOT_AVAILABLE';
    } else if (hasActiveCorrection) {
      reason = 'ACTIVE_CORRECTION';
    } else if (hasActiveReport) {
      reason = 'ACTIVE_REPORT_WORKFLOW';
    } else if (hasActiveDelivery) {
      reason = 'ACTIVE_DELIVERY';
    } else if (hasActiveWorklist) {
      reason = 'ACTIVE_WORKLIST';
    } else if (mode === 'LIFECYCLE' && !this.hasSignedReport(study)) {
      reason = 'UNSIGNED_REPORT';
    } else if (mode === 'LIFECYCLE' && !this.hasDeliveredReport(study)) {
      reason = 'REPORT_NOT_DELIVERED';
    } else if (
      mode === 'LIFECYCLE' &&
      study.status === StudyStatus.HOSPITAL_ACCEPTED &&
      !study.hospitalAcceptedAt
    ) {
      reason = 'AWAITING_HOSPITAL_ACCEPTANCE';
    } else if (
      policy.mandatoryRetentionDays > 0 &&
      anchor.at.getTime() + policy.mandatoryRetentionDays * MS_PER_DAY > now.getTime()
    ) {
      reason = 'MANDATORY_RETENTION';
    } else if (policy.requiresVerifiedBackup && !verifiedBackupExists) {
      reason = 'NO_VERIFIED_FULL_BACKUP';
    } else if (archive?.archiveStatus === 'FAILED') {
      reason = 'ARCHIVE_FAILED';
    }

    return {
      studyId: study.id,
      studyInstanceUid: study.studyInstanceUid,
      accessionNumber: study.accessionNumber,
      hospitalName: study.hospital.name,
      completedAt: study.completedAt?.toISOString() ?? null,
      retentionAnchorAt: anchor.at.toISOString(),
      retentionAnchorSource: anchor.source,
      daysSinceCompletion: study.completedAt
        ? this.daysSince(study.completedAt, now)
        : 0,
      daysSinceAnchor: this.daysSince(anchor.at, now),
      verifiedBackupExists,
      verifiedBackupId: backup?.id ?? null,
      hasActiveCorrection,
      archivalLocked,
      eligible: reason === undefined,
      reason,
      retentionStatus: study.retention?.status ?? null,
      retentionLocked,
      lockReason: lockReason as RetentionLockReason | null,
      cancelCount: study.retention?.cancelCount ?? 0,
      ignoredCount: study.retention?.ignoredCount ?? 0,
      nextActionAt: study.retention?.nextActionAt?.toISOString() ?? null,
      archiveStatus: archive?.archiveStatus ?? null,
      dicomDeleteAt: archive?.dicomDeleteAt?.toISOString() ?? null,
      metadataDeleteAt: archive?.metadataDeleteAt?.toISOString() ?? null,
      anchorAt: anchor.at,
      anchorSource: anchor.source,
      blockedByLock: retentionLocked,
      mandatoryUntil:
        policy.mandatoryRetentionDays > 0
          ? new Date(anchor.at.getTime() + policy.mandatoryRetentionDays * MS_PER_DAY)
          : null,
    };
  }

  daysSince(date: Date, now: Date): number {
    return Math.max(0, Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY));
  }

  private anchorFor(study: RetentionStudy, mode: EligibilityMode): {
    at: Date;
    source: RetentionAnchorSource;
  } {
    if (study.completedAt) {
      return { at: study.completedAt, source: 'COMPLETED_AT' };
    }
    if (study.hospitalAcceptedAt) {
      return { at: study.hospitalAcceptedAt, source: 'HOSPITAL_ACCEPTED_AT' };
    }
    if (mode === 'MANUAL' && study.deliveredAt) {
      return { at: study.deliveredAt, source: 'DELIVERED_AT' };
    }
    return { at: study.studyDate, source: 'STUDY_DATE' };
  }

  private hasSignedReport(study: RetentionStudy): boolean {
    return study.reports.some(
      (report) =>
        Boolean(report.signedOffAt) ||
        report.status === ReportStatus.SIGNED ||
        report.status === ReportStatus.MANAGER_APPROVED,
    );
  }

  private hasDeliveredReport(study: RetentionStudy): boolean {
    return (
      Boolean(study.deliveredAt) ||
      study.deliveryAttempts.some((attempt) => DELIVERED_STATUSES.has(attempt.status))
    );
  }
}
