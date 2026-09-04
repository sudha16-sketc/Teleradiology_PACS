-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "clinicalHistory" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "comparison" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "technique" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ReportVersion" ADD COLUMN     "clinicalHistory" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "comparison" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "technique" TEXT NOT NULL DEFAULT '';
