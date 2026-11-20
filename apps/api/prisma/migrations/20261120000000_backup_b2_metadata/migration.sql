ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_RESTORE_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_RESTORE_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_OBJECT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_RETENTION_APPLIED';

ALTER TABLE "BackupRun"
  ADD COLUMN "storageProvider" TEXT,
  ADD COLUMN "environment" TEXT,
  ADD COLUMN "databaseObjectKey" TEXT,
  ADD COLUMN "dicomObjectKey" TEXT,
  ADD COLUMN "databaseChecksum" TEXT,
  ADD COLUMN "dicomChecksum" TEXT,
  ADD COLUMN "databaseSizeBytes" BIGINT,
  ADD COLUMN "dicomSizeBytes" BIGINT,
  ADD COLUMN "databaseVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dicomVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "remoteVerifiedAt" TIMESTAMP(3);

CREATE INDEX "BackupRun_storageProvider_environment_idx" ON "BackupRun"("storageProvider", "environment");
