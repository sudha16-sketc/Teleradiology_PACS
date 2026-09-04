# Phase 5 — Review & Hospital Delivery

This document describes the Phase 5 review/delivery lifecycle implemented in the
Axis Teleradiology PACS: the `RADIOLOGIST_SIGNED → MANAGER_REVIEW →
MANAGER_APPROVED → DELIVERED_TO_HOSPITAL → HOSPITAL_REVIEW →
HOSPITAL_ACCEPTED → COMPLETED` workflow, with strict server-side authorization,
hospital tenant isolation, immutable signed reports, transactional + audited
transitions, and no bypass via the generic status endpoint.

Phase 5 implementation only. Correction requests, amendments after sign-off,
backup/retention, archive, analytics, AI, and new auth are out of scope and
belong to Phase 6 or later.

## Design overview

Backend state transitions are centralized in a single source of truth:
`ReviewsService` (`apps/api/src/reviews/reviews.service.ts`), exposed through
`ReviewsController` (`apps/api/src/reviews/reviews.controller.ts`). The legacy
`reports.service.ts` `verify` / `release` / `deliver` methods now **delegate** to
`ReviewsService` (no duplicated logic), and `ReportsModule` imports
`ReviewsModule`. `ReviewsModule` is wired into `app.module.ts`.

Each transition is **transactional**: a single `prisma.$transaction` performs an
in-transaction re-read of the study, validates the exact current status (a
`409` on wrong predecessor / stale / double action), writes the study mutation,
writes an operation-specific audit row (`AuditService.createTx`) and (for
delivery) a `DeliveryAttempt`. All mutations commit or roll back atomically.

## State machine & roles

| Action | Endpoint | Role | Predecessor (must be) | Writes |
| --- | --- | --- | --- | --- |
| Review | `POST /studies/:uid/review` | ADMIN/MANAGER | `RADIOLOGIST_SIGNED` | `managerReviewedAt` |
| Approve | `POST /studies/:uid/approve` | ADMIN/MANAGER | `MANAGER_REVIEW` | `managerApprovedAt` |
| Deliver | `POST /studies/:uid/deliver` | ADMIN/MANAGER | `MANAGER_APPROVED` | `deliveredAt` + `DeliveryAttempt` |
| Hospital review | `POST /studies/:uid/hospital-review` | HOSPITAL (own) | `DELIVERED_TO_HOSPITAL` | `hospitalReviewedAt` |
| Accept | `POST /studies/:uid/accept` | HOSPITAL (own) | `HOSPITAL_REVIEW` | `hospitalAcceptedAt` |
| Complete | `POST /studies/:uid/complete` | ADMIN/MANAGER | `HOSPITAL_ACCEPTED` | `completedAt` |

All review transitions require the study to have a **signed report** plus (where
applicable) `study.hospitalId`, `managerApprovedAt`+`deliveredAt`, or
`hospitalAcceptedAt` set.

## No bypass via the generic status endpoint

`StudiesService.updateStatus` (`apps/api/src/studies/studies.service.ts`) is
hardened as defense-in-depth:

- Sensitive transitions (`MANAGER_REVIEW`, `MANAGER_APPROVED`,
  `DELIVERED_TO_HOSPITAL`, `HOSPITAL_REVIEW`, `HOSPITAL_ACCEPTED`, `COMPLETED`)
  require a signed report (`requiresSignedReport`).
- `DELIVERED_TO_HOSPITAL` requires `study.hospitalId`.
- `HOSPITAL_ACCEPTED` requires `managerApprovedAt` + `deliveredAt`.
- `COMPLETED` requires `hospitalAcceptedAt`.

A generic `PATCH /studies/:uid/status` cannot jump the state machine or let a
hospital arbitrarily complete a study.

## Report visibility for hospitals

Report reads (`getByStudy` / `getVersions`) are gated by
`assertHospitalReportVisibility` in `apps/api/src/reports/reports.service.ts`.
A `HOSPITAL` user may only read a report once the study is in
`HOSPITAL_VISIBLE_STATES = [DELIVERED_TO_HOSPITAL, HOSPITAL_REVIEW,
HOSPITAL_ACCEPTED, COMPLETED]`. Before delivery the hospital receives `403`.
This intentionally tightens the Phase‑4 `REPORT-16d` expectation.

## Tenant isolation

Hospital-scoped actions (`hospital-review`, `accept`) verify
`study.hospitalId === actor.hospitalId`; the destination hospital for delivery
always comes from `study.hospitalId`, never from the request body. A hospital
acting on another hospital's study receives `403`.

## Audit

Every transition emits a `STUDY_STATUS_CHANGED` audit row plus an
operation-specific row (`DELIVERY_COMPLETED`, `HOSPITAL_ACCEPTED`, …) via
`AuditService.createTx`, so the audit rows commit atomically with the mutation.
`packages/types` `AuditAction` added `HOSPITAL_ACCEPTED` and
`HOSPITAL_CHANGE_REQUESTED` (already present in the Prisma enum). After editing
`packages/types`, run `pnpm --filter @axis/types build` so the `dist` used by
`apps/api`/`apps/web` reflects the change.

## Worklist

`worklist.service.ts` `my(userId, role, hospitalId)` now has a `HOSPITAL` branch
(own hospital's studies in `DELIVERED_TO_HOSPITAL` / `HOSPITAL_REVIEW` /
`HOSPITAL_ACCEPTED` / `COMPLETED`). The manager/ADMIN branch includes the
`RADIOLOGIST_SIGNED` / `MANAGER_REVIEW` / `MANAGER_APPROVED` review and delivery
queues. `worklist.controller.ts` `GET /worklist/my` allows the `HOSPITAL` role
and passes `user.hospitalId`.

## Frontend

- **Manager review/delivery**: the worklist surfaces the manager review and
  delivery queues (managers now see `RADIOLOGIST_SIGNED`, `MANAGER_REVIEW`,
  `MANAGER_APPROVED` studies). Opening a study navigates to `/reading/[uid]`,
  where managers/admin see a read-only signed `ReportPanel` +
  `CriticalFindingBanner` + `ReviewActions`. `ReviewActions.tsx` calls
  `POST /studies/:uid/review | approve | deliver` with exact-status gating
  (`canReview` = `RADIOLOGIST_SIGNED`, `canApprove` = `MANAGER_REVIEW`,
  `canDeliver` = `MANAGER_APPROVED`).
- **Hospital review/accept**: new read-only report detail page
  `/hospitals/reports/[studyUid]` renders the delivered report with
  `Mark as Reviewed` (calls `hospital-review`) and `Accept Report` (calls
  `accept`), shown only in `HOSPITAL_REVIEW`. The `/hospitals/reports` list adds
  a `Review` link and an inline `Accept` button.
- **Worklist assign button**: the `Assign` action now renders only for
  assignable states (`HOSPITAL_SUBMITTED`, `RECEIVING`, `VALIDATING`,
  `UNASSIGNED`, `ASSIGNED`); review/delivery‑queue rows no longer show a
  misleading reassign control.

## Tests

`apps/api/test/review-delivery.e2e-spec.ts` covers `REVIEW-1..7`, `DELIVERY-1..4`,
`HOSPITAL-1..7`, `COMPLETE-1..2`, `WORKFLOW-1..5`, `AUTHZ-1..3`, `AUDIT-1`,
`REGRESSION-1`:

- Happy-path review → approve → deliver → hospital-review → accept → complete
- Estate/prerequisite validation (`400`/`409`) for wrong predecessor/stale/double
- Tenant isolation (a different hospital is `403`)
- Authorization (`403` for unprivileged roles on each action)
- Generic `PATCH` cannot bypass the state machine
- Hospital report visibility (`403` pre-delivery, `200` post-delivery)
- Audit rows for each transition (atomic via `createTx`)
- Regression on the phases 1–4 reporting flow

Run: `cd apps/api && pnpm exec jest --runInBand`

Full suite: **121 tests across 6 suites** (Phases 1–5), all passing. Typecheck
(`pnpm -r typecheck`), `apps/api` `nest build`, and `apps/web` production build
all pass; the production frontend cleanly compiles with no mock/hardcoded data.
