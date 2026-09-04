-- AlterTable
ALTER TABLE "Study" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "orthancPatientId" TEXT,
ADD COLUMN     "orthancStudyId" TEXT,
ADD COLUMN     "uploadedFileName" TEXT;

-- CreateIndex
CREATE INDEX "Study_orthancStudyId_idx" ON "Study"("orthancStudyId");
