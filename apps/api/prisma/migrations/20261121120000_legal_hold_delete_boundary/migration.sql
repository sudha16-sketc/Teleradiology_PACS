ALTER TABLE "RetentionArchive"
  ADD COLUMN IF NOT EXISTS "orthancDeleteDispatchedAt" TIMESTAMP(3);
