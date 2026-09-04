-- Phase 1: Role migration & workflow state machine
-- Migrates UserRole, StudyStatus, ReportStatus, ChangeRequestStatus enum values
-- and adds workflow timestamps + Assignment model.

-- ===================== UserRole =====================
-- old: ADMIN, COORDINATOR, RADIOLOGIST, TECHNICIAN, HOSPITAL_USER
-- new: ADMIN, MANAGER, RADIOLOGIST, HOSPITAL
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "requestedRole" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE "role"::text
      WHEN 'COORDINATOR' THEN 'MANAGER'::text
      WHEN 'HOSPITAL_USER' THEN 'HOSPITAL'::text
      WHEN 'TECHNICIAN' THEN 'HOSPITAL'::text
      WHEN 'ADMIN' THEN 'ADMIN'::text
      WHEN 'RADIOLOGIST' THEN 'RADIOLOGIST'::text
      ELSE 'HOSPITAL'::text
    END
  )::"UserRole_new";
ALTER TABLE "User" ALTER COLUMN "requestedRole" TYPE "UserRole_new"
  USING (
    CASE "requestedRole"::text
      WHEN 'COORDINATOR' THEN 'MANAGER'::text
      WHEN 'HOSPITAL_USER' THEN 'HOSPITAL'::text
      WHEN 'TECHNICIAN' THEN 'HOSPITAL'::text
      WHEN 'ADMIN' THEN 'ADMIN'::text
      WHEN 'RADIOLOGIST' THEN 'RADIOLOGIST'::text
      ELSE 'HOSPITAL'::text
    END
  )::"UserRole_new";
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
COMMIT;

-- ===================== StudyStatus =====================
-- old: NEW, VALIDATED, UNASSIGNED, ASSIGNED, IN_READING, FINAL, AMENDED,
--      DELIVERED, SUBMITTED, DRAFT_REPORT, UNDER_VERIFICATION,
--      CHANGE_REQUESTED, REPORT_REVISED, RELEASED, CANCELLED
-- new: HOSPITAL_SUBMITTED, RECEIVING, VALIDATING, UNASSIGNED, ASSIGNED,
--      IN_READING, REPORT_DRAFT, RADIOLOGIST_SIGNED, MANAGER_REVIEW,
--      MANAGER_APPROVED, DELIVERED_TO_HOSPITAL, HOSPITAL_REVIEW,
--      HOSPITAL_ACCEPTED, COMPLETED, CORRECTION_REQUESTED,
--      HOSPITAL_CHANGE_REQUESTED, CANCELLED
BEGIN;
CREATE TYPE "StudyStatus_new" AS ENUM ('HOSPITAL_SUBMITTED','RECEIVING','VALIDATING','UNASSIGNED','ASSIGNED','IN_READING','REPORT_DRAFT','RADIOLOGIST_SIGNED','MANAGER_REVIEW','MANAGER_APPROVED','DELIVERED_TO_HOSPITAL','HOSPITAL_REVIEW','HOSPITAL_ACCEPTED','COMPLETED','CORRECTION_REQUESTED','HOSPITAL_CHANGE_REQUESTED','CANCELLED');
ALTER TABLE "Study" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Study" ALTER COLUMN "status" TYPE "StudyStatus_new"
  USING (
    CASE "status"::text
      WHEN 'NEW' THEN 'HOSPITAL_SUBMITTED'
      WHEN 'SUBMITTED' THEN 'HOSPITAL_SUBMITTED'
      WHEN 'VALIDATED' THEN 'VALIDATING'
      WHEN 'DRAFT_REPORT' THEN 'REPORT_DRAFT'
      WHEN 'REPORT_REVISED' THEN 'REPORT_DRAFT'
      WHEN 'FINAL' THEN 'RADIOLOGIST_SIGNED'
      WHEN 'UNDER_VERIFICATION' THEN 'MANAGER_REVIEW'
      WHEN 'RELEASED' THEN 'MANAGER_APPROVED'
      WHEN 'DELIVERED' THEN 'DELIVERED_TO_HOSPITAL'
      WHEN 'CHANGE_REQUESTED' THEN 'CORRECTION_REQUESTED'
      WHEN 'AMENDED' THEN 'IN_READING'
      WHEN 'UNASSIGNED' THEN 'UNASSIGNED'
      WHEN 'ASSIGNED' THEN 'ASSIGNED'
      WHEN 'IN_READING' THEN 'IN_READING'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      ELSE 'HOSPITAL_SUBMITTED'
    END
  )::"StudyStatus_new";
ALTER TYPE "StudyStatus" RENAME TO "StudyStatus_old";
ALTER TYPE "StudyStatus_new" RENAME TO "StudyStatus";
DROP TYPE "StudyStatus_old";
ALTER TABLE "Study" ALTER COLUMN "status" SET DEFAULT 'HOSPITAL_SUBMITTED';
COMMIT;

-- ===================== ReportStatus =====================
-- old: DRAFT, PENDING_SIGNOFF, FINAL, AMENDED, UNDER_VERIFICATION,
--      CHANGE_REQUESTED, RELEASED
-- new: DRAFT, SIGNED, MANAGER_REVIEW, MANAGER_APPROVED, HOSPITAL_REVIEW,
--      CORRECTION_REQUESTED
BEGIN;
CREATE TYPE "ReportStatus_new" AS ENUM ('DRAFT','SIGNED','MANAGER_REVIEW','MANAGER_APPROVED','HOSPITAL_REVIEW','CORRECTION_REQUESTED');
ALTER TABLE "Report" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Report" ALTER COLUMN "status" TYPE "ReportStatus_new"
  USING (
    CASE "status"::text
      WHEN 'DRAFT' THEN 'DRAFT'
      WHEN 'PENDING_SIGNOFF' THEN 'SIGNED'
      WHEN 'FINAL' THEN 'SIGNED'
      WHEN 'AMENDED' THEN 'SIGNED'
      WHEN 'UNDER_VERIFICATION' THEN 'MANAGER_REVIEW'
      WHEN 'CHANGE_REQUESTED' THEN 'CORRECTION_REQUESTED'
      WHEN 'RELEASED' THEN 'MANAGER_APPROVED'
      ELSE 'DRAFT'
    END
  )::"ReportStatus_new";
ALTER TABLE "ReportVersion" ALTER COLUMN "status" TYPE "ReportStatus_new"
  USING (
    CASE "status"::text
      WHEN 'DRAFT' THEN 'DRAFT'
      WHEN 'PENDING_SIGNOFF' THEN 'SIGNED'
      WHEN 'FINAL' THEN 'SIGNED'
      WHEN 'AMENDED' THEN 'SIGNED'
      WHEN 'UNDER_VERIFICATION' THEN 'MANAGER_REVIEW'
      WHEN 'CHANGE_REQUESTED' THEN 'CORRECTION_REQUESTED'
      WHEN 'RELEASED' THEN 'MANAGER_APPROVED'
      ELSE 'DRAFT'
    END
  )::"ReportStatus_new";
ALTER TYPE "ReportStatus" RENAME TO "ReportStatus_old";
ALTER TYPE "ReportStatus_new" RENAME TO "ReportStatus";
DROP TYPE "ReportStatus_old";
ALTER TABLE "Report" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- ===================== ChangeRequestStatus =====================
-- old: PENDING, REJECTED, RESOLVED
-- new: OPEN, ACKNOWLEDGED, IN_PROGRESS, RESOLVED, REJECTED, CANCELLED
BEGIN;
CREATE TYPE "ChangeRequestStatus_new" AS ENUM ('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','REJECTED','CANCELLED');
ALTER TABLE "ChangeRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ChangeRequest" ALTER COLUMN "status" TYPE "ChangeRequestStatus_new"
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN 'OPEN'
      WHEN 'REJECTED' THEN 'REJECTED'
      WHEN 'RESOLVED' THEN 'RESOLVED'
      ELSE 'OPEN'
    END
  )::"ChangeRequestStatus_new";
ALTER TYPE "ChangeRequestStatus" RENAME TO "ChangeRequestStatus_old";
ALTER TYPE "ChangeRequestStatus_new" RENAME TO "ChangeRequestStatus";
DROP TYPE "ChangeRequestStatus_old";
ALTER TABLE "ChangeRequest" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- ===================== AuditAction / AuditResource =====================
ALTER TYPE "AuditAction" ADD VALUE 'HOSPITAL_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'HOSPITAL_CHANGE_REQUESTED';
ALTER TYPE "AuditResource" ADD VALUE 'ASSIGNMENT';

-- ===================== Study columns =====================
ALTER TABLE "Study" DROP COLUMN "finalizedAt",
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "hospitalAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "hospitalReviewedAt" TIMESTAMP(3),
  ADD COLUMN "managerApprovedAt" TIMESTAMP(3),
  ADD COLUMN "managerReviewedAt" TIMESTAMP(3),
  ADD COLUMN "signedOffAt" TIMESTAMP(3);

-- ===================== ChangeRequest comment =====================
ALTER TABLE "ChangeRequest" ADD COLUMN "comment" TEXT NOT NULL DEFAULT '';

-- ===================== Assignment model =====================
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "radiologistId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Assignment_studyId_idx" ON "Assignment"("studyId");
CREATE INDEX "Assignment_radiologistId_idx" ON "Assignment"("radiologistId");
CREATE INDEX "Assignment_isActive_idx" ON "Assignment"("isActive");

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_radiologistId_fkey" FOREIGN KEY ("radiologistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
