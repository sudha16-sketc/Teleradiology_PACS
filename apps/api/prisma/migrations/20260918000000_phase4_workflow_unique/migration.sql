-- Phase 4: workflow state machine + locking.
--
-- Enforce report/version integrity at the database level so concurrent
-- workflow operations can never create duplicate entries:
--   * one report row per (studyId, version) — blocks concurrent amend /
--     correction begin() from creating two rows with the same version number
--   * one immutable ReportVersion snapshot per (reportId, version) — blocks
--     concurrent signOff() from double-signing the same report version
CREATE UNIQUE INDEX "Report_studyId_version_key" ON "Report"("studyId", "version");
CREATE UNIQUE INDEX "ReportVersion_reportId_version_key" ON "ReportVersion"("reportId", "version");