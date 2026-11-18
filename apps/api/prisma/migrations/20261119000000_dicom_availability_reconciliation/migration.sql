-- CreateEnum
CREATE TYPE "ImagingAvailability" AS ENUM ('PENDING', 'AVAILABLE', 'MISSING', 'UNAVAILABLE', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DICOM_AVAILABILITY_CHECK';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DICOM_RECONCILIATION';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DICOM_REINGEST';

-- AlterTable
ALTER TABLE "Study"
  ADD COLUMN "imagingAvailability" "ImagingAvailability" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "imagingAvailabilityReason" TEXT,
  ADD COLUMN "imagingCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Study_imagingAvailability_idx" ON "Study"("imagingAvailability");

-- CreateTable
CREATE TABLE "StudyReconciliationRun" (
  "id" TEXT NOT NULL,
  "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "requestedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "studiesScanned" INTEGER NOT NULL DEFAULT 0,
  "availableCount" INTEGER NOT NULL DEFAULT 0,
  "missingCount" INTEGER NOT NULL DEFAULT 0,
  "incompleteCount" INTEGER NOT NULL DEFAULT 0,
  "unavailableCount" INTEGER NOT NULL DEFAULT 0,
  "unexpectedCount" INTEGER NOT NULL DEFAULT 0,
  "findings" JSONB NOT NULL,
  "failureReason" TEXT,

  CONSTRAINT "StudyReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyReconciliationRun_startedAt_idx" ON "StudyReconciliationRun"("startedAt");
CREATE INDEX "StudyReconciliationRun_status_idx" ON "StudyReconciliationRun"("status");

-- AddForeignKey
ALTER TABLE "StudyReconciliationRun"
  ADD CONSTRAINT "StudyReconciliationRun_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
