ALTER TABLE "Study"
ADD COLUMN "patientAge" INTEGER;

CREATE TABLE "StudyHistoryAttachment" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyHistoryAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyHistoryAttachment_studyId_key"
ON "StudyHistoryAttachment"("studyId");

CREATE UNIQUE INDEX "StudyHistoryAttachment_storageKey_key"
ON "StudyHistoryAttachment"("storageKey");

CREATE INDEX "StudyHistoryAttachment_uploadedById_idx"
ON "StudyHistoryAttachment"("uploadedById");

ALTER TABLE "StudyHistoryAttachment"
ADD CONSTRAINT "StudyHistoryAttachment_studyId_fkey"
FOREIGN KEY ("studyId") REFERENCES "Study"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyHistoryAttachment"
ADD CONSTRAINT "StudyHistoryAttachment_uploadedById_fkey"
FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
