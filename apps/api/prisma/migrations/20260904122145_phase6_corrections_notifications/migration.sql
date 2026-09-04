-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CORRECTION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'CORRECTION_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'CORRECTION_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'CORRECTION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'CORRECTED_REPORT_SIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'CORRECTION_RESOLVED';

-- AlterEnum
ALTER TYPE "ChangeRequestStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "ChangeRequest" ADD COLUMN     "newReportVersionId" TEXT,
ADD COLUMN     "parentReportVersionId" TEXT,
ADD COLUMN     "requestedByRole" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "sourceStatus" "StudyStatus";

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "studyId" TEXT,
    "correctionRequestId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_idx" ON "Notification"("recipientUserId");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE INDEX "Notification_studyId_idx" ON "Notification"("studyId");

-- CreateIndex
CREATE INDEX "ChangeRequest_parentReportVersionId_idx" ON "ChangeRequest"("parentReportVersionId");

-- CreateIndex
CREATE INDEX "ChangeRequest_newReportVersionId_idx" ON "ChangeRequest"("newReportVersionId");

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_parentReportVersionId_fkey" FOREIGN KEY ("parentReportVersionId") REFERENCES "ReportVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_newReportVersionId_fkey" FOREIGN KEY ("newReportVersionId") REFERENCES "ReportVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
