-- Additive retention lifecycle schema. No existing rows or columns are removed.

DO $$
BEGIN
  CREATE TYPE "RetentionStatus" AS ENUM (
    'PENDING_RETENTION', 'AWAITING_USER_RESPONSE', 'CANCELLED_DEFERRED',
    'NOTIFICATION_IGNORED', 'AUTOMATIC_PROCESSING', 'ARCHIVING',
    'ARCHIVE_VERIFICATION', 'ARCHIVED', 'ORIGINAL_DATA_CLEANUP',
    'BACKUP_RETENTION', 'DICOM_DELETED', 'METADATA_DELETED', 'COMPLETED',
    'ON_HOLD', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RetentionAnchorSource" AS ENUM (
    'COMPLETED_AT', 'HOSPITAL_ACCEPTED_AT', 'DELIVERED_AT', 'STUDY_DATE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RetentionLockReason" AS ENUM (
    'LEGAL_HOLD', 'ACTIVE_DISPUTE', 'HOSPITAL_RETENTION_REQUEST',
    'PENDING_REPORT_DELIVERY', 'MANDATORY_RETENTION', 'INVESTIGATION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RetentionResponse" AS ENUM ('CANCEL', 'DELETE', 'IGNORED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
    'PENDING', 'SENT', 'DELIVERED', 'READ', 'RESPONDED', 'FAILED', 'IGNORED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RetentionArchiveStatus" AS ENUM (
    'PENDING', 'ARCHIVING', 'ARCHIVE_VERIFICATION', 'ARCHIVED', 'FAILED',
    'DELETING', 'DELETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "BackupObjectDeletionStatus" AS ENUM (
    'PENDING', 'DELETING', 'DELETED', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "OriginalDataDeletionStatus" AS ENUM (
    'PENDING', 'IN_PROGRESS', 'DELETED', 'FAILED', 'SKIPPED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RetentionJobType" AS ENUM (
    'START_RETENTION', 'SEND_NOTIFICATION', 'MARK_IGNORED',
    'PROCESS_ARCHIVE', 'CLEANUP_ORIGINAL', 'DELETE_EXPIRED_BACKUPS'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RetentionJobStatus" AS ENUM (
    'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RetentionAuditAction" AS ENUM (
    'RETENTION_STARTED', 'RETENTION_ELIGIBILITY_CHECKED',
    'NOTIFICATION_SENT', 'NOTIFICATION_DELIVERED', 'NOTIFICATION_IGNORED',
    'DELETION_CANCELLED', 'AUTOMATIC_DELETION_TRIGGERED',
    'ARCHIVE_CREATED', 'ARCHIVE_VERIFIED', 'ARCHIVE_FAILED',
    'ORIGINAL_DATA_DELETED', 'DICOM_BACKUP_DELETED',
    'METADATA_BACKUP_DELETED', 'PERMANENT_DELETION_VERIFIED',
    'RETENTION_LOCK_APPLIED', 'RETENTION_LOCK_RELEASED', 'DELETION_FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RETENTION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RETENTION_ELIGIBILITY_CHECKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_DELIVERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_IGNORED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELETION_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOMATIC_DELETION_TRIGGERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ARCHIVE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ARCHIVE_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ARCHIVE_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ORIGINAL_DATA_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DICOM_BACKUP_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'METADATA_BACKUP_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PERMANENT_DELETION_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RETENTION_LOCK_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RETENTION_LOCK_RELEASED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELETION_FAILED';
ALTER TYPE "AuditResource" ADD VALUE IF NOT EXISTS 'RETENTION_NOTIFICATION';
ALTER TYPE "AuditResource" ADD VALUE IF NOT EXISTS 'RETENTION_ARCHIVE';
ALTER TYPE "AuditResource" ADD VALUE IF NOT EXISTS 'LEGAL_HOLD';

ALTER TABLE "Study"
  ADD COLUMN IF NOT EXISTS "retentionLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "retentionLockReason" "RetentionLockReason",
  ADD COLUMN IF NOT EXISTS "retentionLockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retentionLockedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "retentionLockExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Study_archivedAt_idx" ON "Study"("archivedAt");
CREATE INDEX IF NOT EXISTS "Study_retentionLocked_idx" ON "Study"("retentionLocked");
ALTER TABLE "Study"
  DROP CONSTRAINT IF EXISTS "Study_retentionLockedBy_fkey";
ALTER TABLE "Study"
  ADD CONSTRAINT "Study_retentionLockedBy_fkey"
  FOREIGN KEY ("retentionLockedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "StudyRetention" (
  "id" TEXT NOT NULL,
  "studyId" TEXT NOT NULL,
  "status" "RetentionStatus" NOT NULL DEFAULT 'PENDING_RETENTION',
  "eligibleAt" TIMESTAMP(3) NOT NULL,
  "anchorAt" TIMESTAMP(3) NOT NULL,
  "anchorSource" "RetentionAnchorSource" NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "cancelCount" INTEGER NOT NULL DEFAULT 0,
  "ignoredCount" INTEGER NOT NULL DEFAULT 0,
  "notificationSequence" INTEGER NOT NULL DEFAULT 0,
  "lastNotificationAt" TIMESTAMP(3),
  "nextActionAt" TIMESTAMP(3) NOT NULL,
  "responseDeadline" TIMESTAMP(3),
  "retentionLocked" BOOLEAN NOT NULL DEFAULT false,
  "lockReason" "RetentionLockReason",
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudyRetention_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudyRetention_studyId_key" ON "StudyRetention"("studyId");
CREATE INDEX IF NOT EXISTS "StudyRetention_status_nextActionAt_idx" ON "StudyRetention"("status", "nextActionAt");
CREATE INDEX IF NOT EXISTS "StudyRetention_retentionLocked_idx" ON "StudyRetention"("retentionLocked");
ALTER TABLE "StudyRetention"
  DROP CONSTRAINT IF EXISTS "StudyRetention_studyId_fkey";
ALTER TABLE "StudyRetention"
  ADD CONSTRAINT "StudyRetention_studyId_fkey"
  FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "RetentionNotification" (
  "id" TEXT NOT NULL,
  "studyId" TEXT NOT NULL,
  "retentionId" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "appNotificationId" TEXT,
  "sequenceNumber" INTEGER NOT NULL,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "responseDeadline" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "response" "RetentionResponse",
  "deliveryStatus" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RetentionNotification_retentionId_recipientUserId_sequenceNumber_key" ON "RetentionNotification"("retentionId", "recipientUserId", "sequenceNumber");
CREATE INDEX IF NOT EXISTS "RetentionNotification_deliveryStatus_nextRetryAt_idx" ON "RetentionNotification"("deliveryStatus", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "RetentionNotification_retentionId_response_idx" ON "RetentionNotification"("retentionId", "response");
CREATE INDEX IF NOT EXISTS "RetentionNotification_recipientUserId_respondedAt_idx" ON "RetentionNotification"("recipientUserId", "respondedAt");
ALTER TABLE "RetentionNotification"
  DROP CONSTRAINT IF EXISTS "RetentionNotification_studyId_fkey";
ALTER TABLE "RetentionNotification"
  ADD CONSTRAINT "RetentionNotification_studyId_fkey"
  FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetentionNotification"
  DROP CONSTRAINT IF EXISTS "RetentionNotification_retentionId_fkey";
ALTER TABLE "RetentionNotification"
  ADD CONSTRAINT "RetentionNotification_retentionId_fkey"
  FOREIGN KEY ("retentionId") REFERENCES "StudyRetention"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetentionNotification"
  DROP CONSTRAINT IF EXISTS "RetentionNotification_recipientUserId_fkey";
ALTER TABLE "RetentionNotification"
  ADD CONSTRAINT "RetentionNotification_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "RetentionArchive" (
  "id" TEXT NOT NULL,
  "studyId" TEXT NOT NULL,
  "retentionId" TEXT NOT NULL,
  "backupRunId" TEXT,
  "archiveStatus" "RetentionArchiveStatus" NOT NULL DEFAULT 'PENDING',
  "archiveCreatedAt" TIMESTAMP(3),
  "archiveVerifiedAt" TIMESTAMP(3),
  "dicomObjectKey" TEXT,
  "studyObjectKey" TEXT,
  "reportObjectKey" TEXT,
  "manifestObjectKey" TEXT,
  "auditObjectKey" TEXT,
  "dicomChecksum" TEXT,
  "metadataChecksum" TEXT,
  "manifestChecksum" TEXT,
  "checksum" TEXT,
  "dicomDeleteAt" TIMESTAMP(3),
  "metadataDeleteAt" TIMESTAMP(3),
  "originalDataDeletionStatus" "OriginalDataDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "dicomDeletionStatus" "BackupObjectDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "metadataDeletionStatus" "BackupObjectDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionArchive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RetentionArchive_studyId_key" ON "RetentionArchive"("studyId");
CREATE UNIQUE INDEX IF NOT EXISTS "RetentionArchive_retentionId_key" ON "RetentionArchive"("retentionId");
CREATE INDEX IF NOT EXISTS "RetentionArchive_status_dicomDeleteAt_metadataDeleteAt_idx" ON "RetentionArchive"("archiveStatus", "dicomDeleteAt", "metadataDeleteAt");
ALTER TABLE "RetentionArchive"
  DROP CONSTRAINT IF EXISTS "RetentionArchive_studyId_fkey";
ALTER TABLE "RetentionArchive"
  ADD CONSTRAINT "RetentionArchive_studyId_fkey"
  FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetentionArchive"
  DROP CONSTRAINT IF EXISTS "RetentionArchive_retentionId_fkey";
ALTER TABLE "RetentionArchive"
  ADD CONSTRAINT "RetentionArchive_retentionId_fkey"
  FOREIGN KEY ("retentionId") REFERENCES "StudyRetention"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetentionArchive"
  DROP CONSTRAINT IF EXISTS "RetentionArchive_backupRunId_fkey";
ALTER TABLE "RetentionArchive"
  ADD CONSTRAINT "RetentionArchive_backupRunId_fkey"
  FOREIGN KEY ("backupRunId") REFERENCES "BackupRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "RetentionAuditLog" (
  "id" TEXT NOT NULL,
  "studyId" TEXT,
  "retentionId" TEXT,
  "action" "RetentionAuditAction" NOT NULL,
  "triggeredBy" TEXT NOT NULL,
  "actorId" TEXT,
  "status" TEXT NOT NULL,
  "details" JSONB,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RetentionAuditLog_studyId_timestamp_idx" ON "RetentionAuditLog"("studyId", "timestamp");
CREATE INDEX IF NOT EXISTS "RetentionAuditLog_action_timestamp_idx" ON "RetentionAuditLog"("action", "timestamp");
ALTER TABLE "RetentionAuditLog"
  DROP CONSTRAINT IF EXISTS "RetentionAuditLog_studyId_fkey";
ALTER TABLE "RetentionAuditLog"
  ADD CONSTRAINT "RetentionAuditLog_studyId_fkey"
  FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetentionAuditLog"
  DROP CONSTRAINT IF EXISTS "RetentionAuditLog_retentionId_fkey";
ALTER TABLE "RetentionAuditLog"
  ADD CONSTRAINT "RetentionAuditLog_retentionId_fkey"
  FOREIGN KEY ("retentionId") REFERENCES "StudyRetention"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetentionAuditLog"
  DROP CONSTRAINT IF EXISTS "RetentionAuditLog_actorId_fkey";
ALTER TABLE "RetentionAuditLog"
  ADD CONSTRAINT "RetentionAuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "RetentionJob" (
  "id" TEXT NOT NULL,
  "type" "RetentionJobType" NOT NULL,
  "status" "RetentionJobStatus" NOT NULL DEFAULT 'PENDING',
  "dedupeKey" TEXT NOT NULL,
  "studyId" TEXT,
  "retentionId" TEXT,
  "payload" JSONB,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "leaseUntil" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RetentionJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RetentionJob_dedupeKey_key" ON "RetentionJob"("dedupeKey");
CREATE INDEX IF NOT EXISTS "RetentionJob_status_dueAt_idx" ON "RetentionJob"("status", "dueAt");
CREATE INDEX IF NOT EXISTS "RetentionJob_leaseUntil_idx" ON "RetentionJob"("leaseUntil");
ALTER TABLE "RetentionJob"
  DROP CONSTRAINT IF EXISTS "RetentionJob_studyId_fkey";
ALTER TABLE "RetentionJob"
  ADD CONSTRAINT "RetentionJob_studyId_fkey"
  FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetentionJob"
  DROP CONSTRAINT IF EXISTS "RetentionJob_retentionId_fkey";
ALTER TABLE "RetentionJob"
  ADD CONSTRAINT "RetentionJob_retentionId_fkey"
  FOREIGN KEY ("retentionId") REFERENCES "StudyRetention"("id") ON DELETE CASCADE ON UPDATE CASCADE;
