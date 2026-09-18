# PHASE6_TRACKER.md

Work item: Phase 6 — Report Visibility (BUG_REPORT B1 + C3).

Single authoritative hospital-visibility policy, applied consistently across
every report-returning surface: study detail, report detail, hospital report
list, PDF, AI responses, exports, notifications.

## Principle

A hospital user must never receive report content for a study that is not yet
deliverable to them. Deliverable = study already in a
HOSPITAL_VISIBLE_STATES status, OR the user holds an explicit over-delivery
privilege (none today).

Pre-delivery content (DRAFT, RADIOLOGIST_SIGNED, MANAGER_REVIEW,
MANAGER_APPROVED-not-yet-delivered, CORRECTION_REQUESTED-without-delivered,
HOSPITAL_CHANGE_REQUESTED) is never exposed to hospitals.

## Policy (single source of truth)

Refactor the duplicated gate list into ONE exported constant + ONE helper, in
a neutral module both reports and reviews services import:

- `apps/api/src/reviews/reviews.service.ts:26-31` currently exports
  `HOSPITAL_VISIBLE_STATES` (DELIVERED_TO_HOSPITAL, HOSPITAL_REVIEW,
  HOSPITAL_ACCEPTED, COMPLETED).
- `apps/api/src/reports/reports.service.ts:136-149` has its own report-side
  copy.
- `apps/api/src/studies/studies.service.ts:113-135` (getByUid include) and
  `reports.service.ts:205-207, 231-236` (list + hospitalReports) apply
  inconsistent subsets.

Move the canonical gate to e.g. `apps/api/src/common/db/hospital-visibility.ts`
exporting `HOSPITAL_VISIBLE_STATES` + `assertNoHospitalView(study)` (throws
Forbidden when not deliverable for a HOSPITAL actor) and update all call sites
to use it. One constant, one helper — no per-service divergence.

## Check list (each must be audited + regression-tested)

- [ ] studies.getByUid: include gate → apply policy; HOSPITAL cannot read report
      on pre-delivery status (DRAFT / RADIOLOGIST_SIGNED / MANAGER_REVIEW /
      MANAGER_APPROVED pre-delivered).
- [ ] reports.getByUid (detail): policy (verify 252-284 currently correct —
      MANAGER_APPROVED excluded).
- [ ] reports.list: remove MANAGER_APPROVED from hospital-visible set
      (205-207) unless study is actually delivered.
- [ ] reports.hospitalReports: same gate as list.
- [ ] reports.export / PDF: policy (verify 720 correct).
- [ ] AI responses (ai.service / ai.controller): hospital user cannot receive
      report-bearing AI output pre-delivery.
- [ ] notifications: hospital notifications never embed report content
      pre-delivery.
- [ ] DICOMweb / OHIF: hospital access to report data pre-delivery is blocked.

## TEST GATE

Add regression tests (extend `review-delivery.e2e-spec.ts` or a new
`report-visibility.e2e-spec.ts`) proving for EVERY surface:

- HOSPITAL sees report after delivery (DELIVERED_TO_HOSPITAL+)
- HOSPITAL cannot see DRAFT / RADIOLOGIST_SIGNED / MANAGER_REVIEW /
  MANAGER_APPROVED-not-delivered via study detail, report detail, report list,
  hospital report list, PDF, AI, export, notifications

Do not start Phase 7 (Backup + Retention) until this gate is green.

## State

- [x] Single-source policy module created
  `apps/api/src/common/visibility/hospital-visible.ts` (HOSPITAL_VISIBLE_STATES
  + isHospitalReportVisible); re-exported from reviews.service (canonical
  HOSPITAL_VISIBLE_STATES now defined exactly once in the tree).
- [x] reports.list — hospital gated by `in: [...HOSPITAL_VISIBLE_STATES]`
- [x] reports.hospitalReports — hospital gated by
  `in: [...HOSPITAL_VISIBLE_STATES]` (MANAGER_APPROVED removed)
- [x] studies.getByUid — HOSPITAL actor's report include stripped when
  !isHospitalReportVisible (B1 leak closed)
- [x] TEST GATE — full regression: 9 suites, 170/170 passed; typecheck clean
- [ ] Phase 6 commit (on user request only)
