ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MANUAL_DATA_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MANUAL_DATA_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MANUAL_DATA_PURGED';
ALTER TYPE "AuditResource" ADD VALUE IF NOT EXISTS 'MANUAL_DELETION';

CREATE TYPE "ManualDeletionArchiveStatus" AS ENUM (
  'ARCHIVING',
  'ARCHIVED',
  'RESTORING',
  'RESTORED',
  'PURGING',
  'PURGE_FAILED',
  'PURGED',
  'FAILED'
);

CREATE TABLE "ManualDeletionArchive" (
  "id" TEXT NOT NULL,
  "status" "ManualDeletionArchiveStatus" NOT NULL DEFAULT 'ARCHIVING',
  "hospitalId" TEXT NOT NULL,
  "hospitalName" TEXT NOT NULL,
  "studyInstanceUid" TEXT NOT NULL,
  "accessionNumber" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "patientName" TEXT NOT NULL,
  "deletedById" TEXT NOT NULL,
  "deletedByName" TEXT NOT NULL,
  "deletedByRole" "UserRole" NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "metadataObjectKey" TEXT,
  "metadataChecksum" TEXT,
  "dicomObjectKey" TEXT,
  "dicomChecksum" TEXT,
  "fileObjects" JSONB,
  "restoredAt" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManualDeletionArchive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManualDeletionArchive_hospitalId_deletedAt_idx"
  ON "ManualDeletionArchive"("hospitalId", "deletedAt");
CREATE INDEX "ManualDeletionArchive_status_expiresAt_idx"
  ON "ManualDeletionArchive"("status", "expiresAt");
CREATE INDEX "ManualDeletionArchive_studyInstanceUid_status_idx"
  ON "ManualDeletionArchive"("studyInstanceUid", "status");

CREATE UNIQUE INDEX "ManualDeletionArchive_activeStudy_key"
  ON "ManualDeletionArchive"("studyInstanceUid")
  WHERE "status" IN (
    'ARCHIVING',
    'ARCHIVED',
    'RESTORING',
    'PURGING',
    'PURGE_FAILED',
    'FAILED'
  );
