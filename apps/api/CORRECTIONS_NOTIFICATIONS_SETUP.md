# Phase 6 — Corrections & Notifications

This document describes the Phase 6 correction / change-request workflow and the
application notification layer implemented in the Axis Teleradiology PACS. It
reuses the existing Phase 4 signing (+ immutable `ReportVersion`) and Phase 5
review / delivery lifecycle. A correction **never mutates** a signed report or
snapshot — it always produces a NEW version that flows through the standard
lifecycle, with notifications driven by server-derived recipients.

> **Non-goal**: Phase 7 (external deliveries / routing) is out of scope.

## Model

The existing `ChangeRequest` entity is reused as the correction entity (a
separate `CorrectionRequest` model is intentionally **not** created). It is
extended with correction lineage and reviewer metadata.

### `ChangeRequest` (extended)
- `status` — `OPEN` | `ACKNOWLEDGED` | **`APPROVED`** (new) | `IN_PROGRESS` |
  `RESOLVED` | `REJECTED` | `CANCELLED`
- `requestedByRole` — role of the requester (derived server-side)
- `sourceStatus` — the study status stored before the correction began, used to
  restore it if a request is rejected (defaults to `COMPLETED`)
- `parentReportVersionId` — the original signed `ReportVersion` being corrected
- `newReportVersionId` — the new corrected signed `ReportVersion` (set at sign)
- `reviewedById` / `reviewedAt` — manager/admin who approved/rejected
- Existing fields `reason`, `resolution`, `assignedToId`, `resolvedAt`

### `ReportVersion` (unchanged semantics)
Back-relations `parentOfCorrections` / `resultOfCorrections` tie the immutable
snapshots into the correction lineage. Snapshots are never updated.

### `Notification` (new)
- `id`, `recipientUserId`, `type`, `title`, `message`, `studyId?`,
  `correctionRequestId?`, `readAt?`, `createdAt`
- Recipients are **always derived server-side** from role / hospital /
  assignment. The client never supplies a `recipientUserId`.

### Enums
- `ChangeRequestStatus` added `APPROVED`.
- `AuditAction` added `CORRECTION_REQUESTED`, `CORRECTION_APPROVED`,
  `CORRECTION_REJECTED`, `CORRECTION_STARTED`, `CORRECTED_REPORT_SIGNED`,
  `CORRECTION_RESOLVED`.

### Schema migration
`20260904122145_phase6_corrections_notifications` applied the above to the dev
(`axis_pacs`) and test (`axis_pacs_test`) databases. `@axis/types` was rebuilt
(`pnpm --filter @axis/types build`) so API/web typecheck see the new types.

## Core invariant

**A signed report/version is forever immutable.** A correction:
1. Keeps the original `ReportVersion` (and its hash) byte-for-byte unchanged.
2. Creates a NEW `Report` row (`version = maxVersion + 1`, status `DRAFT`) whose
   content is seeded from the parent snapshot.
3. On sign, persists a NEW `ReportVersion` with a freshly computed server-side
   hash, and links lineage via `ChangeRequest.newReportVersionId`.
4. Then flows through the normal Phase 5 review → approve → deliver → accept →
   complete lifecycle.

The original author/signer is never replaced; only new version rows are added.

## Correction lifecycle

The correction request endpoint is the **only** authorized way to move a study
into the correction workflow — the generic status `PATCH` cannot reach
`CORRECTION_REQUESTED` (it is not in `ALLOWED_TRANSITIONS`; `COMPLETED` has no
outgoing transitions for the generic path).

Eligible source states (a signed report must already exist):
`DELIVERED_TO_HOSPITAL`, `HOSPITAL_REVIEW`, `HOSPITAL_ACCEPTED`, `COMPLETED`.

| Step | Actor | Action | Result |
| --- | --- | --- | --- |
| 1 | HOSPITAL (own) / MANAGER / ADMIN | `POST /studies/:uid/correction-requests` with `reason` | `OPEN` CR created; study → `CORRECTION_REQUESTED`; notify managers |
| 2 | MANAGER / ADMIN | `POST /corrections/:id/approve` | CR → `APPROVED`; study → `IN_READING`; notify assigned radiologist |
| 2b | MANAGER / ADMIN | `POST /corrections/:id/reject` with `resolution` | CR → `REJECTED` + `resolution`; study → `sourceStatus` (default `COMPLETED`); notify requester |
| 3 | assigned RADIOLOGIST | `POST /studies/:uid/corrections/begin` | New `DRAFT` Report vN+1; CR → `IN_PROGRESS` + parent lineage; study → `REPORT_DRAFT`; notify managers |
| 4 | assigned RADIOLOGIST | `PATCH /reports/:uid/draft` (existing) | Edit the corrected draft |
| 5 | assigned RADIOLOGIST | `POST /reports/:uid/sign` (existing) | New `SIGNED` `ReportVersion`; CR → `RESOLVED` + `newReportVersionId`; audits; notify managers |
| 6.. | MANAGER / HOSPITAL | Phase 5 `review`→`approve`→`deliver`; `hospital-review`→`accept`; `complete` | Corrected report delivered / accepted; notifications to hospital / managers |

The radiologist editing and signing of the corrected draft reuse the exact Phase 4
`saveDraft` / `signOff` paths (status `REPORT_DRAFT` is draftable/signable), so the
corrected report gets the same single `ReportVersion` snapshot and double-sign
guard.

## Guards

- Requesting a correction requires a signed report (`400` otherwise), eligibility
  state (`400` otherwise), and no **active** duplicate correction (`409`).
- HOSPITAL may only request corrections for its own hospital's studies (`403`
  otherwise — enforced before any side effects).
- Only MANAGER/ADMIN may approve or reject; only the assigned radiologist (with an
  `APPROVED` correction) may begin a correction (`403`).
- Double approval / double start / double corrected-sign are idempotency-guarded
  inside the transaction (`409`).

## Authorization (server-derived)

- `requestedById` / `requestedByRole` are taken from the authenticated session.
- `assignedToId` defaults to the study's `assignedRadiologistId`.
- Notification recipients are always resolved from role / hospital / assignment;
  there is no endpoint that accepts a client-supplied recipient.
- A user can only read and mark-read **their own** notifications (`403` otherwise);
  there is no cross-tenant / cross-user leak.
- Neutral metadata only — notification messages never embed full report content.

## Notifications

Polling-based persistent `Notification` model (no websocket / RabbitMQ / Redis;
none exists in the codebase). Minimum event set:

| Event | Recipients |
| --- | --- |
| `CORRECTION_REQUESTED` | managers |
| `CORRECTION_APPROVED` | assigned radiologist |
| `CORRECTION_REJECTED` | requester |
| `CORRECTION_STARTED` | managers |
| `CORRECTED_REPORT_SIGNED` | managers |
| `CORRECTED_REPORT_DELIVERED` | hospital users |
| `CORRECTION_HOSPITAL_ACCEPTED` | managers |

## API surface (Phase 6)

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| `POST` | `/studies/:uid/correction-requests` | HOSPITAL/MANAGER/ADMIN | Request a correction |
| `POST` | `/studies/:uid/corrections/begin` | RADIOLOGIST (assigned) | Begin corrected draft |
| `GET` | `/corrections` | all | Correction queue (scoped) |
| `POST` | `/corrections/:id/approve` | MANAGER/ADMIN | Approve |
| `POST` | `/corrections/:id/reject` | MANAGER/ADMIN | Reject (needs `resolution`) |
| `GET` | `/notifications` | all | Own notifications + unread count |
| `GET` | `/notifications/unread-count` | all | Unread count |
| `POST` | `/notifications/read-all` | all | Mark all read |
| `POST` | `/notifications/:id/read` | all | Mark one read (own only) |

## Frontend

- **Notification bell** (`NotificationBell` in the `TopBar`) — polls
  `/notifications`, shows an unread badge, a dropdown of own notifications, and
  mark-read / mark-all-read actions; clicking a notification navigates to the study.
- **Hospital** — `Received Reports → [study]` page gained a **“Request a
  Correction”** panel (reason textarea → `correction-requests`) shown for eligible
  delivered/accepted/completed signed reports.
- **Manager/Admin** — a new `/corrections` queue page lists correction requests and
  provides **Approve / Reject** (with resolution). Added to `ROUTE_RULES` and
  `NAV_DEFS` in `apps/web/src/lib/permissions.ts`.
- **Radiologist** — the reading page gained a `CorrectionWorkflow` panel that shows
  an active correction and a **“Start Correction”** button (when `APPROVED`). After
  starting, the corrected draft is edited/signed through the existing `ReportPanel`
  + `SignOffControls`.
- **Version history** — corrected versions (`version > 1`) are labelled
  **“Corrected”** (v1 is labelled “Original”).

## Tests

`apps/api/test/corrections.e2e-spec.ts` (`CORRECTION-1..28`) and
`apps/api/test/notifications.e2e-spec.ts` (`NOTIFICATION-1..11`):

- Request own-hospital correction, cross-hospital `403`, URL-UID tampering `403`
- Duplicate active correction `409`; invalid-state request `400`
- Generic status `PATCH` cannot bypass to `CORRECTION_REQUESTED` (no outgoing transition)
- Manager approve / reject; unauthorized roles `403`; double approve `409`
- Begin creates v2 `DRAFT`, CR → `IN_PROGRESS`, seeded content, study → `REPORT_DRAFT`
- **Original `ReportVersion` + hash unchanged** after correction
- Corrected sign → new immutable `ReportVersion` v2 with a fresh 64-char hash
- CR → `RESOLVED` + `newReportVersionId`; study → `RADIOLOGIST_SIGNED`
- Double corrected-sign `409`; radiologist begins non-approved correction `409`
- Corrected report through Phase 5 review/delivery/accept/complete
- Correct hospital sees corrected report; wrong hospital `403`
- Version history retains v1 and v2
- Full correction audit trail (`CORRECTION_REQUESTED/APPROVED/STARTED`,
  `CORRECTED_REPORT_SIGNED`, `CORRECTION_RESOLVED`)
- Notifications: requested→manager, approved→radiologist, rejected→requester,
  signed→manager, delivered→hospital, accepted→manager; own-only read `403`;
  no cross-user leak; server-derived recipients; mark-read / read-all / unread count
- Rejection reverts the study to `sourceStatus` (`COMPLETED`)

Run: `cd apps/api && pnpm exec jest --runInBand`

Full suite: **153 tests across 8 suites** (Phases 1–6). Phases 1–5 (121 tests)
remain green.
