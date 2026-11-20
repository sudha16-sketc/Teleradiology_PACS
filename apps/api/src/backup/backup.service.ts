import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditResource,
  BackupStatus,
  BackupType,
  type BackupRun,
  type PrismaClient,
} from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { resolveBackupEnv, restoreDatabaseDump, verifyChecksum } from './backup-ops.js';
import { restoreDicomArchive } from './dicom-backup.js';
import { BACKUP_STORAGE, type BackupStorage } from './backup-storage.js';
import {
  executeBackup,
  verifyBackupRun,
  type BackupActor,
} from './backup-workflow.js';

export interface RestoreResult {
  database?: string;
  dicom?: {
    studyCount: number;
    seriesCount: number;
    instanceCount: number;
  };
}

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(BACKUP_STORAGE) private readonly storage: BackupStorage,
  ) {}

  async list() {
    const runs = await this.prisma.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { createdBy: { select: { displayName: true } } },
    });
    return { data: runs };
  }

  async run(
    type: string,
    actor: BackupActor,
  ): Promise<{ data: BackupRun | null; error?: string }> {
    const backupType = Object.values(BackupType).includes(type as BackupType)
      ? (type as BackupType)
      : BackupType.FULL;
    const result = await executeBackup(
      this.prisma as PrismaClient,
      this.audit,
      this.storage,
      resolveBackupEnv(),
      backupType,
      actor,
    );
    if (result.error && !result.data) throw new ConflictException(result.error);
    return result;
  }

  async verify(
    id: string,
    actor: BackupActor,
  ): Promise<{ data: { id: string; status: BackupStatus; detail: string } }> {
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Backup run not found');
    const result = await verifyBackupRun(
      this.prisma as PrismaClient,
      this.audit,
      this.storage,
      resolveBackupEnv(),
      run,
      actor,
    );
    return { data: { id: run.id, status: result.status, detail: result.detail } };
  }

  async restore(
    id: string,
    requestedType: BackupType,
    actor: BackupActor,
  ): Promise<{ data: RestoreResult }> {
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Backup run not found');
    const restorableStatuses: BackupStatus[] = [
      BackupStatus.COMPLETED,
      BackupStatus.VERIFIED,
    ];
    if (!restorableStatuses.includes(run.status)) {
      throw new BadRequestException('Only completed or verified backups can be restored');
    }
    const env = resolveBackupEnv();
    const requiresDatabase =
      requestedType === BackupType.DATABASE || requestedType === BackupType.FULL;
    const requiresDicom =
      requestedType === BackupType.DICOM || requestedType === BackupType.FULL;
    if (requiresDatabase && !run.databaseChecksum) {
      throw new BadRequestException('This backup has no verified database artifact');
    }
    if (requiresDicom && !run.dicomChecksum) {
      throw new BadRequestException('This backup has no verified DICOM artifact');
    }

    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName ?? actor.role,
      actorRole: actor.role,
      action: AuditAction.BACKUP_RESTORE_STARTED,
      resource: AuditResource.BACKUP,
      resourceId: run.id,
      metadata: { type: requestedType, provider: env.provider },
    });

    const scratchDir = await fs.mkdtemp(path.join(env.backupDir, 'restore-'));
    const result: RestoreResult = {};
    try {
      if (requiresDatabase) {
        const targetUrl = process.env.RESTORE_DATABASE_URL;
        if (!targetUrl) {
          throw new Error(
            'RESTORE_DATABASE_URL must be set to the explicitly chosen, empty restore database',
          );
        }
        const checksum = run.databaseChecksum as string;
        const artifactPath = await this.resolveRestoreArtifact(
          run.databaseArtifact,
          run.databaseObjectKey,
          checksum,
          scratchDir,
          'database',
        );
        await restoreDatabaseDump(artifactPath, targetUrl, checksum, env);
        result.database = 'restored';
      }

      if (requiresDicom) {
        const checksum = run.dicomChecksum as string;
        const artifactPath = await this.resolveRestoreArtifact(
          run.dicomArtifact,
          run.dicomObjectKey,
          checksum,
          scratchDir,
          'dicom',
        );
        result.dicom = await restoreDicomArchive(
          artifactPath,
          checksum,
          env,
          this.prisma as PrismaClient,
        );
      }

      await this.audit.create({
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: AuditAction.BACKUP_RESTORED,
        resource: AuditResource.BACKUP,
        resourceId: run.id,
        metadata: { type: requestedType, result },
      });
      return { data: result };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Backup restore failed';
      await this.audit.create({
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: AuditAction.BACKUP_RESTORE_FAILED,
        resource: AuditResource.BACKUP,
        resourceId: run.id,
        metadata: { type: requestedType, reason },
      });
      throw new BadRequestException(reason);
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async resolveRestoreArtifact(
    artifactPath: string | null,
    objectKey: string | null,
    checksum: string,
    scratchDir: string,
    kind: 'database' | 'dicom',
  ): Promise<string> {
    if (this.storage.remote && objectKey) {
      const target = path.join(scratchDir, `${kind}-artifact`);
      await this.storage.download(objectKey, target);
      if (!(await verifyChecksum(target, checksum))) {
        throw new Error(`Restored ${kind} artifact checksum mismatch`);
      }
      return target;
    }
    if (!artifactPath || !(await verifyChecksum(artifactPath, checksum))) {
      throw new Error(`Restored ${kind} artifact checksum mismatch`);
    }
    return artifactPath;
  }
}
