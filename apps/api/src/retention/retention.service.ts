import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditResource, BackupStatus, ChangeRequestStatus, StudyStatus } from '@prisma/client';
import type { RetentionCandidate, RetentionPreviewResult } from '@axis/types';

const ACTIVE_CORRECTION_STUDY_STATUSES: StudyStatus[] = [
  StudyStatus.CORRECTION_REQUESTED,
  StudyStatus.HOSPITAL_CHANGE_REQUESTED,
];

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private retentionDays(): number {
    const n = Number(process.env.AXIS_RETENTION_DAYS);
    return Number.isFinite(n) && n > 0 ? n : 90;
  }

  private requireVerifiedBackup(): boolean {
    return String(process.env.AXIS_RETENTION_REQUIRE_BACKUP ?? 'true') !== 'false';
  }

  private async buildCandidates(): Promise<RetentionCandidate[]> {
    const retentionDays = this.retentionDays();
    const requireBackup = this.requireVerifiedBackup();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const studies = await this.prisma.study.findMany({
      where: {
        status: StudyStatus.COMPLETED,
        archivedAt: null,
        completedAt: { lte: cutoff },
      },
      include: {
        hospital: { select: { name: true } },
        changeRequests: { select: { status: true } },
      },
    });

    const backupExists = await this.prisma.backupRun.count({
      where: { status: { in: [BackupStatus.VERIFIED, BackupStatus.COMPLETED] } },
    });

    return studies.map((s) => {
      const daysSinceCompletion = Math.floor(
        (Date.now() - (s.completedAt ?? new Date()).getTime()) / 86400000,
      );
      const hasActiveCorrection = s.changeRequests.some(
        (cr) =>
          cr.status === ChangeRequestStatus.OPEN ||
          cr.status === ChangeRequestStatus.ACKNOWLEDGED ||
          cr.status === ChangeRequestStatus.APPROVED ||
          cr.status === ChangeRequestStatus.IN_PROGRESS,
      );
      const verifiedBackupExists = backupExists > 0 || !requireBackup;
      const reason: string[] = [];
      if (!verifiedBackupExists) reason.push('no verified backup');

      const eligible = verifiedBackupExists && !hasActiveCorrection;

      return {
        studyId: s.id,
        studyInstanceUid: s.studyInstanceUid,
        accessionNumber: s.accessionNumber,
        hospitalName: s.hospital.name,
        completedAt: s.completedAt?.toISOString() ?? null,
        daysSinceCompletion,
        verifiedBackupExists,
        hasActiveCorrection,
        archivalLocked: s.archivedAt !== null,
        eligible,
        reason: reason.length ? reason.join(', ') : undefined,
      };
    });
  }

  async preview(
    actor: { id: string; role: string; displayName?: string },
  ): Promise<{ data: RetentionPreviewResult }> {
    const retentionDays = this.retentionDays();
    const requireBackup = this.requireVerifiedBackup();
    const candidates = await this.buildCandidates();
    const eligibleCount = candidates.filter((c) => c.eligible).length;
    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName ?? actor.role,
      actorRole: actor.role,
      action: AuditAction.RETENTION_PREVIEW,
      resource: AuditResource.RETENTION,
      resourceId: 'preview',
      metadata: { retentionDays, requireBackup, candidates: candidates.length, eligibleCount },
    });
    return {
      data: {
        candidates,
        eligibleCount,
        policy: { retentionDays, requiresVerifiedBackup: requireBackup },
      },
    };
  }

  async execute(
    actor: { id: string; role: string; displayName?: string },
  ): Promise<{ data: unknown }> {
    const retentionDays = this.retentionDays();
    const requireBackup = this.requireVerifiedBackup();
    const candidates = await this.buildCandidates();
    const eligible = candidates.filter((c) => c.eligible);

    let archived = 0;
    for (const c of eligible) {
      await this.prisma.study.update({
        where: { id: c.studyId },
        data: { archivedAt: new Date() },
      });
      await this.audit.create({
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: AuditAction.ARCHIVE_MARKED,
        resource: AuditResource.STUDY,
        resourceId: c.studyId,
        metadata: { retentionDays, reason: 'retention_policy_archive' },
      });
      archived++;
    }

    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName ?? actor.role,
      actorRole: actor.role,
      action: AuditAction.RETENTION_EXECUTED,
      resource: AuditResource.RETENTION,
      resourceId: 'retention-job',
      metadata: { retentionDays, requireBackup, archived },
    });

    return {
      data: {
        policy: { retentionDays, requiresVerifiedBackup: requireBackup },
        reviewed: candidates.length,
        archived,
        skipped: candidates.length - archived,
      },
    };
  }
}
