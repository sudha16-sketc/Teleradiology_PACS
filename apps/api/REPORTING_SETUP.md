# Phase 4 — Radiology Reporting

This document describes the Phase 4 reporting lifecycle implemented in the Axis
Teleradiology PACS: draft creation/editing/autosave, transactional signing with
a double-sign guard, server-side content hashing, immutable versioning, workflow
integration, authorization, and audit tracking.

## Model

The existing `Report` model is reused without a new model architecture. A single
mutable `Report` row carries the draft through `DRAFT` → `SIGNED`, while every
signed snapshot is persisted immutably to `ReportVersion`.

### `Report` (mutable)
- `status` (`DRAFT` | `SIGNED`)
- `authorId` — assigned radiologist who authored it (server-derived, never client)
- `version`, `contentHash`
- Content fields: `clinicalHistory`, `findings`, `impression`, `technique`,
  `comparison`, `recommendations`, `criticalFinding`
- Signing metadata: `signedOffBy`, `signedOffAt`
- `contentHash` is a full 64-char **SHA-256** over all content fields, computed
  server-side only. A client-submitted hash is never trusted.

### `ReportVersion` (immutable)
Snapshot created at sign time, containing the same content fields plus the
server-side hash, author id, and timestamp. Versions are never mutated.

### Schema migration
`20260904104648_phase4_reporting_content_fields` added `clinicalHistory`,
`technique`, and `comparison` (TEXT, default `''`) to both `Report` and
`ReportVersion`. It was applied to the dev (`axis_pacs`) and test
(`axis_pacs_test`) databases.

## Authorization (server-derived, never client-trusted)

- `authorId` / `signedOffBy` are **never** accepted from the request body. The
  authenticated session (`@CurrentUser()`) is authoritative.
- Only the **assigned radiologist** (`study.assignedRadiologistId === actor.id`,
  role `RADIOLOGIST`) may save drafts or sign.
- All other roles (MANAGER, ADMIN, HOSPITAL, other radiologists) are rejected
  with `403` for draft/sign operations.
- Reads (`GET /reports/:uid/versions`, `GET /reports/:uid`) mirror the existing
  scope rules: manager/admin global, hospital scoped to own hospital, radiologist
  scoped to assigned studies.

## Workflow integration

- **Draft**: Creating the first draft advances the study through the workflow
  state machine (`StudiesService.updateStatus`) preserving transition rules and
  the `STUDY_STATUS_CHANGED` audit. From `ASSIGNED` the legal chain is
  `ASSIGNED → IN_READING → REPORT_DRAFT`; from `IN_READING` it is a single
  transition. Drafts can only be saved while the study is in `ASSIGNED`,
  `IN_READING`, or `REPORT_DRAFT`.
- **Idempotency**: `saveDraft` finds-or-creates a single active `DRAFT` report.
  Repeated saves update in place; no duplicate drafts.
- **Immutability**: Once a report is `SIGNED`, `saveDraft` throws `409` (Conflict).
- **Signing is transactional**: a single `prisma.$transaction` covers the report
  update to `SIGNED`, the `ReportVersion` snapshot, the study transition
  (`REPORT_DRAFT → RADIOLOGIST_SIGNED`, validated against
  `ALLOWED_TRANSITIONS`/`TRANSITION_ACTORS`), and the `REPORT_SIGNED` +
  `STUDY_STATUS_CHANGED` audit rows. The double-sign guard re-checks status
  inside the transaction, so only the first concurrent request wins.
- **Worklist**: `RADIOLOGIST_SIGNED` automatically removes the study from the
  radiologist's active drafting workload (the `my` worklist query includes
  `ASSIGNED`, `IN_READING`, `REPORT_DRAFT`, `CORRECTION_REQUESTED`).

## Signing validation

Signing requires:
- study assigned to the acting radiologist (else `403`),
- a `DRAFT` report exists (else `404`),
- `findings` and `impression` are non-empty (else `400`),
- a legal workflow transition to `RADIOLOGIST_SIGNED` (else `400`),
- not already signed (else `409`).

## API surface (relevant endpoints)

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| `PATCH` | `/reports/:studyUid/draft` | RADIOLOGIST (assigned) | Save/autosave draft |
| `POST` | `/reports/:studyUid` | RADIOLOGIST (assigned) | Alias for save draft |
| `POST` | `/reports/:studyUid/sign` | RADIOLOGIST (assigned) | Sign (transactional, double-sign guard) |
| `GET` | `/reports/:studyUid/versions` | RADIOLOGIST/MANAGER/ADMIN/HOSPITAL | Immutable version history |
| `GET` | `/reports/:studyUid` | RADIOLOGIST/MANAGER/ADMIN/HOSPITAL | Latest report |
| `GET` | `/reports` | RADIOLOGIST/MANAGER/ADMIN/HOSPITAL | Report list (scoped) |
| `POST` | `/reports/:studyUid/amend` | RADIOLOGIST (assigned) | New version (correction) |

## Frontend

- **Reading page** (`/reading/[studyUid]`) now embeds an inline report editor
  (`ReportPanel`) with all content fields, **autosave** (debounced 500 ms) with a
  save-state indicator (saving / saved-at / unsaved / error). Only the assigned
  radiologist can edit; a signed report renders read-only.
- **Version history** is fetched inline from `/reports/:uid/versions` and shown
  expandably with status, author, timestamp, and content hash.
- **Sign-off** (`SignOffControls`) now shows an **irreversibility confirmation
  dialog** before calling `/sign` (server derives signer identity). It warns when
  required fields may be missing.
- The standalone `/reports/[studyUid]` page (`ReportEditor`) was extended with
  the new content fields and disables editing once signed.
- `packages/types` `Report` and `ReportVersion` interfaces gained `clinicalHistory`,
  `technique`, and `comparison` (plus optional `author` on versions).

## Tests

`apps/api/test/reporting.e2e-spec.ts` covers `REPORT-1..REPORT-22`:

- Draft create with all content fields + hash length/format
- Study transitions to `REPORT_DRAFT` from `ASSIGNED`
- Idempotency (no duplicate drafts)
- Authorization: manager/admin/hospital/unassigned-radiologist all rejected
- Sign validation (missing fields `400`, nonexistent study/report `404`)
- Successful sign, study → `RADIOLOGIST_SIGNED`, canonical hash
- `ReportVersion` snapshot content
- Double-sign guard (`409`)
- Audit rows `REPORT_SIGNED` + `STUDY_STATUS_CHANGED`
- Draft-after-sign immutability (`409`)
- Version history retrieval + access control
- Nondraftable state rejected
- Content-hash consistency (64-char hex, expected SHA-256)
- Amend creates a new version
- List scoping

Run: `cd apps/api && pnpm exec jest --runInBand`

Full suite: 91 tests across 5 suites (Phase 1–4). Phase 1–3 (55 tests) remain green.
