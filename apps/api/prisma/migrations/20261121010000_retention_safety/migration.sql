ALTER TABLE "RetentionArchive"
  ADD COLUMN "dicomObjectOwned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contentVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "claimUntil" TIMESTAMP(3),
  ADD COLUMN "cleanupClaimUntil" TIMESTAMP(3),
  ADD COLUMN "cleanupFinalized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "uploadedArtifacts" JSONB;

ALTER TABLE "RetentionNotification"
  ADD COLUMN "ignoredCounted" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "OriginalDataDeletionStatus" ADD VALUE IF NOT EXISTS 'FINALIZING';
