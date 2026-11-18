-- Prevent duplicate report rows for the same study + version.
--
-- The only duplicate shape removed automatically is an empty, unversioned DRAFT
-- with no dependent records. Any other duplicate aborts the migration so the
-- clinical data can be reviewed and resolved manually before retrying.

WITH ranked AS (
    SELECT
        r.id,
        ROW_NUMBER() OVER (
            PARTITION BY r."studyId", r.version
            ORDER BY
                (SELECT COUNT(*) FROM "ReportVersion" v WHERE v."reportId" = r.id) DESC,
                (r."signedOffAt" IS NOT NULL) DESC,
                r."updatedAt" DESC,
                r."createdAt" DESC
        ) AS rn
    FROM "Report" r
)
DELETE FROM "Report" r
USING ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1
  AND r.status = 'DRAFT'
  AND r."signedOffAt" IS NULL
  AND r.findings = ''
  AND r.impression = ''
  AND r."clinicalHistory" = ''
  AND r.technique = ''
  AND r.comparison = ''
  AND r.recommendations = ''
  AND NOT EXISTS (SELECT 1 FROM "ReportVersion" v WHERE v."reportId" = r.id)
  AND NOT EXISTS (SELECT 1 FROM "ChangeRequest" c WHERE c."reportId" = r.id)
  AND NOT EXISTS (SELECT 1 FROM "DeliveryAttempt" d WHERE d."reportId" = r.id);

-- If any non-empty duplicate remains, the unique index below fails and the
-- migration aborts for manual review.
CREATE UNIQUE INDEX IF NOT EXISTS "Report_studyId_version_key" ON "Report"("studyId", version);
