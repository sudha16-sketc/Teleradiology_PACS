-- Rich report body support (nullable for existing structured reports).
ALTER TABLE "Report" ADD COLUMN "contentHtml" TEXT;
ALTER TABLE "ReportVersion" ADD COLUMN "contentHtml" TEXT;
ALTER TABLE "ReportTemplate" ADD COLUMN "contentHtml" TEXT NOT NULL DEFAULT '';

-- Report images: binary files are stored outside PostgreSQL. Only metadata is
-- persisted so large base64 payloads never enter the database.
CREATE TABLE "ReportImage" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportImage_storageKey_key" ON "ReportImage"("storageKey");
CREATE INDEX "ReportImage_reportId_idx" ON "ReportImage"("reportId");
CREATE INDEX "ReportImage_studyId_idx" ON "ReportImage"("studyId");
CREATE INDEX "ReportImage_uploadedById_idx" ON "ReportImage"("uploadedById");

ALTER TABLE "ReportImage" ADD CONSTRAINT "ReportImage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportImage" ADD CONSTRAINT "ReportImage_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportImage" ADD CONSTRAINT "ReportImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Configurable organization profile for report footers (singleton row).
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "disclaimer" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);
