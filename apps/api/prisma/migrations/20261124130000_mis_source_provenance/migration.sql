ALTER TABLE "Study"
ADD COLUMN "studyDateProvided" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Study"
ADD COLUMN "sourceModality" TEXT;
