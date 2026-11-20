import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  BackupStatus,
  BackupType,
  ImagingAvailability,
  Prisma,
  ReportStatus,
  StudyStatus,
} from '@prisma/client';
import type {
  RetentionCandidate,
  RetentionExecutionResult,
  RetentionPolicy,
  RetentionPreviewResult,
} from '@axis/types';
import { AuditService } from '../audit/audit.service.js';
import { resolveBackupEnv } from '../backup/backup-ops.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface RetentionActor {
  id: string;
  role: string;
  displayName?: string;
  email?: string;
  hospitalId?: string | null;
}

interface VerifiedBackup {
  id: string;
  verifiedAt: Date | null;
}

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

const retentionStudyInclude = {
  hospital: { select: { id: true, name: true, isActive: true } },
  patient: { select: { id: true, hospitalId: true } },
  reports: { select: { id: true, status: true } },
  changeRequests: { select: { id: true, status: true } },
  deliveryAttempts: { select: { id: true, status: true } },
  worklistItem: { select: { id: true, completedAt: true } },
} as const satisfies Prisma.StudyInclude;

type RetentionStudy = Prisma.StudyGetPayload<{
  include: typeof retentionStudyInclude;
}>;

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(
    actor: RetentionActor,
  ): Promise<{ data: RetentionPreviewResult }> {
    this.assertActor(actor);
    const policy = this.policy();
    const cutoff = this.cutoff(policy.retentionDays);
    const now = new Date();
    const [backup, studies] = await Promise.all([
      this.findVerifiedBackup(this.prisma),
      this.loadStudies(this.prisma, actor, cutoff),
    ]);
    const candidates = studies.map((study) =>
      this.evaluateStudy(study, backup, policy, cutoff, now),
    );
    return { data: this.summarize(candidates, policy) };
  }

  async execute(
    actor: RetentionActor,
  ): Promise<{ data: RetentionExecutionResult }> {
    this.assertActor(actor);
    const policy = this.policy();
    const cutoff = this.cutoff(policy.retentionDays);
    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const backup = await this.findVerifiedBackup(tx);
      const studies = await this.loadStudies(tx, actor, cutoff);
      const candidates = studies.map((study) =>
        this.evaluateStudy(study, backup, policy, cutoff, now),
      );
      let archived = 0;

      for (const candidate of candidates) {
        if (!candidate.eligible) continue;
        const update = await tx.study.updateMany({
          where: {
            id: candidate.studyId,
            archivedAt: null,
            status: StudyStatus.COMPLETED,
          },
          data: { archivedAt: now },
        });
        if (update.count !== 1) continue;
        archived += 1;
        await this.audit.createTx(tx, {
          actorId: actor.id,
          actorName: this.actorName(actor),
          actorRole: actor.role,
          action: 'ARCHIVE_MARKED',
          resource: 'STUDY',
          resourceId: candidate.studyId,
          metadata: {
            studyInstanceUid: candidate.studyInstanceUid,
            archivedAt: now.toISOString(),
            verifiedBackupId: candidate.verifiedBackupId ?? null,
          },
        });
      }

      const summary = this.summarize(candidates, policy);
      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: this.actorName(actor),
        actorRole: actor.role,
        action: 'RETENTION_EXECUTED',
        resource: 'RETENTION',
        resourceId: actor.id,
        metadata: {
          reviewed: summary.reviewed,
          eligibleCount: summary.eligibleCount,
          skipped: summary.skipped,
          skippedReasons: summary.skippedReasons,
          archived,
          retentionDays: policy.retentionDays,
          requiresVerifiedBackup: policy.requiresVerifiedBackup,
        },
      });
      return { ...summary, archived };
    });
    return { data: result };
  }

  private assertActor(actor: RetentionActor): void {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') {
      throw new ForbiddenException('Only ADMIN or MANAGER may manage retention');
    }
  }

  private actorName(actor: RetentionActor): string {
    return actor.displayName ?? actor.email ?? actor.id;
  }

  private policy(): RetentionPolicy {
    const raw = Number(process.env.AXIS_RETENTION_DAYS ?? '90');
    const retentionDays =
      Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 90;
    return {
      retentionDays,
      requiresVerifiedBackup:
        String(process.env.AXIS_RETENTION_REQUIRE_BACKUP ?? 'true').toLowerCase() !==
        'false',
    };
  }

  private cutoff(retentionDays: number): Date {
    return new Date(Date.now() - retentionDays * MS_PER_DAY);
  }

  private verifiedBackupWhere(): Prisma.BackupRunWhereInput {
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

  private async findVerifiedBackup(
    client: Prisma.TransactionClient,
  ): Promise<VerifiedBackup | null> {
    return client.backupRun.findFirst({
      where: this.verifiedBackupWhere(),
      orderBy: { verifiedAt: 'desc' },
      select: { id: true, verifiedAt: true },
    });
  }

  private async loadStudies(
    client: Prisma.TransactionClient,
    actor: RetentionActor,
    cutoff: Date,
  ): Promise<RetentionStudy[]> {
    const where: Prisma.StudyWhereInput = {
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

  private anchorFor(study: RetentionStudy): {
    at: Date;
    source: RetentionCandidate['retentionAnchorSource'];
  } {
    if (study.completedAt) {
      return { at: study.completedAt, source: 'COMPLETED_AT' };
    }
    if (study.hospitalAcceptedAt) {
      return { at: study.hospitalAcceptedAt, source: 'HOSPITAL_ACCEPTED_AT' };
    }
    if (study.deliveredAt) {
      return { at: study.deliveredAt, source: 'DELIVERED_AT' };
    }
    return { at: study.studyDate, source: 'STUDY_DATE' };
  }

  private daysSince(date: Date, now: Date): number {
    return Math.max(0, Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY));
  }

  private evaluateStudy(
    study: RetentionStudy,
    backup: VerifiedBackup | null,
    policy: RetentionPolicy,
    cutoff: Date,
    now: Date,
  ): RetentionCandidate {
    const anchor = this.anchorFor(study);
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
    const verifiedBackupExists = Boolean(backup);

    let reason: string | undefined;
    if (study.status !== StudyStatus.COMPLETED) {
      reason = 'NOT_TERMINAL';
    } else if (!study.completedAt) {
      reason = 'MISSING_COMPLETION_TIMESTAMP';
    } else if (study.completedAt.getTime() > cutoff.getTime()) {
      reason = 'RETENTION_NOT_ELAPSED';
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
    } else if (policy.requiresVerifiedBackup && !verifiedBackupExists) {
      reason = 'NO_VERIFIED_FULL_BACKUP';
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
    };
  }

  private summarize(candidates: RetentionCandidate[], policy: RetentionPolicy) {
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      if (!candidate.reason) continue;
      counts.set(candidate.reason, (counts.get(candidate.reason) ?? 0) + 1);
    }
    const skippedReasons = [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
    return {
      candidates,
      eligibleCount: candidates.filter((candidate) => candidate.eligible).length,
      reviewed: candidates.length,
      skipped: candidates.filter((candidate) => !candidate.eligible).length,
      skippedReasons,
      policy,
    };
  }
}
