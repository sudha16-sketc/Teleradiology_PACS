import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BackupStatus, BackupType, AuditAction, AuditResource } from '@prisma/client';
import {
  resolveBackupEnv,
  dumpDatabase,
  exportOrthancVolume,
  validateDatabaseDump,
  verifyChecksum,
} from './backup-ops.js';

function fileTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
    actor: { id: string; role: string; displayName?: string },
  ): Promise<{ data: unknown; error?: string }> {
    const t = (['DATABASE', 'DICOM', 'FULL'] as string[]).includes(type)
      ? (type as BackupType)
      : BackupType.FULL;

    const env = resolveBackupEnv();
    const ts = fileTimestamp();
    const run = await this.prisma.backupRun.create({
      data: {
        type: t,
        status: BackupStatus.RUNNING,
        backupDirectory: env.backupDir,
        createdById: actor.id,
        startedAt: new Date(),
      },
    });

    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName ?? actor.role,
      actorRole: actor.role,
      action: AuditAction.BACKUP_STARTED,
      resource: AuditResource.BACKUP,
      resourceId: run.id,
      metadata: { type: t },
    });

    try {
      const update: {
        status: BackupStatus;
        completedAt?: Date;
        failedAt?: Date;
        failureReason?: string;
        databaseArtifact?: string;
        dicomArtifact?: string;
        checksum?: string;
        sizeBytes?: bigint;
      } = { status: BackupStatus.COMPLETED, completedAt: new Date() };

      if (t === BackupType.DATABASE || t === BackupType.FULL) {
        const dbFile = `${env.backupDir}/db_${ts}.sql`;
        const db = await dumpDatabase(dbFile, env);
        update.databaseArtifact = db.filePath;
        update.checksum = db.checksum;
        update.sizeBytes = BigInt(db.sizeBytes);
        if (!(await validateDatabaseDump(db.filePath))) {
          throw new Error('Database backup failed validation (empty/unreadable dump)');
        }
      }

      if (t === BackupType.DICOM || t === BackupType.FULL) {
        const orthancFile = `${env.backupDir}/orthanc_${ts}.tar`;
        const dicom = await exportOrthancVolume(orthancFile, env);
        update.dicomArtifact = dicom.filePath;
        if (!update.checksum) update.checksum = dicom.checksum;
        update.sizeBytes = BigInt(dicom.sizeBytes);
      }

      await this.prisma.backupRun.update({ where: { id: run.id }, data: update });
      await this.audit.create({
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: AuditAction.BACKUP_COMPLETED,
        resource: AuditResource.BACKUP,
        resourceId: run.id,
        metadata: { type: t, databaseArtifact: update.databaseArtifact, dicomArtifact: update.dicomArtifact },
      });
      return { data: await this.prisma.backupRun.findUnique({ where: { id: run.id } }) };
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : 'Backup execution failed';
      await this.prisma.backupRun.update({
        where: { id: run.id },
        data: { status: BackupStatus.FAILED, failedAt: new Date(), failureReason: reason },
      });
      await this.audit.create({
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: AuditAction.BACKUP_FAILED,
        resource: AuditResource.BACKUP,
        resourceId: run.id,
        metadata: { type: t, reason },
      });
      return { data: await this.prisma.backupRun.findUnique({ where: { id: run.id } }), error: reason };
    }
  }

  async verify(
    id: string,
    actor: { id: string; role: string; displayName?: string },
  ): Promise<{ data: unknown }> {
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Backup run not found');

    let verified = false;
    let detail = '';
    try {
      if (run.databaseArtifact && run.checksum) {
        verified = await verifyChecksum(run.databaseArtifact, run.checksum);
        if (!verified) {
          detail = 'checksum mismatch on database artifact';
        } else if (run.type === BackupType.DATABASE || run.type === BackupType.FULL) {
          verified = await validateDatabaseDump(run.databaseArtifact);
          detail = verified ? 'database artifact validated' : 'database artifact failed validation';
        }
      } else if (run.dicomArtifact && run.checksum) {
        verified = await verifyChecksum(run.dicomArtifact, run.checksum);
        detail = verified ? 'dicom artifact checksum matched' : 'checksum mismatch on dicom artifact';
      }
    } catch {
      verified = false;
      detail = 'verification could not be completed';
    }

    await this.prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: verified ? BackupStatus.VERIFIED : BackupStatus.FAILED,
        verifiedAt: verified ? new Date() : undefined,
        failureReason: verified ? null : detail,
      },
    });

    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName ?? actor.role,
      actorRole: actor.role,
      action: AuditAction.BACKUP_VERIFIED,
      resource: AuditResource.BACKUP,
      resourceId: run.id,
      metadata: { verified, detail },
    });

    return {
      data: { id: run.id, status: verified ? BackupStatus.VERIFIED : BackupStatus.FAILED, detail },
    };
  }
}
