import { promises as fs } from 'fs';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  RetentionArchiveStatus,
  RetentionJobType,
  RetentionStatus,
} from '@prisma/client';
import {
  BACKUP_STORAGE,
  type ArtifactMetadata,
  type BackupStorage,
} from '../backup/backup-storage.js';
import {
  resolveBackupEnv,
  sha256File,
} from '../backup/backup-ops.js';
import {
  createDicomWebArchive,
  deleteOrthancStudy,
  orthancStudyExists,
} from '../backup/dicom-backup.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  archivedReportMatchesStudy,
  buildArchivedReportArtifact,
  buildArchivedStudyArtifact,
  buildRetentionArchiveManifest,
  parseRetentionArchiveManifest,
} from './retention-archive.dto.js';
import { booleanEnv, RETENTION_ENV_FLAGS, retentionPolicy } from './retention-config.js';
import { RetentionAuditService, type RetentionActor } from './retention-audit.service.js';
import {
  retentionStudyInclude,
  RetentionEligibilityService,
  type RetentionStudy,
} from './retention-eligibility.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ARCHIVE_CLAIM_MS = 10 * 60 * 1000;
const CLEANUP_CLAIM_MS = 10 * 60 * 1000;

type ArchiveStudy = RetentionStudy;

interface UploadedArtifactRecord {
  file: string;
  key: string;
  sha256: string;
}

interface ExistingArchiveArtifacts {
  dicomObjectKey: string | null;
  dicomChecksum: string | null;
  studyObjectKey: string | null;
  reportObjectKey: string | null;
  manifestObjectKey: string | null;
  checksum: string | null;
  uploadedArtifacts: Prisma.JsonValue | null;
}

interface CleanupArchive {
  id: string;
  dicomObjectKey: string | null;
  dicomObjectOwned: boolean;
  dicomChecksum: string | null;
  manifestObjectKey: string | null;
  reportObjectKey: string | null;
  studyObjectKey: string | null;
  checksum: string | null;
  backupRunId: string | null;
  contentVerifiedAt: Date | null;
  uploadedArtifacts: Prisma.JsonValue | null;
}

function artifactChecksum(
  artifacts: Prisma.JsonValue | null,
  key: string,
): string | null {
  if (!Array.isArray(artifacts)) return null;
  const match = artifacts.find((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const record = item as Partial<UploadedArtifactRecord>;
    return record.key === key && typeof record.sha256 === 'string';
  }) as UploadedArtifactRecord | undefined;
  return match?.sha256 ?? null;
}

function retentionObjectKey(
  studyId: string,
  archiveId: string,
  fileName: string,
): string {
  const env = resolveBackupEnv();
  const prefix = env.b2Prefix || 'teleradiology-backup';
  return `${prefix}/retention/studies/${studyId}/${archiveId}/${fileName}`;
}

function retentionScratchPath(
  studyId: string,
  archiveId: string,
): string {
  const env = resolveBackupEnv();
  return `${env.backupDir}/retention-scratch/${studyId}/${archiveId}`;
}

function storageMetadata(
  archiveId: string,
  checksum: string,
): ArtifactMetadata {
  return {
    backupRunId: archiveId,
    artifact: 'retention',
    checksum,
    createdAt: new Date().toISOString(),
  };
}

@Injectable()
export class RetentionArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BACKUP_STORAGE) private readonly storage: BackupStorage,
    private readonly eligibility: RetentionEligibilityService,
    private readonly audit: RetentionAuditService,
  ) {}

  async createArchive(
    studyId: string,
    actor?: RetentionActor,
  ): Promise<{ archiveId: string | null; archived: boolean; reason?: string }> {
    const policy = retentionPolicy();
    const now = new Date();
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
      include: retentionStudyInclude,
    });
    if (!study) return { archiveId: null, archived: false, reason: 'STUDY_NOT_FOUND' };
    if (actor) this.eligibility.assertStudyScope(actor, study.hospitalId);

    const backup = await this.eligibility.findVerifiedBackup(this.prisma);
    const evaluation = this.eligibility.evaluate(
      study,
      backup,
      policy,
      this.eligibility.cutoff(policy.retentionDays, now),
      now,
      'MANUAL',
    );
    if (!evaluation.eligible) {
      return { archiveId: null, archived: false, reason: evaluation.reason };
    }
    if (study.retentionLocked) {
      return { archiveId: null, archived: false, reason: 'LEGAL_HOLD' };
    }
    if (!study.retention) {
      return { archiveId: null, archived: false, reason: 'RETENTION_RECORD_REQUIRED' };
    }

    const existing = await this.prisma.retentionArchive.findUnique({
      where: { studyId },
      select: {
        id: true,
        retentionId: true,
        archiveStatus: true,
        archiveVerifiedAt: true,
        claimUntil: true,
        dicomObjectKey: true,
        studyObjectKey: true,
        reportObjectKey: true,
        manifestObjectKey: true,
        checksum: true,
        dicomChecksum: true,
        dicomDeleteAt: true,
        metadataDeleteAt: true,
        backupRunId: true,
        uploadedArtifacts: true,
      },
    });
    if (
      existing?.archiveStatus === RetentionArchiveStatus.ARCHIVED ||
      existing?.archiveStatus === RetentionArchiveStatus.DELETING ||
      existing?.archiveStatus === RetentionArchiveStatus.DELETED
    ) {
      return { archiveId: existing.id, archived: true };
    }
    const claimUntil = existing?.claimUntil;
    const staleClaim = !claimUntil || claimUntil.getTime() <= now.getTime();
    if (existing?.archiveStatus === RetentionArchiveStatus.ARCHIVING && !staleClaim) {
      return { archiveId: existing.id, archived: false, reason: 'ARCHIVE_IN_PROGRESS' };
    }

    let archiveId = existing?.id ?? null;
    if (!existing) {
      const data: Prisma.RetentionArchiveCreateInput = {
        study: { connect: { id: studyId } },
        retention: { connect: { id: study.retention.id } },
        archiveStatus: RetentionArchiveStatus.ARCHIVING,
        claimUntil: new Date(now.getTime() + ARCHIVE_CLAIM_MS),
        retryCount: 0,
      };
      if (backup) {
        data.backupRun = { connect: { id: backup.id } };
      }
      const created = await this.prisma.retentionArchive.create({
        data,
        select: { id: true },
      });
      archiveId = created.id;
    } else {
      const claimed = await this.prisma.retentionArchive.updateMany({
        where: {
          id: existing.id,
          archiveStatus: {
            in: [
              RetentionArchiveStatus.FAILED,
              RetentionArchiveStatus.ARCHIVING,
            ],
          },
          OR: [{ claimUntil: null }, { claimUntil: { lt: now } }],
        },
        data: {
          archiveStatus: RetentionArchiveStatus.ARCHIVING,
          claimUntil: new Date(now.getTime() + ARCHIVE_CLAIM_MS),
          retryCount: { increment: 1 },
          lastError: null,
        },
      });
      if (claimed.count !== 1) {
        return { archiveId: existing.id, archived: false, reason: 'ARCHIVE_IN_PROGRESS' };
      }
    }
    if (!archiveId) return { archiveId: null, archived: false, reason: 'ARCHIVE_CREATE_FAILED' };

    const retention = await this.prisma.studyRetention.findUnique({
      where: { studyId },
      select: { id: true },
    });
    if (retention && archiveId && existing?.retentionId !== retention.id) {
      await this.prisma.retentionArchive.update({
        where: { id: archiveId },
        data: { retentionId: retention.id },
      });
    }

    try {
      const result = await this.writeArchive(archiveId, study, backup, now, policy, existing);
      await this.prisma.retentionArchive.update({
        where: { id: archiveId },
        data: {
          archiveStatus: RetentionArchiveStatus.ARCHIVED,
          archiveCreatedAt: now,
          archiveVerifiedAt: new Date(),
          dicomObjectKey: result.dicomObjectKey,
          dicomObjectOwned: result.dicomObjectOwned,
          dicomChecksum: result.dicomChecksum,
          studyObjectKey: result.studyObjectKey,
          reportObjectKey: result.reportObjectKey,
          manifestObjectKey: result.manifestObjectKey,
          checksum: result.manifestChecksum,
          contentVerifiedAt: result.contentVerifiedAt,
          uploadedArtifacts: result.uploadedArtifacts as unknown as Prisma.InputJsonValue,
          cleanupFinalized: false,
          dicomDeleteAt: result.dicomObjectOwned
            ? new Date(now.getTime() + policy.dicomBackupRetentionDays * MS_PER_DAY)
            : null,
          metadataDeleteAt: new Date(
            now.getTime() + policy.metadataBackupRetentionDays * MS_PER_DAY,
          ),
          originalDataDeletionStatus: 'PENDING',
          dicomDeletionStatus: 'PENDING',
          metadataDeletionStatus: 'PENDING',
          claimUntil: null,
          lastError: null,
        },
      });
      await this.audit.record({
        studyId,
        retentionId: retention?.id,
        action: 'ARCHIVE_CREATED',
        triggeredBy: actor ? 'USER' : 'SYSTEM',
        actor,
        status: 'SUCCESS',
        details: {
          archiveId,
          archiveCreatedAt: now.toISOString(),
          dicomObjectKey: result.dicomObjectKey ? 'present' : null,
          dicomObjectOwned: result.dicomObjectOwned,
          metadataObjectKeyPresent: Boolean(result.studyObjectKey),
        },
      });
      await this.audit.record({
        studyId,
        retentionId: retention?.id,
        action: 'ARCHIVE_VERIFIED',
        triggeredBy: actor ? 'USER' : 'SYSTEM',
        actor,
        status: 'SUCCESS',
        details: {
          archiveId,
          checksum: result.manifestChecksum,
          contentVerifiedAt: result.contentVerifiedAt.toISOString(),
          verifiedAt: new Date().toISOString(),
        },
      });
      return { archiveId, archived: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.retentionArchive.update({
        where: { id: archiveId },
        data: {
          archiveStatus: RetentionArchiveStatus.FAILED,
          claimUntil: null,
          lastError: message.replace(/[\r\n]+/g, ' ').slice(0, 2000),
        },
      });
      await this.audit.record({
        studyId,
        retentionId: retention?.id,
        action: 'ARCHIVE_FAILED',
        triggeredBy: actor ? 'USER' : 'SYSTEM',
        actor,
        status: 'FAILED',
        details: { archiveId, error: message.slice(0, 500) },
      });
      throw error;
    }
  }

  private async claimBackupObjectDeletion(
    archiveId: string,
    kind: 'DICOM_BACKUP' | 'METADATA_BACKUP',
  ): Promise<boolean> {
    const now = new Date();
    const data: Prisma.RetentionArchiveUpdateManyMutationInput =
      kind === 'DICOM_BACKUP'
        ? { dicomDeletionStatus: 'DELETING' }
        : { metadataDeletionStatus: 'DELETING' };
    const where: Prisma.RetentionArchiveWhereInput = {
      id: archiveId,
      archiveStatus: { in: [RetentionArchiveStatus.ARCHIVED, RetentionArchiveStatus.DELETING] },
      study: { retentionLocked: false },
      retention: { retentionLocked: false },
      ...(kind === 'DICOM_BACKUP'
        ? {
            dicomObjectOwned: true,
            dicomObjectKey: { not: null },
            dicomDeleteAt: { lte: now },
            dicomDeletionStatus: 'PENDING',
          }
        : {
            metadataDeleteAt: { lte: now },
            metadataDeletionStatus: 'PENDING',
            studyObjectKey: { not: null },
            reportObjectKey: { not: null },
            manifestObjectKey: { not: null },
          }),
    };
    const updated = await this.prisma.retentionArchive.updateMany({ where, data });
    return updated.count === 1;
  }

  private async assertBackupObjectDeletionAllowed(
    archiveId: string,
    key: string,
    kind: 'DICOM_BACKUP' | 'METADATA_BACKUP',
  ): Promise<void> {
    const policy = retentionPolicy();
    if (policy.dryRun || !booleanEnv(RETENTION_ENV_FLAGS.backupDeleteEnabled, false)) {
      throw new Error('DELETION_DISABLED');
    }
    const archive = await this.prisma.retentionArchive.findUnique({
      where: { id: archiveId },
      select: {
        archiveStatus: true,
        dicomObjectOwned: true,
        dicomObjectKey: true,
        dicomChecksum: true,
        dicomDeleteAt: true,
        dicomDeletionStatus: true,
        metadataDeleteAt: true,
        metadataDeletionStatus: true,
        studyObjectKey: true,
        reportObjectKey: true,
        manifestObjectKey: true,
        uploadedArtifacts: true,
        study: { include: retentionStudyInclude },
        retention: { select: { retentionLocked: true } },
      },
    });
    if (!archive) throw new Error('ARCHIVE_NOT_FOUND');
    if (archive.study.retentionLocked || archive.retention?.retentionLocked) {
      throw new Error('LEGAL_HOLD');
    }
    if (
      archive.archiveStatus !== RetentionArchiveStatus.ARCHIVED &&
      archive.archiveStatus !== RetentionArchiveStatus.DELETING
    ) {
      throw new Error('ARCHIVE_STATUS_INVALID');
    }
    const now = new Date();
    if (kind === 'DICOM_BACKUP') {
      if (
        !archive.dicomObjectOwned ||
        archive.dicomObjectKey !== key ||
        !archive.dicomChecksum ||
        archive.dicomDeletionStatus !== 'DELETING' ||
        !archive.dicomDeleteAt ||
        archive.dicomDeleteAt > now
      ) {
        throw new Error('DICOM_EXPIRY_NOT_AUTHORIZED');
      }
    } else {
      const metadataKeys = [
        archive.studyObjectKey,
        archive.reportObjectKey,
        archive.manifestObjectKey,
      ].filter((candidate): candidate is string => Boolean(candidate));
      if (
        !metadataKeys.includes(key) ||
        artifactChecksum(archive.uploadedArtifacts, key) === null ||
        archive.metadataDeletionStatus !== 'DELETING' ||
        !archive.metadataDeleteAt ||
        archive.metadataDeleteAt > now
      ) {
        throw new Error('METADATA_EXPIRY_NOT_AUTHORIZED');
      }
    }
    const backup = await this.eligibility.findVerifiedBackup(this.prisma);
    const evaluation = this.eligibility.evaluate(
      archive.study,
      backup,
      policy,
      this.eligibility.cutoff(policy.retentionDays, now),
      now,
      'LIFECYCLE',
    );
    if (!evaluation.eligible) {
      throw new Error(`DELETION_NOT_ELIGIBLE:${evaluation.reason ?? 'UNKNOWN'}`);
    }
  }

  async processDueBackups(): Promise<{
    evaluated: number;
    dicomDeleted: number;
    metadataDeleted: number;
    skipped: number;
    failed: number;
  }> {
    const policy = retentionPolicy();
    const enabled =
      booleanEnv(RETENTION_ENV_FLAGS.backupDeleteEnabled, false) && !policy.dryRun;
    const now = new Date();
    const archives = await this.prisma.retentionArchive.findMany({
      where: {
        archiveStatus: {
          in: [RetentionArchiveStatus.ARCHIVED, RetentionArchiveStatus.DELETING],
        },
        study: { retentionLocked: false },
        retention: { retentionLocked: false },
        OR: [
          {
            dicomObjectOwned: true,
            dicomDeleteAt: { lte: now },
            dicomDeletionStatus: 'PENDING',
          },
          {
            metadataDeleteAt: { lte: now },
            metadataDeletionStatus: 'PENDING',
          },
        ],
      },
      select: {
        id: true,
        studyId: true,
        retentionId: true,
        archiveStatus: true,
        dicomObjectOwned: true,
        dicomDeleteAt: true,
        metadataDeleteAt: true,
        dicomObjectKey: true,
        dicomChecksum: true,
        studyObjectKey: true,
        reportObjectKey: true,
        manifestObjectKey: true,
        checksum: true,
        uploadedArtifacts: true,
        dicomDeletionStatus: true,
        metadataDeletionStatus: true,
      },
    });
    const result = { evaluated: archives.length, dicomDeleted: 0, metadataDeleted: 0, skipped: 0, failed: 0 };
    if (!enabled) {
      result.skipped = archives.length;
      return result;
    }

    for (const archive of archives) {
      let dicomDeleted = archive.dicomDeletionStatus === 'DELETED';
      let metadataDeleted = archive.metadataDeletionStatus === 'DELETED';
      let dicomStatus = archive.dicomDeletionStatus;
      let metadataStatus = archive.metadataDeletionStatus;
      try {
        if (
          archive.dicomDeleteAt &&
          archive.dicomDeleteAt <= now &&
          archive.dicomDeletionStatus === 'PENDING'
        ) {
          if (!archive.dicomObjectKey) {
            result.skipped += 1;
          } else if (!(await this.claimBackupObjectDeletion(archive.id, 'DICOM_BACKUP'))) {
            result.skipped += 1;
          } else {
            dicomStatus = 'DELETING';
            if (!(await this.deleteObject(
              archive.dicomObjectKey,
              archive.dicomChecksum,
              archive.id,
              'DICOM_BACKUP',
            ))) {
              result.failed += 1;
              await this.prisma.retentionArchive.update({
                where: { id: archive.id },
                data: { dicomDeletionStatus: 'FAILED', cleanupFinalized: false },
              });
              dicomStatus = 'FAILED';
            } else {
              dicomDeleted = true;
              dicomStatus = 'DELETED';
              result.dicomDeleted += 1;
              await this.audit.record({
                studyId: archive.studyId,
                retentionId: archive.retentionId,
                action: 'DICOM_BACKUP_DELETED',
                triggeredBy: 'SCHEDULER',
                status: 'SUCCESS',
                details: { archiveId: archive.id, deletedAt: now.toISOString() },
              });
              await this.audit.record({
                studyId: archive.studyId,
                retentionId: archive.retentionId,
                action: 'PERMANENT_DELETION_VERIFIED',
                triggeredBy: 'SCHEDULER',
                status: 'SUCCESS',
                details: { archiveId: archive.id, objectType: 'DICOM_BACKUP' },
              });
            }
          }
        }
        if (
          archive.metadataDeleteAt &&
          archive.metadataDeleteAt <= now &&
          archive.metadataDeletionStatus === 'PENDING'
        ) {
          const keys = [
            archive.studyObjectKey,
            archive.reportObjectKey,
            archive.manifestObjectKey,
          ].filter((key): key is string => Boolean(key));
          if (!keys.length) {
            result.skipped += 1;
          } else if (!(await this.claimBackupObjectDeletion(archive.id, 'METADATA_BACKUP'))) {
            result.skipped += 1;
          } else {
            metadataStatus = 'DELETING';
            let deletedAll = true;
            for (const key of keys) {
              const checksum = artifactChecksum(archive.uploadedArtifacts, key) ?? archive.checksum;
              if (!(await this.deleteObject(key, checksum, archive.id, 'METADATA_BACKUP'))) {
                deletedAll = false;
                break;
              }
            }
            if (!deletedAll) {
              result.failed += 1;
              await this.prisma.retentionArchive.update({
                where: { id: archive.id },
                data: { metadataDeletionStatus: 'FAILED', cleanupFinalized: false },
              });
              metadataStatus = 'FAILED';
            } else {
              metadataDeleted = true;
              metadataStatus = 'DELETED';
              result.metadataDeleted += 1;
              await this.audit.record({
                studyId: archive.studyId,
                retentionId: archive.retentionId,
                action: 'METADATA_BACKUP_DELETED',
                triggeredBy: 'SCHEDULER',
                status: 'SUCCESS',
                details: { archiveId: archive.id, deletedAt: now.toISOString() },
              });
              await this.audit.record({
                studyId: archive.studyId,
                retentionId: archive.retentionId,
                action: 'PERMANENT_DELETION_VERIFIED',
                triggeredBy: 'SCHEDULER',
                status: 'SUCCESS',
                details: { archiveId: archive.id, objectType: 'METADATA_BACKUP' },
              });
            }
          }
        }
      } catch (error) {
        result.failed += 1;
        if (dicomStatus === 'DELETING') dicomStatus = 'FAILED';
        if (metadataStatus === 'DELETING') metadataStatus = 'FAILED';
        await this.prisma.retentionArchive.update({
          where: { id: archive.id },
          data: {
            dicomDeletionStatus: dicomStatus,
            metadataDeletionStatus: metadataStatus,
            cleanupFinalized: false,
          },
        });
        await this.audit.record({
          studyId: archive.studyId,
          retentionId: archive.retentionId,
          action: 'DELETION_FAILED',
          triggeredBy: 'SCHEDULER',
          status: 'FAILED',
          details: {
            archiveId: archive.id,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          },
        });
      }
      await this.prisma.retentionArchive.update({
        where: { id: archive.id },
        data: {
          dicomDeletionStatus: dicomStatus,
          metadataDeletionStatus: metadataStatus,
          archiveStatus: dicomDeleted && metadataDeleted
            ? RetentionArchiveStatus.DELETED
            : dicomDeleted || metadataDeleted
              ? RetentionArchiveStatus.DELETING
              : archive.archiveStatus,
        },
      });
    }
    return result;
  }

  private async authorizeOrthancDeletion(
    studyId: string,
    archiveId: string,
    claimUntil: Date,
    orthancStudyId: string,
    actor?: RetentionActor,
  ): Promise<{ authorized: boolean; reason?: string }> {
    const policy = retentionPolicy();
    const now = new Date();
    const gate = await this.prisma.$transaction(async (tx) => {
      const archive = await tx.retentionArchive.findUnique({
        where: { id: archiveId },
        select: {
          archiveStatus: true,
          archiveVerifiedAt: true,
          contentVerifiedAt: true,
          dicomObjectOwned: true,
          dicomChecksum: true,
          originalDataDeletionStatus: true,
          cleanupClaimUntil: true,
          cleanupFinalized: true,
          orthancDeleteDispatchedAt: true,
          study: { include: retentionStudyInclude },
          retention: { select: { retentionLocked: true } },
        },
      });
      if (!archive) return { authorized: false, reason: 'ARCHIVE_NOT_FOUND', abort: false };
      const held = archive.study.retentionLocked || archive.retention?.retentionLocked;
      if (held) return { authorized: false, reason: 'LEGAL_HOLD', abort: true };
      if (policy.dryRun || !policy.destructiveEnabled) {
        return { authorized: false, reason: 'DELETION_DISABLED', abort: true };
      }
      const stateValid =
        archive.originalDataDeletionStatus === 'FINALIZING' &&
        archive.cleanupClaimUntil?.getTime() === claimUntil.getTime() &&
        archive.cleanupFinalized === true &&
        archive.orthancDeleteDispatchedAt === null &&
        archive.study.orthancStudyId === orthancStudyId &&
        archive.archiveStatus === RetentionArchiveStatus.ARCHIVED &&
        Boolean(
          archive.archiveVerifiedAt &&
            archive.contentVerifiedAt &&
            archive.dicomObjectOwned &&
            archive.dicomChecksum,
        );
      if (!stateValid) {
        return { authorized: false, reason: 'CLEANUP_CLAIM_LOST', abort: false };
      }
      const backup = await this.eligibility.findVerifiedBackup(tx);
      const evaluation = this.eligibility.evaluate(
        archive.study,
        backup,
        policy,
        this.eligibility.cutoff(policy.retentionDays, now),
        now,
        'LIFECYCLE',
      );
      if (!evaluation.eligible) {
        return {
          authorized: false,
          reason: evaluation.reason ?? 'NOT_ELIGIBLE',
          abort: true,
        };
      }
      const updated = await tx.retentionArchive.updateMany({
        where: {
          id: archiveId,
          originalDataDeletionStatus: 'FINALIZING',
          cleanupClaimUntil: claimUntil,
          cleanupFinalized: true,
          orthancDeleteDispatchedAt: null,
          study: { retentionLocked: false },
          retention: { retentionLocked: false },
        },
        data: { orthancDeleteDispatchedAt: now },
      });
      if (updated.count !== 1) {
        const locked = await tx.study.findUnique({
          where: { id: studyId },
          select: {
            retentionLocked: true,
            retention: { select: { retentionLocked: true } },
          },
        });
        const held = Boolean(locked?.retentionLocked || locked?.retention?.retentionLocked);
        return {
          authorized: false,
          reason: held ? 'LEGAL_HOLD' : 'CLEANUP_CLAIM_LOST',
          abort: false,
        };
      }
      return { authorized: true, abort: false };
    });
    if (!gate.authorized && gate.abort) {
      await this.prisma.retentionArchive.updateMany({
        where: {
          id: archiveId,
          originalDataDeletionStatus: { in: ['IN_PROGRESS', 'FINALIZING'] },
          cleanupClaimUntil: { gt: new Date() },
          orthancDeleteDispatchedAt: null,
        },
        data: {
          originalDataDeletionStatus: 'FAILED',
          cleanupClaimUntil: null,
          cleanupFinalized: false,
          lastError: gate.reason ?? 'CLEANUP_ABORTED',
        },
      });
      await this.audit.record({
        studyId,
        action: 'DELETION_FAILED',
        triggeredBy: actor ? 'USER' : 'SCHEDULER',
        actor,
        status: 'FAILED',
        details: {
          archiveId,
          reason: gate.reason,
          cleanupAborted: true,
          phase: 'BEFORE_ORTHANC_DELETE',
        },
      });
    }
    return { authorized: gate.authorized, reason: gate.reason };
  }

  async cleanupOriginalData(
    studyId: string,
    actor?: RetentionActor,
  ): Promise<{ deleted: boolean; reason?: string }> {
    const policy = retentionPolicy();
    if (policy.dryRun || !policy.destructiveEnabled) {
      return { deleted: false, reason: 'DELETION_DISABLED' };
    }
    const now = new Date();
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
      include: {
        ...retentionStudyInclude,
        retentionArchives: {
          select: {
            id: true,
            retentionId: true,
            archiveStatus: true,
            archiveVerifiedAt: true,
            contentVerifiedAt: true,
            dicomObjectOwned: true,
            dicomObjectKey: true,
            dicomChecksum: true,
            manifestObjectKey: true,
            reportObjectKey: true,
            studyObjectKey: true,
            checksum: true,
            backupRunId: true,
            uploadedArtifacts: true,
            dicomDeleteAt: true,
            metadataDeleteAt: true,
            originalDataDeletionStatus: true,
            cleanupClaimUntil: true,
            cleanupFinalized: true,
          },
        },
      },
    });
    if (!study) return { deleted: false, reason: 'STUDY_NOT_FOUND' };
    if (actor) this.eligibility.assertStudyScope(actor, study.hospitalId);
    const archive = study.retentionArchives[0];
    if (!archive) return { deleted: false, reason: 'VERIFIED_ARCHIVE_REQUIRED' };
    if (archive.originalDataDeletionStatus === 'DELETED') {
      return { deleted: true };
    }
    if (
      archive.archiveStatus !== RetentionArchiveStatus.ARCHIVED ||
      !archive.archiveVerifiedAt ||
      !archive.contentVerifiedAt ||
      !archive.dicomObjectOwned ||
      !archive.dicomChecksum
    ) {
      return { deleted: false, reason: 'DEDICATED_DICOM_ARCHIVE_REQUIRED' };
    }
    if (!study.orthancStudyId) {
      return { deleted: false, reason: 'ORTHANC_STUDY_ID_MISSING' };
    }

    const backup = await this.eligibility.findVerifiedBackup(this.prisma);
    const evaluation = this.eligibility.evaluate(
      study,
      backup,
      policy,
      this.eligibility.cutoff(policy.retentionDays, now),
      now,
      'LIFECYCLE',
    );
    if (!evaluation.eligible) {
      return { deleted: false, reason: evaluation.reason ?? 'NOT_ELIGIBLE' };
    }
    if (!(await this.verifyArchiveObjects(archive, study))) {
      return { deleted: false, reason: 'ARCHIVE_OBJECT_VERIFICATION_FAILED' };
    }

    const claimUntil = new Date(now.getTime() + CLEANUP_CLAIM_MS);
    const claim = await this.prisma.$transaction(async (tx) => {
      const current = await tx.retentionArchive.findUnique({
        where: { id: archive.id },
        select: {
          study: { select: { retentionLocked: true, orthancStudyId: true } },
          retention: { select: { id: true, retentionLocked: true } },
        },
      });
      if (!current) return { claimed: false, reason: 'ARCHIVE_NOT_FOUND' };
      if (current.study.retentionLocked || current.retention?.retentionLocked) {
        return { claimed: false, reason: 'LEGAL_HOLD' };
      }
      const updated = await tx.retentionArchive.updateMany({
        where: {
          id: archive.id,
          originalDataDeletionStatus: {
            in: ['PENDING', 'FAILED', 'IN_PROGRESS', 'FINALIZING'],
          },
          OR: [{ cleanupClaimUntil: null }, { cleanupClaimUntil: { lt: now } }],
        },
        data: {
          originalDataDeletionStatus: 'IN_PROGRESS',
          cleanupClaimUntil: claimUntil,
          cleanupFinalized: false,
          lastError: null,
        },
      });
      if (updated.count !== 1) {
        return { claimed: false, reason: 'CLEANUP_IN_PROGRESS' };
      }
      if (current.retention) {
        await tx.studyRetention.update({
          where: { id: current.retention.id },
          data: { status: RetentionStatus.ORIGINAL_DATA_CLEANUP },
        });
      }
      return { claimed: true, orthancStudyId: current.study.orthancStudyId };
    });
    if (!claim.claimed || !claim.orthancStudyId) {
      return { deleted: false, reason: claim.reason ?? 'CLEANUP_CLAIM_FAILED' };
    }

    if (!(await this.verifyArchiveObjects(archive, study))) {
      await this.prisma.retentionArchive.update({
        where: { id: archive.id },
        data: {
          originalDataDeletionStatus: 'FAILED',
          cleanupClaimUntil: null,
          cleanupFinalized: false,
          lastError: 'ARCHIVE_OBJECT_VERIFICATION_FAILED',
        },
      });
      return { deleted: false, reason: 'ARCHIVE_OBJECT_VERIFICATION_FAILED' };
    }

    const finalized = await this.prisma.$transaction(async (tx) => {
      const current = await tx.retentionArchive.findUnique({
        where: { id: archive.id },
        select: {
          cleanupClaimUntil: true,
          originalDataDeletionStatus: true,
          study: { select: { retentionLocked: true } },
          retention: { select: { retentionLocked: true } },
        },
      });
      if (
        !current ||
        current.originalDataDeletionStatus !== 'IN_PROGRESS' ||
        current.cleanupClaimUntil?.getTime() !== claimUntil.getTime() ||
        current.study.retentionLocked ||
        current.retention?.retentionLocked
      ) {
        return false;
      }
      const updated = await tx.retentionArchive.updateMany({
        where: {
          id: archive.id,
          originalDataDeletionStatus: 'IN_PROGRESS',
          cleanupClaimUntil: claimUntil,
        },
        data: {
          originalDataDeletionStatus: 'FINALIZING',
          cleanupFinalized: true,
        },
      });
      return updated.count === 1;
    });
    if (!finalized) {
      const current = await this.prisma.retentionArchive.findUnique({
        where: { id: archive.id },
        select: { study: { select: { retentionLocked: true } } },
      });
      if (!current?.study.retentionLocked) {
        await this.prisma.retentionArchive.update({
          where: { id: archive.id },
          data: {
            originalDataDeletionStatus: 'FAILED',
            cleanupClaimUntil: null,
            cleanupFinalized: false,
            lastError: 'CLEANUP_CLAIM_LOST',
          },
        });
      }
      return { deleted: false, reason: current?.study.retentionLocked ? 'LEGAL_HOLD' : 'CLEANUP_CLAIM_LOST' };
    }

    const authorization = await this.authorizeOrthancDeletion(
      studyId,
      archive.id,
      claimUntil,
      claim.orthancStudyId,
      actor,
    );
    if (!authorization.authorized) {
      return { deleted: false, reason: authorization.reason ?? 'CLEANUP_NOT_AUTHORIZED' };
    }

    try {
      await deleteOrthancStudy(claim.orthancStudyId, resolveBackupEnv());
      const exists = await orthancStudyExists(claim.orthancStudyId, resolveBackupEnv());
      if (exists) {
        throw new Error('Orthanc study still present after deletion');
      }
      await this.prisma.retentionArchive.update({
        where: { id: archive.id },
        data: {
          originalDataDeletionStatus: 'DELETED',
          cleanupClaimUntil: null,
          archiveStatus: RetentionArchiveStatus.DELETING,
          lastError: null,
        },
      });
      if (archive.retentionId) {
        await this.prisma.studyRetention.update({
          where: { id: archive.retentionId },
          data: { status: RetentionStatus.DICOM_DELETED },
        });
      }
      await this.audit.record({
        studyId,
        retentionId: archive.retentionId,
        action: 'ORIGINAL_DATA_DELETED',
        triggeredBy: actor ? 'USER' : 'SCHEDULER',
        actor,
        status: 'SUCCESS',
        details: { archiveId: archive.id, deletedAt: new Date().toISOString() },
      });
      await this.audit.record({
        studyId,
        retentionId: archive.retentionId,
        action: 'PERMANENT_DELETION_VERIFIED',
        triggeredBy: actor ? 'USER' : 'SCHEDULER',
        actor,
        status: 'SUCCESS',
        details: { archiveId: archive.id, orthancStudyDeleted: true },
      });
      return { deleted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.retentionArchive.update({
        where: { id: archive.id },
        data: {
          originalDataDeletionStatus: 'FAILED',
          cleanupClaimUntil: null,
          cleanupFinalized: false,
          lastError: message.replace(/[\r\n]+/g, ' ').slice(0, 2000),
        },
      });
      await this.audit.record({
        studyId,
        retentionId: archive.retentionId,
        action: 'DELETION_FAILED',
        triggeredBy: actor ? 'USER' : 'SCHEDULER',
        actor,
        status: 'FAILED',
        details: { archiveId: archive.id, error: message.slice(0, 500) },
      });
      return { deleted: false, reason: 'DELETION_VERIFICATION_FAILED' };
    }
  }

  private async deleteObject(
    key: string,
    expectedChecksum?: string | null,
    archiveId?: string,
    kind?: 'DICOM_BACKUP' | 'METADATA_BACKUP',
  ): Promise<boolean> {
    const present = await this.storage.head(key);
    if (!present) return true;
    if (expectedChecksum && this.storage.remote) {
      if (!present.checksum || present.checksum !== expectedChecksum) {
        throw new Error(`OBJECT_CHECKSUM_MISMATCH: ${key}`);
      }
    }
    const backupReferences = await this.prisma.backupRun.count({
      where: {
        OR: [{ databaseObjectKey: key }, { dicomObjectKey: key }],
      },
    });
    if (backupReferences > 0) {
      throw new Error(`OBJECT_REFERENCED_BY_BACKUP_RUN: ${key}`);
    }
    const archiveReferences = await this.prisma.retentionArchive.count({
      where: {
        ...(archiveId ? { id: { not: archiveId } } : {}),
        OR: [
          { dicomObjectKey: key },
          { studyObjectKey: key },
          { reportObjectKey: key },
          { manifestObjectKey: key },
        ],
      },
    });
    if (archiveReferences > 0) {
      throw new Error(`OBJECT_REFERENCED_BY_RETENTION_ARCHIVE: ${key}`);
    }
    if (archiveId && kind) {
      await this.assertBackupObjectDeletionAllowed(archiveId, key, kind);
    }
    if (this.storage.purgeVersions) {
      await this.storage.purgeVersions(key);
    } else {
      await this.storage.delete(key);
    }
    if (this.storage.verifyPurge) {
      return this.storage.verifyPurge(key);
    }
    return (await this.storage.head(key)) === null;
  }

  private async verifyArchiveObjects(
    archive: CleanupArchive,
    study: ArchiveStudy,
  ): Promise<boolean> {
    if (
      !archive.dicomObjectKey ||
      !archive.dicomChecksum ||
      !archive.manifestObjectKey ||
      !archive.reportObjectKey ||
      !archive.studyObjectKey ||
      !archive.checksum ||
      !archive.contentVerifiedAt ||
      !archive.dicomObjectOwned
    ) {
      return false;
    }
    const dicomHead = await this.storage.head(archive.dicomObjectKey);
    if (!dicomHead) return false;
    if (this.storage.remote && dicomHead.checksum !== archive.dicomChecksum) {
      return false;
    }
    const backupReferences = await this.prisma.backupRun.count({
      where: {
        OR: [
          { databaseObjectKey: archive.dicomObjectKey },
          { dicomObjectKey: archive.dicomObjectKey },
        ],
      },
    });
    if (backupReferences > 0) return false;

    const scratchDir = `${retentionScratchPath(study.id, archive.id)}/cleanup`;
    await this.removeDirectory(scratchDir);
    await this.ensureDirectory(scratchDir);
    try {
      const manifestPath = `${scratchDir}/archive-manifest.json`;
      await this.storage.download(archive.manifestObjectKey, manifestPath);
      if (
        !(await this.storage.verify(
          archive.manifestObjectKey,
          manifestPath,
          archive.checksum,
        ))
      ) {
        return false;
      }
      const manifest = parseRetentionArchiveManifest(
        JSON.parse(await fs.readFile(manifestPath, 'utf8')),
      );
      if (
        !manifest ||
        manifest.archiveId !== archive.id ||
        manifest.studyInstanceUid !== study.studyInstanceUid ||
        manifest.dicomObjectKey !== archive.dicomObjectKey ||
        manifest.dicomChecksum !== archive.dicomChecksum ||
        !manifest.dicomObjectOwned ||
        manifest.artifacts.dicom.objectKey !== archive.dicomObjectKey ||
        manifest.artifacts.dicom.sha256 !== archive.dicomChecksum ||
        manifest.artifacts.report.objectKey !== archive.reportObjectKey ||
        manifest.artifacts.study.objectKey !== archive.studyObjectKey
      ) {
        return false;
      }

      const reportPath = `${scratchDir}/report.json`;
      await this.storage.download(archive.reportObjectKey, reportPath);
      const reportChecksum = await sha256File(reportPath);
      if (
        reportChecksum !== manifest.reportSha256 ||
        reportChecksum !== manifest.artifacts.report.sha256 ||
        !(await this.storage.verify(archive.reportObjectKey, reportPath, reportChecksum))
      ) {
        return false;
      }
      const reportArtifact = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      if (!archivedReportMatchesStudy(reportArtifact, archive.id, study)) return false;

      const studyPath = `${scratchDir}/study.json`;
      await this.storage.download(archive.studyObjectKey, studyPath);
      const studyChecksum = await sha256File(studyPath);
      if (
        studyChecksum !== manifest.studySha256 ||
        studyChecksum !== manifest.artifacts.study.sha256 ||
        !(await this.storage.verify(archive.studyObjectKey, studyPath, studyChecksum))
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      await this.removeDirectory(scratchDir);
    }
  }

  private async writeArchive(
    archiveId: string,
    study: ArchiveStudy,
    backup: { id: string; verifiedAt: Date | null } | null,
    now: Date,
    policy: ReturnType<typeof retentionPolicy>,
    existing: ExistingArchiveArtifacts | null,
  ): Promise<{
    dicomObjectKey: string | null;
    dicomObjectOwned: boolean;
    dicomChecksum: string | null;
    studyObjectKey: string | null;
    reportObjectKey: string | null;
    manifestObjectKey: string | null;
    manifestChecksum: string;
    contentVerifiedAt: Date;
    uploadedArtifacts: UploadedArtifactRecord[];
  }> {
    const env = resolveBackupEnv();
    const scratchDir = retentionScratchPath(study.id, archiveId);
    const finalDir = `${env.backupDir}/retention-objects/${study.id}/${archiveId}`;
    await this.removeDirectory(scratchDir);
    await this.ensureDirectory(scratchDir);
    await this.ensureDirectory(finalDir);

    try {
      let dicomObjectKey: string | null = null;
      let dicomObjectOwned = false;
      let dicomChecksum: string | null = null;
      if (booleanEnv(RETENTION_ENV_FLAGS.dicomArchiveEnabled, false)) {
        const localArchive = this.storage.remote
          ? `${scratchDir}/dicom.tar.gz`
          : `${finalDir}/dicom.tar.gz`;
        dicomObjectKey = this.storage.remote
          ? retentionObjectKey(study.id, archiveId, 'dicom.tar.gz')
          : localArchive;
        const artifact = await createDicomWebArchive(
          localArchive,
          env,
          study.studyInstanceUid,
        );
        dicomChecksum = artifact.checksum;
        const reused =
          existing?.dicomObjectKey === dicomObjectKey &&
          existing?.dicomChecksum === dicomChecksum &&
          (await this.reuseObjectIfValid(dicomObjectKey, dicomChecksum, scratchDir));
        if (!reused) {
          if (this.storage.remote) {
            await this.storage.upload(
              localArchive,
              dicomObjectKey,
              storageMetadata(archiveId, artifact.checksum),
            );
          }
          if (
            !(await this.storage.verify(dicomObjectKey, localArchive, artifact.checksum))
          ) {
            throw new Error('Retention DICOM archive verification failed');
          }
        }
        dicomObjectOwned = true;
      } else if (backup) {
        const fullBackup = await this.prisma.backupRun.findUnique({
          where: { id: backup.id },
          select: { dicomObjectKey: true, dicomChecksum: true },
        });
        dicomObjectKey = fullBackup?.dicomObjectKey ?? null;
        dicomChecksum = fullBackup?.dicomChecksum ?? null;
        if (
          dicomObjectKey &&
          dicomChecksum &&
          !(await this.reuseObjectIfValid(
            dicomObjectKey,
            dicomChecksum,
            scratchDir,
          ))
        ) {
          throw new Error('Source full-backup DICOM object verification failed');
        }
      }

      const reportData = buildArchivedReportArtifact(study, archiveId, now);
      const studyData = buildArchivedStudyArtifact(study, archiveId);

      const objectKeys = {
        'report.json': this.storage.remote
          ? retentionObjectKey(study.id, archiveId, 'report.json')
          : `${finalDir}/report.json`,
        'study.json': this.storage.remote
          ? retentionObjectKey(study.id, archiveId, 'study.json')
          : `${finalDir}/study.json`,
        'archive-manifest.json': this.storage.remote
          ? retentionObjectKey(study.id, archiveId, 'archive-manifest.json')
          : `${finalDir}/archive-manifest.json`,
      };
      const uploads: Array<{ path: string; file: string; data: unknown }> = [
        {
          path: this.storage.remote ? `${scratchDir}/report.json` : objectKeys['report.json'],
          file: 'report.json',
          data: reportData,
        },
        {
          path: this.storage.remote ? `${scratchDir}/study.json` : objectKeys['study.json'],
          file: 'study.json',
          data: studyData,
        },
      ];
      for (const item of uploads) {
        await this.writeJson(item.path, item.data);
      }

      const reportChecksum = await sha256File(uploads[0].path);
      const studyChecksum = await sha256File(uploads[1].path);
      const manifestData = buildRetentionArchiveManifest({
        archiveId,
        generatedAt: now,
        studyInstanceUid: study.studyInstanceUid,
        policyVersion: policy.policyVersion,
        initialRetentionDays: policy.initialRetentionDays,
        dicomBackupRetentionDays: policy.dicomBackupRetentionDays,
        metadataBackupRetentionDays: policy.metadataBackupRetentionDays,
        dicomObjectKey,
        dicomChecksum,
        dicomObjectOwned,
        reportSha256: reportChecksum,
        studySha256: studyChecksum,
        reportObjectKey: objectKeys['report.json'],
        studyObjectKey: objectKeys['study.json'],
      });
      const manifestPath = this.storage.remote
        ? `${scratchDir}/archive-manifest.json`
        : objectKeys['archive-manifest.json'];
      await this.writeJson(manifestPath, manifestData);
      const manifestChecksum = await sha256File(manifestPath);

      const artifacts = [
        ...uploads,
        { path: manifestPath, file: 'archive-manifest.json', data: manifestData },
      ];
      const uploadedArtifacts: UploadedArtifactRecord[] = [];
      if (dicomObjectKey && dicomChecksum) {
        uploadedArtifacts.push({
          file: 'dicom.tar.gz',
          key: dicomObjectKey,
          sha256: dicomChecksum,
        });
      }
      for (const item of artifacts) {
        const checksum = await sha256File(item.path);
        const key = objectKeys[item.file as keyof typeof objectKeys];
        const previous = existing && artifactChecksum(existing.uploadedArtifacts, key);
        const reused =
          previous === checksum &&
          (await this.reuseObjectIfValid(key, checksum, scratchDir));
        if (!reused && this.storage.remote) {
          await this.storage.upload(item.path, key, storageMetadata(archiveId, checksum));
        }
        if (!(await this.storage.verify(key, item.path, checksum))) {
          throw new Error(`Retention archive verification failed for ${item.file}`);
        }
        uploadedArtifacts.push({ file: item.file, key, sha256: checksum });
      }

      const verificationReportPath = `${scratchDir}/verify-report.json`;
      await this.storage.download(objectKeys['report.json'], verificationReportPath);
      const reportArtifact = JSON.parse(await fs.readFile(verificationReportPath, 'utf8'));
      if (!archivedReportMatchesStudy(reportArtifact, archiveId, study)) {
        throw new Error('Archived report content verification failed');
      }
      const verificationManifestPath = `${scratchDir}/verify-manifest.json`;
      await this.storage.download(objectKeys['archive-manifest.json'], verificationManifestPath);
      const downloadedManifest = parseRetentionArchiveManifest(
        JSON.parse(await fs.readFile(verificationManifestPath, 'utf8')),
      );
      if (
        !downloadedManifest ||
        downloadedManifest.archiveId !== archiveId ||
        downloadedManifest.studyInstanceUid !== study.studyInstanceUid ||
        downloadedManifest.dicomObjectKey !== dicomObjectKey ||
        downloadedManifest.dicomChecksum !== dicomChecksum ||
        downloadedManifest.artifacts.report.objectKey !== objectKeys['report.json'] ||
        downloadedManifest.artifacts.study.objectKey !== objectKeys['study.json']
      ) {
        throw new Error('Archived manifest verification failed');
      }

      return {
        dicomObjectKey,
        dicomObjectOwned,
        dicomChecksum,
        studyObjectKey: objectKeys['study.json'],
        reportObjectKey: objectKeys['report.json'],
        manifestObjectKey: objectKeys['archive-manifest.json'],
        manifestChecksum,
        contentVerifiedAt: new Date(),
        uploadedArtifacts,
      };
    } finally {
      await this.removeDirectory(scratchDir);
    }
  }

  private async reuseObjectIfValid(
    key: string,
    expectedChecksum: string,
    scratchDir: string,
  ): Promise<boolean> {
    const head = await this.storage.head(key);
    if (!head) return false;
    if (!this.storage.remote) return true;
    if (head.checksum !== expectedChecksum) return false;
    const downloadPath = `${scratchDir}/reuse-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.tmp`;
    try {
      await this.storage.download(key, downloadPath);
      return (await sha256File(downloadPath)) === expectedChecksum;
    } catch {
      return false;
    } finally {
      await fs.rm(downloadPath, { force: true });
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  private async ensureDirectory(filePath: string): Promise<void> {
    await fs.mkdir(filePath, { recursive: true });
  }

  private async removeDirectory(filePath: string): Promise<void> {
    await fs.rm(filePath, { recursive: true, force: true });
  }
}

export const RETENTION_ARCHIVE_JOB_TYPES = {
  cleanupOriginal: RetentionJobType.CLEANUP_ORIGINAL,
  deleteExpiredBackups: RetentionJobType.DELETE_EXPIRED_BACKUPS,
};
