-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'STUDY_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'DICOM_IMPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'DICOM_IMPORT_FAILED';

-- AlterTable
ALTER TABLE "Instance" ADD COLUMN     "orthancInstanceId" TEXT;

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "orthancSeriesId" TEXT;

-- CreateIndex
CREATE INDEX "Instance_orthancInstanceId_idx" ON "Instance"("orthancInstanceId");

-- CreateIndex
CREATE INDEX "Series_orthancSeriesId_idx" ON "Series"("orthancSeriesId");
