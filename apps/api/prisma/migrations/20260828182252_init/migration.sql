-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'COORDINATOR', 'RADIOLOGIST', 'TECHNICIAN', 'HOSPITAL_USER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F', 'O', 'U');

-- CreateEnum
CREATE TYPE "StudyPriority" AS ENUM ('STAT', 'URGENT', 'ROUTINE');

-- CreateEnum
CREATE TYPE "StudyStatus" AS ENUM ('NEW', 'VALIDATED', 'UNASSIGNED', 'ASSIGNED', 'IN_READING', 'FINAL', 'AMENDED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "Modality" AS ENUM ('CT', 'MRI', 'XR', 'US', 'NM', 'PET', 'MG', 'DX', 'CR', 'Fluoro');

-- CreateEnum
CREATE TYPE "Subspecialty" AS ENUM ('NEURO', 'MSK', 'CHEST', 'ABDOMEN', 'CARDIOVASCULAR', 'MAMMOGRAPHY', 'MUSCULOSKELETAL', 'GENERAL', 'PEDIATRIC', 'ONCOLOGY', 'INTERVENTIONAL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'PENDING_SIGNOFF', 'FINAL', 'AMENDED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'STUDY_VIEWED', 'STUDY_DOWNLOADED', 'STUDY_ASSIGNED', 'STUDY_STATUS_CHANGED', 'REPORT_VIEWED', 'REPORT_CREATED', 'REPORT_EDITED', 'REPORT_SIGNED', 'REPORT_AMENDED', 'REPORT_FINALIZED', 'CRITICAL_FINDING_FLAGGED', 'CRITICAL_FINDING_ACKNOWLEDGED', 'USER_CREATED', 'USER_UPDATED', 'ROUTING_RULE_CHANGED', 'DELIVERY_ATTEMPTED', 'DELIVERY_FAILED', 'DELIVERY_COMPLETED');

-- CreateEnum
CREATE TYPE "AuditResource" AS ENUM ('STUDY', 'REPORT', 'USER', 'ROUTING_RULE', 'HOSPITAL', 'WORKLIST', 'DELIVERY', 'AI_JOB', 'AUTH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "AIJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AITaskType" AS ENUM ('ANATOMY_DETECTION', 'PATHOLOGY_SCREENING', 'MEASUREMENT', 'COMPARISON');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "hospitalId" TEXT,
    "subspecialty" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hospital" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "hospitalId" TEXT NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Study" (
    "id" TEXT NOT NULL,
    "studyInstanceUid" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "studyDate" TIMESTAMP(3) NOT NULL,
    "studyTime" TEXT NOT NULL DEFAULT '',
    "modality" "Modality" NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "referringPhysician" TEXT NOT NULL DEFAULT '',
    "studyDescription" TEXT NOT NULL DEFAULT '',
    "priority" "StudyPriority" NOT NULL DEFAULT 'ROUTINE',
    "status" "StudyStatus" NOT NULL DEFAULT 'NEW',
    "subspecialty" "Subspecialty" NOT NULL DEFAULT 'GENERAL',
    "assignedRadiologistId" TEXT,
    "seriesCount" INTEGER NOT NULL DEFAULT 0,
    "instanceCount" INTEGER NOT NULL DEFAULT 0,
    "slaDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Study_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "seriesInstanceUid" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "modality" "Modality" NOT NULL,
    "seriesNumber" INTEGER NOT NULL,
    "seriesDescription" TEXT NOT NULL DEFAULT '',
    "instanceCount" INTEGER NOT NULL DEFAULT 0,
    "bodyPart" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instance" (
    "id" TEXT NOT NULL,
    "sopInstanceUid" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "instanceNumber" INTEGER NOT NULL,
    "sopClassUid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorklistItem" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "tatMinutes" INTEGER,
    "slaRemaining" INTEGER,

    CONSTRAINT "WorklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "findings" TEXT NOT NULL DEFAULT '',
    "impression" TEXT NOT NULL DEFAULT '',
    "criticalFinding" BOOLEAN NOT NULL DEFAULT false,
    "criticalFindingAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "criticalFindingAcknowledgedBy" TEXT,
    "criticalFindingAcknowledgedAt" TIMESTAMP(3),
    "signedOffBy" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportVersion" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL,
    "findings" TEXT NOT NULL,
    "impression" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "resource" "AuditResource" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "deliveredAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIJob" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "seriesId" TEXT,
    "sopInstanceId" TEXT,
    "taskType" "AITaskType" NOT NULL,
    "status" "AIJobStatus" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_code_key" ON "Hospital"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_patientId_key" ON "Patient"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Study_studyInstanceUid_key" ON "Study"("studyInstanceUid");

-- CreateIndex
CREATE UNIQUE INDEX "Study_accessionNumber_key" ON "Study"("accessionNumber");

-- CreateIndex
CREATE INDEX "Study_status_idx" ON "Study"("status");

-- CreateIndex
CREATE INDEX "Study_hospitalId_idx" ON "Study"("hospitalId");

-- CreateIndex
CREATE INDEX "Study_assignedRadiologistId_idx" ON "Study"("assignedRadiologistId");

-- CreateIndex
CREATE INDEX "Study_priority_idx" ON "Study"("priority");

-- CreateIndex
CREATE INDEX "Study_studyDate_idx" ON "Study"("studyDate");

-- CreateIndex
CREATE UNIQUE INDEX "Series_seriesInstanceUid_key" ON "Series"("seriesInstanceUid");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_sopInstanceUid_key" ON "Instance"("sopInstanceUid");

-- CreateIndex
CREATE UNIQUE INDEX "WorklistItem_studyId_key" ON "WorklistItem"("studyId");

-- CreateIndex
CREATE INDEX "Report_studyId_idx" ON "Report"("studyId");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "AuditLog"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "AIJob_status_idx" ON "AIJob"("status");

-- CreateIndex
CREATE INDEX "AIJob_studyId_idx" ON "AIJob"("studyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Study" ADD CONSTRAINT "Study_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Study" ADD CONSTRAINT "Study_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Study" ADD CONSTRAINT "Study_assignedRadiologistId_fkey" FOREIGN KEY ("assignedRadiologistId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Series" ADD CONSTRAINT "Series_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorklistItem" ADD CONSTRAINT "WorklistItem_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_sopInstanceId_fkey" FOREIGN KEY ("sopInstanceId") REFERENCES "Instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
