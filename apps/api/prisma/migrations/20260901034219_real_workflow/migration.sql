-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StudyStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "StudyStatus" ADD VALUE 'DRAFT_REPORT';
ALTER TYPE "StudyStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "recommendations" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Study" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedBy" TEXT,
ADD COLUMN     "clinicalHistory" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "reportingStartedAt" TIMESTAMP(3);
