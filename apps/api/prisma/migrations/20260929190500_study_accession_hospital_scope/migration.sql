-- Scope Study.accessionNumber to the ordering hospital.
--
-- The column previously carried a global UNIQUE constraint, so two unrelated
-- tenants that happened to share an accession number (e.g. "ACC-0001") collided
-- on insert. The unique violation was unhandled and surfaced as a 500 instead of
-- a client error. Uniqueness is a per-hospital ordering invariant, so it is
-- enforced as a composite key instead.
--
-- Safety: the old global index cannot be dropped if any accession value is still
-- duplicated across hospitals in the deployed database. The DO block below turns
-- such a case into a clear, actionable error rather than a mid-migration failure
-- that leaves the schema inconsistent.
DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg("accessionNumber", ', ' ORDER BY "accessionNumber")
  INTO dupes
  FROM (
    SELECT "accessionNumber"
    FROM "Study"
    GROUP BY "accessionNumber"
    HAVING COUNT(*) > 1
  ) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot scope Study.accessionNumber per hospital: cross-hospital duplicates exist (%). Resolve these before applying this migration.',
      dupes;
  END IF;
END $$;

DROP INDEX IF EXISTS "Study_accessionNumber_key";

CREATE UNIQUE INDEX "Study_hospitalId_accessionNumber_key"
  ON "Study"("hospitalId", "accessionNumber");
