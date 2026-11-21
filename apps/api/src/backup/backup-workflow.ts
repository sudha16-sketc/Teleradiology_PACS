import { promises as fs } from 'fs';
import path from 'path';
import {
  Prisma,
  BackupStatus,
  BackupType,
  AuditAction,
  AuditResource,
  type BackupRun,
  type PrismaClient,
} from '@prisma/client';
import type { BackupEnv, ArtifactResult } from './backup-ops.js';
import {
  backupObjectKey,
  dumpDatabase,
  dumpDatabaseDirect,
  exportOrthancVolume,
  validateDatabaseDump,
  verifyChecksum,
} from './backup-ops.js';
import { createDicomWebArchive } from './dicom-backup.js';
import type { ArtifactMetadata, BackupStorage } from './backup-storage.js';

export interface BackupActor {
  id: string;
  role: string;
  displayName?: string;
}

export interface BackupAuditEntry {
  actorId: string;
  actorName: string;
  actorRole: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

export interface BackupAuditSink {
  create(entry: BackupAuditEntry): Promise<unknown>;
}

export interface BackupExecutionResult {
  data: BackupRun | null;
  error?: string;
}

export function fileTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function actorName(actor: BackupActor): string {
  return actor.displayName ?? actor.role;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Backup execution failed';
}

async function generateDatabaseArtifact(
  outFile: string,
  env: BackupEnv,
): Promise<ArtifactResult> {
  return env.provider === 'B2'
    ? dumpDatabaseDirect(outFile, env)
    : dumpDatabase(outFile, env);
}

async function generateDicomArtifact(
  outFile: string,
  env: BackupEnv,
): Promise<ArtifactResult> {
  return env.provider === 'B2'
    ? createDicomWebArchive(outFile, env)
    : exportOrthancVolume(outFile, env);
}

async function artifactMetadata(
  runId: string,
  artifact: ArtifactMetadata['artifact'],
  result: ArtifactResult,
): Promise<ArtifactMetadata> {
  return {
    backupRunId: runId,
    artifact,
    checksum: result.checksum,
    createdAt: new Date().toISOString(),
  };
}

async function storeAndVerifyArtifact(
  storage: BackupStorage,
  result: ArtifactResult,
  key: string,
  metadata: ArtifactMetadata,
): Promise<void> {
  if (storage.remote) {
    await storage.upload(result.filePath, key, metadata);
    const remote = await storage.head(key);
    if (
      !remote ||
      remote.checksum !== result.checksum ||
      remote.sizeBytes !== result.sizeBytes
    ) {
      throw new Error(`Remote artifact verification failed for ${metadata.artifact}`);
    }
    if (!(await storage.verify(key, result.filePath, result.checksum))) {
      throw new Error(`Remote artifact checksum verification failed for ${metadata.artifact}`);
    }
    return;
  }
  if (!(await verifyChecksum(result.filePath, result.checksum))) {
    throw new Error(`Local artifact checksum verification failed for ${metadata.artifact}`);
  }
}

export async function executeBackup(
  prisma: PrismaClient,
  audit: BackupAuditSink,
  storage: BackupStorage,
  env: BackupEnv,
  type: BackupType,
  actor: BackupActor,
): Promise<BackupExecutionResult> {
  const activeRun = await prisma.backupRun.findFirst({
    where: { status: BackupStatus.RUNNING },
    select: { id: true },
  });
  if (activeRun) {
    return {
      data: null,
      error: `Backup already in progress (run ${activeRun.id}) — concurrent runs are not allowed`,
    };
  }

  const ts = fileTimestamp();
  const run = await prisma.backupRun.create({
    data: {
      type,
      status: BackupStatus.RUNNING,
      backupDirectory: env.backupDir,
      createdById: actor.id || null,
      startedAt: new Date(),
      storageProvider: env.provider,
      environment: env.environment,
    },
  });

  await audit.create({
    actorId: actor.id,
    actorName: actorName(actor),
    actorRole: actor.role,
    action: AuditAction.BACKUP_STARTED,
    resource: AuditResource.BACKUP,
    resourceId: run.id,
    metadata: { type, provider: env.provider, environment: env.environment },
  });

  const update: Prisma.BackupRunUpdateInput = {
    storageProvider: env.provider,
    environment: env.environment,
  };

  try {
    if (type === BackupType.DATABASE || type === BackupType.FULL) {
      const outFile = path.join(
        env.backupDir,
        `db_${run.id}_${ts}${env.provider === 'B2' ? '.dump.gz' : '.sql'}`,
      );
      const artifact = await generateDatabaseArtifact(outFile, env);
      if (!(await validateDatabaseDump(artifact.filePath))) {
        throw new Error('Database backup failed validation (empty/unreadable dump)');
      }
      const key = backupObjectKey(env, run.id, ts, 'database');
      await storeAndVerifyArtifact(
        storage,
        artifact,
        key,
        await artifactMetadata(run.id, 'database', artifact),
      );
      update.databaseArtifact = artifact.filePath;
      update.databaseObjectKey = key;
      update.databaseChecksum = artifact.checksum;
      update.databaseSizeBytes = BigInt(artifact.sizeBytes);
      update.databaseVerified = true;
      update.checksum = artifact.checksum;
      update.sizeBytes = BigInt(artifact.sizeBytes);
    }

    if (type === BackupType.DICOM || type === BackupType.FULL) {
      const outFile = path.join(
        env.backupDir,
        `orthanc_${run.id}_${ts}${env.provider === 'B2' ? '.tar.gz' : '.tar'}`,
      );
      const artifact = await generateDicomArtifact(outFile, env);
      const key = backupObjectKey(env, run.id, ts, 'dicom');
      await storeAndVerifyArtifact(
        storage,
        artifact,
        key,
        await artifactMetadata(run.id, 'dicom', artifact),
      );
      update.dicomArtifact = artifact.filePath;
      update.dicomObjectKey = key;
      update.dicomChecksum = artifact.checksum;
      update.dicomSizeBytes = BigInt(artifact.sizeBytes);
      update.dicomVerified = true;
      if (!update.checksum) update.checksum = artifact.checksum;
      if (!update.sizeBytes) update.sizeBytes = BigInt(artifact.sizeBytes);
    }

    update.status = BackupStatus.COMPLETED;
    update.completedAt = new Date();
    update.remoteVerifiedAt = storage.remote ? new Date() : null;
    await prisma.backupRun.update({ where: { id: run.id }, data: update });
    await audit.create({
      actorId: actor.id,
      actorName: actorName(actor),
      actorRole: actor.role,
      action: AuditAction.BACKUP_COMPLETED,
      resource: AuditResource.BACKUP,
      resourceId: run.id,
      metadata: {
        type,
        provider: env.provider,
        environment: env.environment,
        databaseArtifact: update.databaseArtifact,
        databaseObjectKey: update.databaseObjectKey,
        databaseChecksum: update.databaseChecksum,
        databaseSizeBytes: update.databaseSizeBytes?.toString(),
        dicomArtifact: update.dicomArtifact,
        dicomObjectKey: update.dicomObjectKey,
        dicomChecksum: update.dicomChecksum,
        dicomSizeBytes: update.dicomSizeBytes?.toString(),
      },
    });

    await applyBackupRetention(prisma, audit, storage, env, actor, run.id).catch(
      async (err) => {
        await audit.create({
          actorId: actor.id,
          actorName: actorName(actor),
          actorRole: actor.role,
          action: AuditAction.BACKUP_RETENTION_APPLIED,
          resource: AuditResource.BACKUP,
          resourceId: run.id,
          metadata: { applied: false, reason: errorMessage(err) },
        }).catch(() => undefined);
      },
    );

    return {
      data: await prisma.backupRun.findUnique({ where: { id: run.id } }),
    };
  } catch (err) {
    const reason = errorMessage(err);
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        ...update,
        status: BackupStatus.FAILED,
        failedAt: new Date(),
        failureReason: reason,
      },
    });
    await audit.create({
      actorId: actor.id,
      actorName: actorName(actor),
      actorRole: actor.role,
      action: AuditAction.BACKUP_FAILED,
      resource: AuditResource.BACKUP,
      resourceId: run.id,
      metadata: { type, reason, provider: env.provider },
    });
    return {
      data: await prisma.backupRun.findUnique({ where: { id: run.id } }),
      error: reason,
    };
  }
}

interface RetentionCandidate {
  run: BackupRun;
  artifacts: Array<{ key: string; checksum: string | null }>;
}

export async function applyBackupRetention(
  prisma: PrismaClient,
  audit: BackupAuditSink,
  storage: BackupStorage,
  env: BackupEnv,
  actor: BackupActor,
  currentRunId: string,
): Promise<{ kept: number; deleted: string[] }> {
  if (!storage.remote || !env.b2RetentionEnabled || env.b2RetentionCount <= 1) {
    return { kept: 0, deleted: [] };
  }
  if (actor.role !== 'ADMIN') {
    throw new Error('Backup retention requires ADMIN authorization');
  }
  const candidateWhere: Prisma.BackupRunWhereInput = {
    storageProvider: 'B2',
    environment: env.environment,
    type: BackupType.FULL,
    status: { in: [BackupStatus.COMPLETED, BackupStatus.VERIFIED] },
    databaseVerified: true,
    dicomVerified: true,
    id: { not: currentRunId },
  };
  const runs = await prisma.backupRun.findMany({
    where: candidateWhere,
    orderBy: { completedAt: 'desc' },
  });
  const candidates: RetentionCandidate[] = runs
    .map((run) => ({
      run,
      artifacts: [
        run.databaseObjectKey
          ? { key: run.databaseObjectKey, checksum: run.databaseChecksum }
          : null,
        run.dicomObjectKey
          ? { key: run.dicomObjectKey, checksum: run.dicomChecksum }
          : null,
      ].filter((artifact): artifact is { key: string; checksum: string | null } => Boolean(artifact)),
    }))
    .filter((candidate) => candidate.artifacts.length === 2);
  const keepCount = Math.max(1, env.b2RetentionCount);
  const keep = candidates.slice(0, keepCount - 1);
  const remove = candidates.slice(keepCount - 1);
  const deleted: string[] = [];

  for (const candidate of remove) {
    for (const artifact of candidate.artifacts) {
      const { key, checksum } = artifact;
      if (deleted.includes(key)) continue;
      const present = await storage.head(key);
      if (!present) continue;
      if (checksum && present.checksum && present.checksum !== checksum) continue;
      const currentRun = await prisma.backupRun.findUnique({
        where: { id: candidate.run.id },
        select: {
          status: true,
          completedAt: true,
          databaseVerified: true,
          dicomVerified: true,
          databaseObjectKey: true,
          dicomObjectKey: true,
          databaseChecksum: true,
          dicomChecksum: true,
        },
      });
      if (
        !currentRun ||
        !currentRun.completedAt ||
        !currentRun.databaseVerified ||
        !currentRun.dicomVerified ||
        currentRun.status !== BackupStatus.COMPLETED &&
        currentRun.status !== BackupStatus.VERIFIED
      ) {
        continue;
      }
      const ownedByRun =
        (key === currentRun.databaseObjectKey && checksum === currentRun.databaseChecksum) ||
        (key === currentRun.dicomObjectKey && checksum === currentRun.dicomChecksum);
      if (!ownedByRun) continue;
      const newerCount = await prisma.backupRun.count({
        where: { ...candidateWhere, completedAt: { gt: currentRun.completedAt } },
      });
      if (newerCount < keepCount - 1) continue;
      const retentionReferences = await prisma.retentionArchive.findMany({
        where: {
          OR: [
            { backupRunId: candidate.run.id },
            { dicomObjectKey: key },
            { studyObjectKey: key },
            { reportObjectKey: key },
            { manifestObjectKey: key },
          ],
        },
        select: { id: true },
      });
      if (retentionReferences.length > 0) continue;
      const heldStudies = await prisma.study.count({
        where: {
          OR: [
            { retentionLocked: true },
            { retentionLockReason: 'MANDATORY_RETENTION' },
          ],
        },
      });
      const heldRetentions = await prisma.studyRetention.count({
        where: {
          OR: [
            { retentionLocked: true },
            { lockReason: 'MANDATORY_RETENTION' },
          ],
        },
      });
      if (heldStudies > 0 || heldRetentions > 0) continue;
      if (storage.purgeVersions) {
        await storage.purgeVersions(key);
      } else {
        await storage.delete(key);
      }
      const purged = storage.verifyPurge
        ? await storage.verifyPurge(key)
        : (await storage.head(key)) === null;
      if (!purged) {
        throw new Error(`Backup object ${key} could not be permanently removed`);
      }
      deleted.push(key);
      await audit.create({
        actorId: actor.id,
        actorName: actorName(actor),
        actorRole: actor.role,
        action: AuditAction.BACKUP_OBJECT_DELETED,
        resource: AuditResource.BACKUP,
        resourceId: candidate.run.id,
        metadata: {
          key,
          reason: 'backup_retention',
          environment: env.environment,
          verified: true,
        },
      });
    }
  }

  await audit.create({
    actorId: actor.id,
    actorName: actorName(actor),
    actorRole: actor.role,
    action: AuditAction.BACKUP_RETENTION_APPLIED,
    resource: AuditResource.BACKUP,
    resourceId: currentRunId,
    metadata: {
      applied: true,
      environment: env.environment,
      retainCount: keepCount,
      keptRuns: keep.map((candidate) => candidate.run.id),
      deletedKeys: deleted,
    },
  });
  return { kept: keep.length, deleted };
}

export async function verifyBackupRun(
  prisma: PrismaClient,
  audit: BackupAuditSink,
  storage: BackupStorage,
  env: BackupEnv,
  run: BackupRun,
  actor: BackupActor,
): Promise<{ status: BackupStatus; detail: string }> {
  const details: string[] = [];
  const scratchPaths: string[] = [];
  let verified = true;

  const resolveArtifactPath = async (
    kind: 'database' | 'dicom',
    artifactPath: string | null,
    objectKey: string | null,
    checksum: string | null,
  ): Promise<string | null> => {
    if (!checksum) return null;
    if (storage.remote && objectKey) {
      const scratchDir = await fs.mkdtemp(path.join(env.backupDir, `verify-${kind}-`));
      const scratchFile = path.join(scratchDir, 'artifact');
      scratchPaths.push(scratchDir);
      await storage.download(objectKey, scratchFile);
      if (!(await verifyChecksum(scratchFile, checksum))) return null;
      return scratchFile;
    }
    if (!artifactPath || !(await verifyChecksum(artifactPath, checksum))) return null;
    return artifactPath;
  };

  try {
    if (run.type === BackupType.DATABASE || run.type === BackupType.FULL) {
      const databasePath = await resolveArtifactPath(
        'database',
        run.databaseArtifact,
        run.databaseObjectKey,
        run.databaseChecksum ?? run.checksum,
      );
      if (!databasePath || !(await validateDatabaseDump(databasePath))) {
        verified = false;
        details.push('database artifact missing, checksum mismatch, or invalid');
      } else {
        details.push('database artifact validated');
      }
    }

    if (run.type === BackupType.DICOM || run.type === BackupType.FULL) {
      const dicomPath = await resolveArtifactPath(
        'dicom',
        run.dicomArtifact,
        run.dicomObjectKey,
        run.dicomChecksum ?? run.checksum,
      );
      if (!dicomPath) {
        verified = false;
        details.push('dicom artifact missing or checksum mismatch');
      } else {
        details.push('dicom artifact validated');
      }
    }

    const status = verified ? BackupStatus.VERIFIED : BackupStatus.FAILED;
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status,
        verifiedAt: verified ? new Date() : undefined,
        remoteVerifiedAt: verified && storage.remote ? new Date() : undefined,
        failureReason: verified ? null : details.join('; '),
      },
    });
    await audit.create({
      actorId: actor.id,
      actorName: actorName(actor),
      actorRole: actor.role,
      action: AuditAction.BACKUP_VERIFIED,
      resource: AuditResource.BACKUP,
      resourceId: run.id,
      metadata: {
        verified,
        detail: details.join('; '),
        provider: env.provider,
        environment: env.environment,
      },
    });
    return { status, detail: details.join('; ') };
  } finally {
    for (const scratch of scratchPaths) {
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
