-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'REJECTED', 'RESOLVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'STUDY_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'STUDY_VALIDATED';
ALTER TYPE "AuditAction" ADD VALUE 'STUDY_REASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_REVISED';
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_RELEASED';
ALTER TYPE "AuditAction" ADD VALUE 'CHANGE_REQUESTED';

-- AlterEnum
ALTER TYPE "AuditResource" ADD VALUE 'CHANGE_REQUEST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportStatus" ADD VALUE 'UNDER_VERIFICATION';
ALTER TYPE "ReportStatus" ADD VALUE 'CHANGE_REQUESTED';
ALTER TYPE "ReportStatus" ADD VALUE 'RELEASED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StudyStatus" ADD VALUE 'UNDER_VERIFICATION';
ALTER TYPE "StudyStatus" ADD VALUE 'CHANGE_REQUESTED';
ALTER TYPE "StudyStatus" ADD VALUE 'REPORT_REVISED';
ALTER TYPE "StudyStatus" ADD VALUE 'RELEASED';

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeRequest_studyId_idx" ON "ChangeRequest"("studyId");

-- CreateIndex
CREATE INDEX "ChangeRequest_reportId_idx" ON "ChangeRequest"("reportId");

-- CreateIndex
CREATE INDEX "ChangeRequest_assignedToId_idx" ON "ChangeRequest"("assignedToId");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_idx" ON "ChangeRequest"("status");

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
