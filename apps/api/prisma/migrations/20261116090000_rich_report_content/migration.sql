ALTER TABLE "Report"
ADD COLUMN "richContent" JSONB;

ALTER TABLE "ReportVersion"
ADD COLUMN "richContent" JSONB;
