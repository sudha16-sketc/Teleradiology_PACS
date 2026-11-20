import { promises as fs } from 'fs';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  RetentionArchiveStatus,
  RetentionJobType,
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
import { createDicomWebArchive, deleteOrthancStudy } from '../backup/dicom-backup.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { booleanEnv, RETENTION_ENV_FLAGS, retentionPolicy } from './retention-config.js';
import { RetentionAuditService, type RetentionActor } from './retention-audit.service.js';
import {
  retentionStudyInclude,
  RetentionEligibilityService,
  type RetentionStudy,
} from './retention-eligibility.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ArchiveStudy = Omit<RetentionStudy, 'reports'> & {
  reports: Array<RetentionStudy['reports'][number] & { contentHash: string }>;
};

function retentionObjectKey(
  studyId: string,
  archiveId: string,
  fileName: string,
): string {
  const env = resolveBackupEnv();
  const prefix = env.b2Prefix || 'teleradiology-backup';
  return `${prefix}/retention/studies/${studyId}/${archiveId}/${fileName}`;
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
      include: {
        ...retentionStudyInclude,
        reports: {
          select: {
            ...retentionStudyInclude.reports.select,
            contentHash: true,
          },
        },
      },
    });
    if (!study) return { archiveId: null, archived: false, reason: 'STUDY_NOT_FOUND' };

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
        dicomObjectKey: true,
        studyObjectKey: true,
        manifestObjectKey: true,
        checksum: true,
        dicomChecksum: true,
        dicomDeleteAt: true,
        metadataDeleteAt: true,
      },
    });
    if (
      existing?.archiveStatus === RetentionArchiveStatus.ARCHIVED ||
      existing?.archiveStatus === RetentionArchiveStatus.DELETING ||
      existing?.archiveStatus === RetentionArchiveStatus.DELETED
    ) {
      return { archiveId: existing.id, archived: true };
    }
    if (existing?.archiveStatus === RetentionArchiveStatus.ARCHIVING) {
      return { archiveId: existing.id, archived: false, reason: 'ARCHIVE_IN_PROGRESS' };
    }

    let archiveId = existing?.id ?? null;
    if (!existing) {
      const data: Prisma.RetentionArchiveCreateInput = {
        study: { connect: { id: studyId } },
        retention: { connect: { id: study.retention.id } },
        archiveStatus: RetentionArchiveStatus.ARCHIVING,
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
        where: { id: existing.id, archiveStatus: RetentionArchiveStatus.FAILED },
        data: {
          archiveStatus: RetentionArchiveStatus.ARCHIVING,
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
      const result = await this.writeArchive(archiveId, study, backup, now, policy);
      await this.prisma.retentionArchive.update({
        where: { id: archiveId },
        data: {
          archiveStatus: RetentionArchiveStatus.ARCHIVED,
          archiveCreatedAt: now,
          archiveVerifiedAt: new Date(),
          dicomObjectKey: result.dicomObjectKey,
          dicomChecksum: result.dicomChecksum,
          studyObjectKey: result.studyObjectKey,
          reportObjectKey: result.reportObjectKey,
          manifestObjectKey: result.manifestObjectKey,
          checksum: result.manifestChecksum,
          dicomDeleteAt: new Date(now.getTime() + policy.dicomBackupRetentionDays * MS_PER_DAY),
          metadataDeleteAt: new Date(now.getTime() + policy.metadataBackupRetentionDays * MS_PER_DAY),
          originalDataDeletionStatus: 'PENDING',
          dicomDeletionStatus: 'PENDING',
          metadataDeletionStatus: 'PENDING',
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
        dicomDeleteAt: true,
        metadataDeleteAt: true,
        dicomObjectKey: true,
        dicomChecksum: true,
        studyObjectKey: true,
        reportObjectKey: true,
        manifestObjectKey: true,
        checksum: true,
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
      try {
        if (
          archive.dicomDeleteAt &&
          archive.dicomDeleteAt <= now &&
          archive.dicomDeletionStatus === 'PENDING'
        ) {
          if (!archive.dicomObjectKey) {
            result.skipped += 1;
          } else if (
            await this.deleteObject(archive.dicomObjectKey, archive.dicomChecksum)
          ) {
            dicomDeleted = true;
            result.dicomDeleted += 1;
            await this.audit.record({
              studyId: archive.studyId,
              retentionId: archive.retentionId,
              action: 'DICOM_BACKUP_DELETED',
              triggeredBy: 'SCHEDULER',
              status: 'SUCCESS',
              details: { archiveId: archive.id, deletedAt: now.toISOString() },
            });
          } else {
            result.failed += 1;
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
          } else {
            const checksums = [archive.checksum, archive.checksum, archive.checksum];
            let deletedAll = true;
            for (let index = 0; index < keys.length; index += 1) {
              if (!(await this.deleteObject(keys[index], checksums[index]))) {
                deletedAll = false;
                break;
              }
            }
            if (deletedAll) {
              metadataDeleted = true;
              result.metadataDeleted += 1;
              await this.audit.record({
                studyId: archive.studyId,
                retentionId: archive.retentionId,
                action: 'METADATA_BACKUP_DELETED',
                triggeredBy: 'SCHEDULER',
                status: 'SUCCESS',
                details: { archiveId: archive.id, deletedAt: now.toISOString() },
              });
            } else {
              result.failed += 1;
            }
          }
        }
      } catch (error) {
        result.failed += 1;
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
          dicomDeletionStatus: dicomDeleted ? 'DELETED' : archive.dicomDeletionStatus,
          metadataDeletionStatus: metadataDeleted ? 'DELETED' : archive.metadataDeletionStatus,
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

  async cleanupOriginalData(
    studyId: string,
    actor?: RetentionActor,
  ): Promise<{ deleted: boolean; reason?: string }> {
    const policy = retentionPolicy();
    if (policy.dryRun || !policy.destructiveEnabled) {
      return { deleted: false, reason: 'DELETION_DISABLED' };
    }
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
      select: {
        id: true,
        retentionLocked: true,
        orthancStudyId: true,
        archivedAt: true,
        retentionArchives: {
          select: {
            id: true,
            archiveStatus: true,
            archiveVerifiedAt: true,
            originalDataDeletionStatus: true,
          },
        },
      },
    });
    if (!study) return { deleted: false, reason: 'STUDY_NOT_FOUND' };
    if (study.retentionLocked) return { deleted: false, reason: 'LEGAL_HOLD' };
    const archive = study.retentionArchives[0];
    if (!archive || archive.archiveStatus !== RetentionArchiveStatus.ARCHIVED || !archive.archiveVerifiedAt) {
      return { deleted: false, reason: 'VERIFIED_ARCHIVE_REQUIRED' };
    }
    if (archive.originalDataDeletionStatus === 'DELETED') {
      return { deleted: true };
    }
    if (!study.orthancStudyId) {
      return { deleted: false, reason: 'ORTHANC_STUDY_ID_MISSING' };
    }

    try {
      await deleteOrthancStudy(study.orthancStudyId, resolveBackupEnv());
      await this.prisma.retentionArchive.update({
        where: { id: archive.id },
        data: {
          originalDataDeletionStatus: 'DELETED',
          archiveStatus: RetentionArchiveStatus.DELETING,
        },
      });
      await this.audit.record({
        studyId,
        retentionId: archive.id,
        action: 'ORIGINAL_DATA_DELETED',
        triggeredBy: actor ? 'USER' : 'SCHEDULER',
        actor,
        status: 'SUCCESS',
        details: { archiveId: archive.id, deletedAt: new Date().toISOString() },
      });
      await this.audit.record({
        studyId,
        retentionId: archive.id,
        action: 'PERMANENT_DELETION_VERIFIED',
        triggeredBy: actor ? 'USER' : 'SCHEDULER',
        actor,
        status: 'SUCCESS',
        details: { archiveId: archive.id, orthancStudyDeleted: true },
      });
      return { deleted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.audit.record({
        studyId,
        retentionId: archive.id,
        action: 'DELETION_FAILED',
        triggeredBy: actor ? 'USER' : 'SCHEDULER',
        actor,
        status: 'FAILED',
        details: { archiveId: archive.id, error: message.slice(0, 500) },
      });
      throw error;
    }
  }

  private async deleteObject(key: string, expectedChecksum?: string | null): Promise<boolean> {
    if (this.storage.purgeVersions) {
      await this.storage.purgeVersions(key);
    } else {
      await this.storage.delete(key);
    }
    const head = await this.storage.head(key);
    if (head) return false;
    if (expectedChecksum && !this.storage.remote) return true;
    return true;
  }

  private async writeArchive(
    archiveId: string,
    study: ArchiveStudy,
    backup: { id: string; verifiedAt: Date | null } | null,
    now: Date,
    policy: ReturnType<typeof retentionPolicy>,
  ): Promise<{
    dicomObjectKey: string | null;
    dicomChecksum: string | null;
    studyObjectKey: string | null;
    reportObjectKey: string | null;
    manifestObjectKey: string | null;
    manifestChecksum: string;
  }> {
    const env = resolveBackupEnv();
    const scratchDir = `${env.backupDir}/retention/${study.id}/${archiveId}`;
    await this.removeDirectory(scratchDir);
    await this.ensureDirectory(scratchDir);

    let dicomObjectKey: string | null = null;
    let dicomChecksum: string | null = null;
    if (booleanEnv(RETENTION_ENV_FLAGS.dicomArchiveEnabled, false)) {
      const localArchive = `${scratchDir}/dicom.tar.gz`;
      const artifact = await createDicomWebArchive(
        localArchive,
        env,
        study.studyInstanceUid,
      );
      dicomChecksum = artifact.checksum;
      if (this.storage.remote) {
        dicomObjectKey = retentionObjectKey(study.id, archiveId, 'dicom.tar.gz');
        await this.storage.upload(
          localArchive,
          dicomObjectKey,
          storageMetadata(archiveId, artifact.checksum),
        );
        if (!(await this.storage.verify(dicomObjectKey, localArchive, artifact.checksum))) {
          throw new Error('Retention DICOM archive verification failed');
        }
      } else {
        dicomObjectKey = localArchive;
        if (!(await this.storage.verify(dicomObjectKey, localArchive, artifact.checksum))) {
          throw new Error('Retention DICOM archive verification failed');
        }
      }
    } else if (backup) {
      const fullBackup = await this.prisma.backupRun.findUnique({
        where: { id: backup.id },
        select: { dicomObjectKey: true, dicomChecksum: true },
      });
      dicomObjectKey = fullBackup?.dicomObjectKey ?? null;
      dicomChecksum = fullBackup?.dicomChecksum ?? null;
    }

    const reportData = {
      archiveId,
      studyInstanceUid: study.studyInstanceUid,
      accessionNumber: study.accessionNumber,
      status: study.status,
      completedAt: study.completedAt?.toISOString() ?? null,
      archivedAt: now.toISOString(),
      reports: study.reports.map((report) => ({
        id: report.id,
        version: report.version,
        status: report.status,
        signedOffAt: report.signedOffAt?.toISOString() ?? null,
        contentHash: report.contentHash,
        createdAt: report.createdAt.toISOString(),
      })),
    };
    const studyData = {
      archiveId,
      studyInstanceUid: study.studyInstanceUid,
      accessionNumber: study.accessionNumber,
      hospitalId: study.hospitalId,
      modality: study.modality,
      studyDate: study.studyDate.toISOString(),
      reportStatus: study.reports.map((report) => report.status),
    };

    const reportPath = `${scratchDir}/report.json`;
    const studyPath = `${scratchDir}/study.json`;
    const manifestPath = `${scratchDir}/archive-manifest.json`;
    await this.writeJson(reportPath, reportData);
    await this.writeJson(studyPath, studyData);

    const reportChecksum = await sha256File(reportPath);
    const studyChecksum = await sha256File(studyPath);
    const manifestData = {
      version: 1,
      archiveId,
      generatedAt: now.toISOString(),
      studyInstanceUid: study.studyInstanceUid,
      policyVersion: policy.policyVersion,
      initialRetentionDays: policy.initialRetentionDays,
      dicomBackupRetentionDays: policy.dicomBackupRetentionDays,
      metadataBackupRetentionDays: policy.metadataBackupRetentionDays,
      dicomObjectKey,
      dicomChecksum,
      artifacts: {
        report: { file: 'report.json', sha256: reportChecksum },
        study: { file: 'study.json', sha256: studyChecksum },
      },
    };
    await this.writeJson(manifestPath, manifestData);
    const manifestChecksum = await sha256File(manifestPath);

    const uploads: Array<{ path: string; file: string; checksum: string }> = [
      { path: reportPath, file: 'report.json', checksum: reportChecksum },
      { path: studyPath, file: 'study.json', checksum: studyChecksum },
      { path: manifestPath, file: 'archive-manifest.json', checksum: manifestChecksum },
    ];
    const keys: Record<string, string> = {};
    for (const item of uploads) {
      const key = this.storage.remote
        ? retentionObjectKey(study.id, archiveId, item.file)
        : item.path;
      if (this.storage.remote) {
        await this.storage.upload(
          item.path,
          key,
          storageMetadata(archiveId, item.checksum),
        );
      }
      if (!(await this.storage.verify(key, item.path, item.checksum))) {
        throw new Error(`Retention archive verification failed for ${item.file}`);
      }
      keys[item.file] = key;
    }

    return {
      dicomObjectKey,
      dicomChecksum,
      studyObjectKey: keys['study.json'] ?? null,
      reportObjectKey: keys['report.json'] ?? null,
      manifestObjectKey: keys['archive-manifest.json'] ?? null,
      manifestChecksum,
    };
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
