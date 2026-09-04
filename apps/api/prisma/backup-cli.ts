import 'dotenv/config';
import { setTimeout as sleep } from 'timers/promises';
import { PrismaClient, BackupStatus, BackupType, AuditAction, AuditResource } from '@prisma/client';
import {
  resolveBackupEnv,
  dumpDatabase,
  exportOrthancVolume,
  validateDatabaseDump,
} from '../src/backup/backup-ops.js';

const prisma = new PrismaClient();

function fileTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

async function main() {
  const typeArg = process.argv.find((a) => a.startsWith('--type='))?.split('=')[1];
  const type = (['DATABASE', 'DICOM', 'FULL'] as string[]).includes(typeArg ?? '')
    ? (typeArg as BackupType)
    : BackupType.FULL;

  const env = resolveBackupEnv();
  const ts = fileTimestamp();
  const actorName = process.env.BACKUP_ACTOR ?? 'backup-cli';

  // AuditLog.actorId has a foreign key to User, so resolve a real admin. When
  // no admin exists the run is still recorded but audit rows are skipped.
  const actor = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'APPROVED', isActive: true },
    select: { id: true, displayName: true },
    orderBy: { createdAt: 'asc' },
  });
  const actorId = actor?.id;

  const run = await prisma.backupRun.create({
    data: {
      type,
      status: BackupStatus.RUNNING,
      backupDirectory: env.backupDir,
      createdById: actorId,
    },
  });
  console.log(`[backup] started run ${run.id} (${type})`);

  try {
    const update: {
      status: BackupStatus;
      completedAt?: Date;
      databaseArtifact?: string;
      dicomArtifact?: string;
      checksum?: string;
      sizeBytes?: bigint;
    } = { status: BackupStatus.COMPLETED, completedAt: new Date() };

    if (type === BackupType.DATABASE || type === BackupType.FULL) {
      const dbFile = `${env.backupDir}/db_${ts}.sql`;
      const db = await dumpDatabase(dbFile, env);
      update.databaseArtifact = db.filePath;
      update.checksum = db.checksum;
      update.sizeBytes = BigInt(db.sizeBytes);
      if (!(await validateDatabaseDump(db.filePath))) {
        throw new Error('dump failed validation');
      }
      console.log(`[backup] database -> ${db.filePath} (${db.sizeBytes} bytes, sha256 ${db.checksum.slice(0, 12)}...)`);
    }

    if (type === BackupType.DICOM || type === BackupType.FULL) {
      const orthancFile = `${env.backupDir}/orthanc_${ts}.tar`;
      const dicom = await exportOrthancVolume(orthancFile, env);
      update.dicomArtifact = dicom.filePath;
      if (!update.checksum) update.checksum = dicom.checksum;
      if (!update.sizeBytes) update.sizeBytes = BigInt(dicom.sizeBytes);
      console.log(`[backup] orthanc -> ${dicom.filePath} (${dicom.sizeBytes} bytes)`);
    }

    await prisma.backupRun.update({ where: { id: run.id }, data: update });
    if (actorId) {
      await prisma.auditLog.create({
        data: {
          actorId,
          actorName: actor?.displayName ?? actorName,
          actorRole: 'ADMIN',
          action: AuditAction.BACKUP_COMPLETED,
          resource: AuditResource.BACKUP,
          resourceId: run.id,
          metadata: { type, artifacts: [update.databaseArtifact, update.dicomArtifact].filter(Boolean) },
        },
      });
    }
    console.log(`[backup] completed run ${run.id} (${type})`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: BackupStatus.FAILED, failedAt: new Date(), failureReason: reason },
    });
    if (actorId) {
      await prisma.auditLog.create({
        data: {
          actorId,
          actorName: actor?.displayName ?? actorName,
          actorRole: 'ADMIN',
          action: AuditAction.BACKUP_FAILED,
          resource: AuditResource.BACKUP,
          resourceId: run.id,
          metadata: { type, reason },
        },
      });
    }
    console.error(`[backup] run ${run.id} FAILED: ${reason}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('backup-cli failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Give the process a beat to flush stdout before disconnecting.
    await sleep(50);
    await prisma.$disconnect();
  });
