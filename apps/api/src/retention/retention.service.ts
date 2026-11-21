import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  RetentionAnchorSource,
  RetentionArchiveStatus,
  RetentionJobType,
  RetentionLockReason,
  RetentionStatus,
} from '@prisma/client';
import type {
  RetentionExecutionResult,
  RetentionJobView,
  RetentionNotificationView,
  RetentionPreviewResult,
  RetentionSkipSummary,
  RetentionUpcomingAction,
} from '@axis/types';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RetentionArchiveService } from './retention-archive.service.js';
import type { RetentionActor } from './retention-audit.service.js';
import { RetentionAuditService } from './retention-audit.service.js';
import { retentionPolicy } from './retention-config.js';
import {
  retentionStudyInclude,
  type EligibilityResult,
  RetentionEligibilityService,
} from './retention-eligibility.service.js';
import { RetentionJobService } from './retention-job.service.js';
import { RetentionNotificationService } from './retention-notification.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NO_HOSPITAL_SCOPE = '__axis_no_hospital__';

interface SummaryExtras {
  inspected: number;
  onHold: number;
  awaitingRetention: number;
  awaitingUserResponse: number;
  readyForArchive: number;
  alreadyArchived: number;
  failedArchives: number;
  dicomBackupsDue: number;
  metadataBackupsDue: number;
  upcomingActions: RetentionUpcomingAction[];
}

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly retentionAudit: RetentionAuditService,
    private readonly eligibility: RetentionEligibilityService,
    private readonly archiveService: RetentionArchiveService,
    private readonly notifications: RetentionNotificationService,
    private readonly jobs: RetentionJobService,
  ) {}

  async preview(actor: RetentionActor): Promise<{ data: RetentionPreviewResult }> {
    this.eligibility.assertActor(actor);
    const policy = retentionPolicy();
    const now = new Date();
    const cutoff = this.eligibility.cutoff(policy.retentionDays, now);
    const backup = await this.eligibility.findVerifiedBackup(this.prisma);
    const studies = await this.eligibility.loadStudies(this.prisma, actor, cutoff, 'MANUAL');
    const evaluations = studies.map((study) =>
      this.eligibility.evaluate(study, backup, policy, cutoff, now, 'MANUAL'),
    );
    const extras = await this.summaryExtras(actor, now);
    return {
      data: {
        ...this.summarize(evaluations, policy, studies.length, extras),
      },
    };
  }

  async execute(actor: RetentionActor): Promise<{ data: RetentionExecutionResult }> {
    this.eligibility.assertActor(actor);
    const policy = retentionPolicy();
    const now = new Date();
    const cutoff = this.eligibility.cutoff(policy.retentionDays, now);
    const backup = await this.eligibility.findVerifiedBackup(this.prisma);
    const studies = await this.eligibility.loadStudies(this.prisma, actor, cutoff, 'MANUAL');
    const evaluations = studies.map((study) =>
      this.eligibility.evaluate(study, backup, policy, cutoff, now, 'MANUAL'),
    );
    let archived = 0;
    let processed = 0;
    let archiveFailures = 0;

    for (const evaluation of evaluations) {
      if (!evaluation.eligible) continue;
      processed += 1;
      const retention = await this.ensureRetentionRecord(
        evaluation,
        policy,
        RetentionStatus.ARCHIVING,
        now,
      );
      try {
        const result = await this.archiveService.createArchive(evaluation.studyId, actor);
        if (!result.archived) {
          archiveFailures += 1;
          await this.prisma.studyRetention.update({
            where: { id: retention.id },
            data: { status: RetentionStatus.FAILED, nextActionAt: new Date(now.getTime() + MS_PER_DAY) },
          });
          continue;
        }
        const update = await this.prisma.study.updateMany({
          where: {
            id: evaluation.studyId,
            archivedAt: null,
            status: { in: ['COMPLETED', 'HOSPITAL_ACCEPTED'] },
          },
          data: { archivedAt: now },
        });
        await this.prisma.studyRetention.update({
          where: { id: retention.id },
          data: {
            status: RetentionStatus.ARCHIVED,
            nextActionAt: new Date(now.getTime() + policy.metadataBackupRetentionDays * MS_PER_DAY),
          },
        });
        if (update.count !== 1) continue;
        archived += 1;
        await this.prisma.$transaction(async (tx) => {
          await this.audit.createTx(tx, {
            actorId: actor.id,
            actorName: this.eligibility.actorName(actor),
            actorRole: actor.role,
            action: 'ARCHIVE_MARKED',
            resource: 'STUDY',
            resourceId: evaluation.studyId,
            metadata: {
              studyInstanceUid: evaluation.studyInstanceUid,
              archivedAt: now.toISOString(),
              verifiedBackupId: evaluation.verifiedBackupId ?? null,
              retentionId: retention.id,
            },
          });
        });
      } catch {
        archiveFailures += 1;
        await this.prisma.studyRetention.update({
          where: { id: retention.id },
          data: { status: RetentionStatus.FAILED, nextActionAt: new Date(now.getTime() + MS_PER_DAY) },
        });
      }
    }

    const extras = await this.summaryExtras(actor, now);
    const summary = this.summarize(evaluations, policy, studies.length, extras);
    await this.prisma.$transaction(async (tx) => {
      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: this.eligibility.actorName(actor),
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
          processed,
          archiveFailures,
          retentionDays: policy.retentionDays,
          requiresVerifiedBackup: policy.requiresVerifiedBackup,
        },
      });
    });
    return {
      data: {
        ...summary,
        archived,
        processed,
        jobsCreated: 0,
        notificationsSent: 0,
        archiveFailures,
        skippedByReason: summary.skippedReasons,
      },
    };
  }

  async applyLegalHold(
    studyId: string,
    actor: RetentionActor,
    reason: RetentionLockReason,
    expiresAt?: Date,
  ): Promise<void> {
    this.eligibility.assertActor(actor);
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
      select: { id: true, hospitalId: true },
    });
    if (!study) throw new NotFoundException('Study not found');
    this.assertStudyScope(actor, study.hospitalId);
    await this.prisma.$transaction(async (tx) => {
      const retention = await tx.studyRetention.findUnique({ where: { studyId } });
      const now = new Date();
      const activeCleanup = await tx.retentionArchive.findFirst({
        where: {
          studyId,
          originalDataDeletionStatus: { in: ['IN_PROGRESS', 'FINALIZING'] },
          cleanupClaimUntil: { gt: now },
        },
        select: {
          id: true,
          originalDataDeletionStatus: true,
          orthancDeleteDispatchedAt: true,
        },
      });
      const deleteInFlight = Boolean(activeCleanup?.orthancDeleteDispatchedAt);
      const abortCleanup =
        Boolean(activeCleanup) &&
        !deleteInFlight &&
        (activeCleanup?.originalDataDeletionStatus === 'IN_PROGRESS' ||
          activeCleanup?.originalDataDeletionStatus === 'FINALIZING');
      if (abortCleanup && activeCleanup) {
        await tx.retentionArchive.updateMany({
          where: {
            id: activeCleanup.id,
            originalDataDeletionStatus: { in: ['IN_PROGRESS', 'FINALIZING'] },
            cleanupClaimUntil: { gt: now },
            orthancDeleteDispatchedAt: null,
          },
          data: {
            originalDataDeletionStatus: 'FAILED',
            cleanupClaimUntil: null,
            cleanupFinalized: false,
            lastError: 'LEGAL_HOLD_DURING_CLEANUP',
          },
        });
        await this.retentionAudit.recordTx(tx, {
          studyId,
          retentionId: retention?.id,
          action: 'DELETION_FAILED',
          triggeredBy: 'USER',
          actor,
          status: 'FAILED',
          details: { reason: 'LEGAL_HOLD_DURING_CLEANUP', cleanupAborted: true },
        });
      }
      const backupDeleteInFlight = await tx.retentionArchive.findFirst({
        where: {
          studyId,
          OR: [
            { dicomDeletionStatus: 'DELETING' },
            { metadataDeletionStatus: 'DELETING' },
          ],
        },
        select: { id: true },
      });
      const cleanupBoundaryCrossed = activeCleanup?.originalDataDeletionStatus === 'FINALIZING';
      await tx.study.update({
        where: { id: studyId },
        data: {
          retentionLocked: true,
          retentionLockReason: reason,
          retentionLockedAt: new Date(),
          retentionLockedBy: actor.id,
          retentionLockExpiresAt: expiresAt ?? null,
        },
      });
      if (retention) {
        await tx.studyRetention.update({
          where: { studyId },
          data: {
            retentionLocked: true,
            lockReason: reason,
            lockedAt: new Date(),
            lockedBy: actor.id,
            status: RetentionStatus.ON_HOLD,
          },
        });
      }
      await this.retentionAudit.recordTx(tx, {
        studyId,
        retentionId: retention?.id,
        action: 'RETENTION_LOCK_APPLIED',
        triggeredBy: 'USER',
        actor,
        status: 'SUCCESS',
        details: {
          reason,
          expiresAt: expiresAt?.toISOString() ?? null,
          cleanupBoundaryCrossed,
          cleanupAborted: abortCleanup,
          deleteInFlight,
          backupDeleteInFlight: Boolean(backupDeleteInFlight),
        },
      });
    });
  }

  async releaseLegalHold(studyId: string, actor: RetentionActor): Promise<void> {
    this.eligibility.assertActor(actor);
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
      select: { id: true, hospitalId: true },
    });
    if (!study) throw new NotFoundException('Study not found');
    this.assertStudyScope(actor, study.hospitalId);
    await this.prisma.$transaction(async (tx) => {
      await tx.study.update({
        where: { id: studyId },
        data: {
          retentionLocked: false,
          retentionLockReason: null,
          retentionLockedAt: null,
          retentionLockedBy: null,
          retentionLockExpiresAt: null,
        },
      });
      const retention = await tx.studyRetention.findUnique({ where: { studyId } });
      if (retention) {
        await tx.studyRetention.update({
          where: { studyId },
          data: {
            retentionLocked: false,
            lockReason: null,
            lockedAt: null,
            lockedBy: null,
            status: retention.status === RetentionStatus.ON_HOLD ? RetentionStatus.PENDING_RETENTION : retention.status,
            nextActionAt: new Date(),
          },
        });
      }
      await this.retentionAudit.recordTx(tx, {
        studyId,
        retentionId: retention?.id,
        action: 'RETENTION_LOCK_RELEASED',
        triggeredBy: 'USER',
        actor,
        status: 'SUCCESS',
        details: {},
      });
    });
    const policy = retentionPolicy();
    const now = new Date();
    const freshStudy = await this.prisma.study.findUnique({
      where: { id: studyId },
      include: retentionStudyInclude,
    });
    const backup = await this.eligibility.findVerifiedBackup(this.prisma);
    const recheck = freshStudy
      ? this.eligibility.evaluate(
          freshStudy,
          backup,
          policy,
          this.eligibility.cutoff(policy.retentionDays, now),
          now,
          'LIFECYCLE',
        )
      : null;
    await this.retentionAudit.record({
      studyId,
      action: 'RETENTION_ELIGIBILITY_CHECKED',
      triggeredBy: 'USER',
      actor,
      status: 'SUCCESS',
      details: {
        recheckedAfterRelease: true,
        eligible: recheck?.eligible ?? false,
        reason: recheck?.reason ?? null,
      },
    });
  }

  async listJobs(actor: RetentionActor): Promise<{ data: RetentionJobView[] }> {
    this.eligibility.assertActor(actor);
    const jobs = await this.jobs.list(100, actor);
    return {
      data: jobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        studyId: job.studyId,
        dueAt: job.dueAt.toISOString(),
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError,
      })),
    };
  }

  async retryJob(id: string, actor: RetentionActor): Promise<{ data: { id: string; retried: boolean } }> {
    this.eligibility.assertActor(actor);
    const job = await this.prisma.retentionJob.findUnique({
      where: { id },
      select: { id: true, study: { select: { hospitalId: true } } },
    });
    if (!job) throw new NotFoundException('Retention job not found');
    if (actor.role === 'MANAGER' && job.study?.hospitalId !== actor.hospitalId) {
      throw new NotFoundException('Retention job not found');
    }
    await this.jobs.retry(id, actor);
    return { data: { id, retried: true } };
  }

  async listNotifications(
    actor: RetentionActor,
    limit = 100,
  ): Promise<{ data: RetentionNotificationView[] }> {
    if (!['ADMIN', 'MANAGER', 'HOSPITAL'].includes(actor.role)) {
      throw new ForbiddenException('Only ADMIN, MANAGER, or HOSPITAL may list retention notices');
    }
    return { data: await this.notifications.list(actor, limit) };
  }

  async respondNotification(
    id: string,
    actor: RetentionActor,
    response: 'CANCEL' | 'DELETE',
  ): Promise<{ data: Awaited<ReturnType<RetentionNotificationService['respond']>> }> {
    if (!['ADMIN', 'MANAGER', 'HOSPITAL'].includes(actor.role)) {
      throw new ForbiddenException('Only ADMIN, MANAGER, or HOSPITAL may respond');
    }
    return { data: await this.notifications.respond(id, actor, response) };
  }

  async processJob(job: {
    id: string;
    type: RetentionJobType;
    studyId: string | null;
    retentionId: string | null;
    payload: Prisma.JsonValue;
  }): Promise<string> {
    switch (job.type) {
      case RetentionJobType.START_RETENTION:
        return `lifecycle:${await this.startLifecycle()}`;
      case RetentionJobType.SEND_NOTIFICATION:
        return `notifications:${await this.notifications.sendDueNotifications()}`;
      case RetentionJobType.MARK_IGNORED:
        return `ignored:${await this.notifications.markIgnoredDue()}`;
      case RetentionJobType.PROCESS_ARCHIVE:
        return `archive:${await this.processArchiveJob(job)}`;
      case RetentionJobType.CLEANUP_ORIGINAL: {
        if (!job.studyId) throw new Error('Cleanup job is missing studyId');
        const result = await this.archiveService.cleanupOriginalData(job.studyId);
        return result.deleted ? 'cleanup:deleted' : `cleanup:${result.reason}`;
      }
      case RetentionJobType.DELETE_EXPIRED_BACKUPS: {
        const result = await this.archiveService.processDueBackups();
        return `backups:${JSON.stringify(result)}`;
      }
      default:
        throw new Error(`Unsupported retention job type ${job.type}`);
    }
  }

  async startLifecycle(): Promise<number> {
    const policy = retentionPolicy();
    const now = new Date();
    const cutoff = this.eligibility.cutoff(policy.initialRetentionDays, now);
    const backup = await this.eligibility.findVerifiedBackup(this.prisma);
    const actor: RetentionActor = {
      id: 'system',
      role: 'ADMIN',
      displayName: 'Retention scheduler',
    };
    const studies = await this.eligibility.loadStudies(
      this.prisma,
      actor,
      cutoff,
      'LIFECYCLE',
    );
    let started = 0;
    for (const study of studies) {
      const evaluation = this.eligibility.evaluate(
        study,
        backup,
        policy,
        cutoff,
        now,
        'LIFECYCLE',
      );
      if (!evaluation.eligible) continue;
      const existing = await this.prisma.studyRetention.findUnique({
        where: { studyId: study.id },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== RetentionStatus.FAILED) continue;
      if (!existing) {
        await this.prisma.studyRetention.create({
          data: {
            studyId: study.id,
            status: RetentionStatus.PENDING_RETENTION,
            eligibleAt: evaluation.anchorAt,
            anchorAt: evaluation.anchorAt,
            anchorSource: evaluation.anchorSource as RetentionAnchorSource,
            policyVersion: policy.policyVersion,
            retentionLocked: evaluation.blockedByLock,
            lockReason: evaluation.lockReason,
            lockedAt: evaluation.blockedByLock ? now : null,
            nextActionAt: new Date(evaluation.anchorAt.getTime() + policy.initialRetentionDays * MS_PER_DAY),
          },
        });
      } else {
        await this.prisma.studyRetention.update({
          where: { id: existing.id },
          data: {
            status: RetentionStatus.PENDING_RETENTION,
            nextActionAt: new Date(evaluation.anchorAt.getTime() + policy.initialRetentionDays * MS_PER_DAY),
          },
        });
      }
      const retention = await this.prisma.studyRetention.findUnique({
        where: { studyId: study.id },
        select: { id: true },
      });
      if (!retention) continue;
      await this.jobs.enqueue({
        type: RetentionJobType.SEND_NOTIFICATION,
        dedupeKey: `retention-notify:${retention.id}`,
        dueAt: new Date(evaluation.anchorAt.getTime() + policy.initialRetentionDays * MS_PER_DAY),
        studyId: study.id,
        retentionId: retention.id,
        payload: { retentionId: retention.id },
      });
      await this.retentionAudit.record({
        studyId: study.id,
        retentionId: retention.id,
        action: 'RETENTION_STARTED',
        triggeredBy: 'SCHEDULER',
        status: 'SUCCESS',
        details: {
          anchorAt: evaluation.anchorAt.toISOString(),
          anchorSource: evaluation.anchorSource,
          policyVersion: policy.policyVersion,
        },
      });
      started += 1;
    }
    return started;
  }

  private async processArchiveJob(job: {
    studyId: string | null;
    retentionId: string | null;
    payload: Prisma.JsonValue;
  }): Promise<string> {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const retentionId =
      job.retentionId ?? (typeof payload.retentionId === 'string' ? payload.retentionId : null);
    const retention = await this.prisma.studyRetention.findUnique({
      where: { id: retentionId as string },
      select: { id: true, studyId: true, retentionLocked: true, status: true },
    });
    if (!retention || !retentionId) throw new Error('Archive job is missing retentionId');
    if (retention.retentionLocked) {
      await this.prisma.studyRetention.update({
        where: { id: retentionId },
        data: { status: RetentionStatus.ON_HOLD },
      });
      return 'locked';
    }
    const result = await this.archiveService.createArchive(retention.studyId);
    if (!result.archived) throw new Error(result.reason ?? 'Archive failed');
    const policy = retentionPolicy();
    await this.prisma.study.updateMany({
      where: { id: retention.studyId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    await this.prisma.studyRetention.update({
      where: { id: retentionId },
      data: {
        status: RetentionStatus.ARCHIVED,
        nextActionAt: new Date(Date.now() + policy.metadataBackupRetentionDays * MS_PER_DAY),
      },
    });
    if (!policy.dryRun && policy.destructiveEnabled) {
      await this.jobs.enqueue({
        type: RetentionJobType.CLEANUP_ORIGINAL,
        dedupeKey: `retention-cleanup:${retentionId}`,
        dueAt: new Date(),
        studyId: retention.studyId,
        retentionId,
        payload: { retentionId },
      });
    }
    return result.archiveId ?? 'archived';
  }

  private async ensureRetentionRecord(
    evaluation: EligibilityResult,
    policy: ReturnType<typeof retentionPolicy>,
    status: RetentionStatus,
    now: Date,
  ) {
    const existing = await this.prisma.studyRetention.findUnique({
      where: { studyId: evaluation.studyId },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.studyRetention.update({
        where: { id: existing.id },
        data: { status, policyVersion: policy.policyVersion, nextActionAt: now },
      });
      return existing;
    }
    return this.prisma.studyRetention.create({
      data: {
        studyId: evaluation.studyId,
        status,
        eligibleAt: evaluation.anchorAt,
        anchorAt: evaluation.anchorAt,
        anchorSource: evaluation.anchorSource as RetentionAnchorSource,
        policyVersion: policy.policyVersion,
        retentionLocked: evaluation.blockedByLock,
        lockReason: evaluation.lockReason,
        nextActionAt: now,
      },
      select: { id: true },
    });
  }

  private async summaryExtras(
    actor: RetentionActor,
    now: Date,
  ): Promise<SummaryExtras> {
    const scope = actor.role === 'MANAGER' ? { hospitalId: actor.hospitalId ?? NO_HOSPITAL_SCOPE } : {};
    const [
      alreadyArchived,
      failedArchives,
      dicomBackupsDue,
      metadataBackupsDue,
      onHold,
      awaitingRetention,
      awaitingUserResponse,
      readyForArchive,
      jobs,
    ] = await Promise.all([
      this.prisma.study.count({ where: { ...scope, archivedAt: { not: null } } }),
      this.prisma.retentionArchive.count({
        where: { archiveStatus: RetentionArchiveStatus.FAILED, study: scope },
      }),
      this.prisma.retentionArchive.count({
        where: {
          archiveStatus: { notIn: [RetentionArchiveStatus.DELETED] },
          dicomObjectOwned: true,
          dicomDeletionStatus: 'PENDING',
          dicomDeleteAt: { lte: now },
          study: scope,
        },
      }),
      this.prisma.retentionArchive.count({
        where: {
          archiveStatus: { notIn: [RetentionArchiveStatus.DELETED] },
          metadataDeletionStatus: 'PENDING',
          metadataDeleteAt: { lte: now },
          study: scope,
        },
      }),
      this.prisma.studyRetention.count({
        where: { status: RetentionStatus.ON_HOLD, study: scope },
      }),
      this.prisma.studyRetention.count({
        where: { status: RetentionStatus.PENDING_RETENTION, study: scope },
      }),
      this.prisma.studyRetention.count({
        where: { status: RetentionStatus.AWAITING_USER_RESPONSE, study: scope },
      }),
      this.prisma.studyRetention.count({
        where: { status: RetentionStatus.AUTOMATIC_PROCESSING, study: scope },
      }),
      this.prisma.retentionJob.findMany({
        where: {
          status: 'PENDING',
          dueAt: { lte: new Date(now.getTime() + MS_PER_DAY) },
          study: scope,
        },
        take: 10,
        orderBy: { dueAt: 'asc' },
        select: { type: true, dueAt: true, status: true, studyId: true },
      }),
    ]);
    return {
      inspected: 0,
      onHold,
      awaitingRetention,
      awaitingUserResponse,
      readyForArchive,
      alreadyArchived,
      failedArchives,
      dicomBackupsDue,
      metadataBackupsDue,
      upcomingActions: jobs.map((job) => ({
        studyId: job.studyId,
        type: job.type,
        dueAt: job.dueAt.toISOString(),
        status: job.status,
      })),
    };
  }

  private summarize(
    evaluations: EligibilityResult[],
    policy: ReturnType<typeof retentionPolicy>,
    inspected: number,
    extras: SummaryExtras,
  ): RetentionPreviewResult {
    const counts = new Map<string, number>();
    for (const evaluation of evaluations) {
      if (!evaluation.reason) continue;
      counts.set(evaluation.reason, (counts.get(evaluation.reason) ?? 0) + 1);
    }
    const skippedReasons: RetentionSkipSummary[] = [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
    const eligibleCount = evaluations.filter((item) => item.eligible).length;
    return {
      candidates: evaluations.map(({ anchorAt: _anchorAt, ...candidate }) => candidate) as RetentionPreviewResult['candidates'],
      eligibleCount,
      reviewed: evaluations.length,
      inspected,
      eligible: eligibleCount,
      ineligible: evaluations.length - eligibleCount,
      onHold: extras.onHold,
      awaitingRetention: extras.awaitingRetention,
      awaitingUserResponse: extras.awaitingUserResponse,
      readyForArchive: extras.readyForArchive,
      alreadyArchived: extras.alreadyArchived,
      failedArchives: extras.failedArchives,
      dicomBackupsDue: extras.dicomBackupsDue,
      metadataBackupsDue: extras.metadataBackupsDue,
      skipped: evaluations.length - eligibleCount,
      skippedReasons,
      upcomingActions: extras.upcomingActions,
      policy,
    };
  }

  private assertStudyScope(actor: RetentionActor, hospitalId: string): void {
    this.eligibility.assertStudyScope(actor, hospitalId);
  }
}
