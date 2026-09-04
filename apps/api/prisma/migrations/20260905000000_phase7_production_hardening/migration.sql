-- Phase 7: Production hardening schema
-- Adds audit correlation ID + indexes, operational SLA config, backup-run
-- metadata, and a study archival flag used by the safe retention workflow.

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'COMPLETED', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('DATABASE', 'DICOM', 'FULL');

-- CreateEnum
CREATE TYPE "SlaPriority" AS ENUM ('STAT', 'URGENT', 'ROUTINE');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "correlationId" TEXT;

-- AlterTable
ALTER TABLE "Study" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "databaseArtifact" TEXT,
    "dicomArtifact" TEXT,
    "checksum" TEXT,
    "sizeBytes" BIGINT,
    "backupDirectory" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaConfig" (
    "id" TEXT NOT NULL,
    "priority" "SlaPriority" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_status_idx" ON "BackupRun"("status");

-- CreateIndex
CREATE INDEX "BackupRun_createdAt_idx" ON "BackupRun"("createdAt");

-- CreateIndex
CREATE INDEX "BackupRun_verifiedAt_idx" ON "BackupRun"("verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlaConfig_priority_key" ON "SlaConfig"("priority");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorRole_idx" ON "AuditLog"("actorRole");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
