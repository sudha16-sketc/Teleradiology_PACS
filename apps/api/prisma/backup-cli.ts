import 'dotenv/config';
import { setTimeout as sleep } from 'timers/promises';
import {
  Prisma,
  PrismaClient,
  BackupType,
  AuditResource,
} from '@prisma/client';
import { resolveBackupEnv } from '../src/backup/backup-ops.js';
import { createBackupStorage } from '../src/backup/backup-storage.js';
import { executeBackup, type BackupAuditEntry, type BackupAuditSink } from '../src/backup/backup-workflow.js';

const prisma = new PrismaClient();

async function main() {
  const typeArg = process.argv.find((a) => a.startsWith('--type='))?.split('=')[1];
  const type = (['DATABASE', 'DICOM', 'FULL'] as string[]).includes(typeArg ?? '')
    ? (typeArg as BackupType)
    : BackupType.FULL;
  const actorName = process.env.BACKUP_ACTOR ?? 'backup-cli';
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'APPROVED', isActive: true },
    select: { id: true, displayName: true },
    orderBy: { createdAt: 'asc' },
  });

  const audit: BackupAuditSink = admin
    ? {
        create: (entry: BackupAuditEntry) =>
          prisma.auditLog.create({
            data: {
              actorId: admin.id,
              actorName: admin.displayName ?? actorName,
              actorRole: 'ADMIN',
              action: entry.action,
              resource: entry.resource ?? AuditResource.BACKUP,
              resourceId: entry.resourceId,
              metadata: entry.metadata as Prisma.InputJsonValue | undefined,
            },
          }),
      }
    : { create: async () => undefined };

  const result = await executeBackup(
    prisma,
    audit,
    createBackupStorage(resolveBackupEnv()),
    resolveBackupEnv(),
    type,
    {
      id: admin?.id ?? actorName,
      role: 'ADMIN',
      displayName: admin?.displayName ?? actorName,
    },
  );

  if (!result.data) {
    console.error(`[backup] could not start: ${result.error ?? 'unknown error'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[backup] run ${result.data.id} (${type}) finished as ${result.data.status}`);
  if (result.data.databaseArtifact) {
    console.log(`[backup] database -> ${result.data.databaseArtifact}`);
  }
  if (result.data.dicomArtifact) {
    console.log(`[backup] dicom -> ${result.data.dicomArtifact}`);
  }
  if (result.error) {
    console.error(`[backup] ${result.error}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('backup-cli failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(50);
    await prisma.$disconnect();
  });
