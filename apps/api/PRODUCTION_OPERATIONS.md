# Phase 7 — Production Operations Runbook

This document is the operational/support runbook for the Axis Teleradiology PACS
production hardening delivered in Phase 7: observability and health, SLA/TAT
computation, backup & restore, retention/archival, rate limiting, security
headers, CORS, and the required production environment variables. It is written
for deployment and on-call operators, not end users.

Phase 7 implementation only. It preserves the behavior of Phases 1–6 (same
workflow, auth model, signature immutability, tenant isolation); it adds
operational safety on top without redesigning working systems.

## Observability & health

### Correlation IDs

Every HTTP request receives a correlation ID, generated server-side or accepted
from the inbound `x-request-id` header (up to 128 chars). It is returned on the
response as `x-request-id` and threaded through:

- structured request logs (`structured-logger.ts`),
- the audit log (each `AuditLog` row stores `correlationId`),
- error responses (included on the `ApiError` body).

This lets an operator trace a single end-user request from **frontend call →
API log → audit event → error response** using one value. Auth-app audit rows
(`LOGIN`, `USER_CREATED`, `USER_UPDATED`) are written through
`AuditService.create` so they carry the same correlation ID.

To reproduce a user-reported failure, ask for the `x-request-id`/correlation ID
from the browser dev tools and grep the API logs (`"correlationId": "<id>"`),
then query the audit log for the same ID.

### Health endpoints

Both are public (no auth) so load balancers can probe them without credentials.

| Endpoint | Purpose | Response |
| --- | --- | --- |
| `GET /api/health/live` | Liveness — process is up | `200 { status: 'ok', timestamp }` |
| `GET /api/health/ready` | Readiness — dependencies reachable | `200` if Postgres and Redis are reachable; `503` otherwise. Body has a `components[]` list with `postgresql`, `redis`, `orthanc` and `dicomweb` `status` (`up`/`down`) and `latencyMs`. |

Configure L4/L7 health checks against `/api/health/ready` and alert when it is
not `200`. Wire `ready` into your orchestration/load-balancer drain logic so a
box is taken out of rotation when Postgres or Redis is unreachable. Alert when
any component is down; `dicomweb` down means the Orthanc DICOMweb plugin or
`/dicom-web` route is unavailable even if raw Orthanc `/system` is healthy. The
probe verifies both the QIDO endpoint and that `/plugins` contains `dicom-web`.

### Orthanc deployment

Orthanc must run as a private Render service reachable over the private
network. Do not deploy it as a public web service or expose its HTTP or DICOM
ports. Configure Runtime `Docker`, Dockerfile Path
`infra/orthanc/Dockerfile.prod`, and Docker Context `infra/orthanc`. Keep its
persistent disk mounted at `/var/lib/orthanc/db`.

Set these values on the Orthanc service:

```text
ORTHANC_AUTH_ENABLED=true
ORTHANC_USERNAME=<generated non-default username>
ORTHANC_PASSWORD=<generated strong secret>
```

`infra/orthanc/orthanc.prod.json` requires all three `ORTHANC_*` auth variables;
missing values stop startup. Set the same credentials on the API and use
`ORTHANC_URL=http://axis-orthanc:8042`, with no `/dicom-web` suffix. Never put
these credentials in the frontend or OHIF configuration. Orthanc STOW-RS and
its DICOM C-STORE listener are disabled; all uploads, including recovery, must
pass the API's lossless compression and pixel-hash verification. Never point a
health check at DICOM port `4242`; non-DICOM probes there cause repeated
`Unrecognized PDU type` log entries. Check readiness through
`/api/health/ready`.

The API build must include `tools/dicom-compression-poc` and Python 3.10+ with
its `requirements.txt` installed into
`tools/dicom-compression-poc/runtime/site-packages`; the API build runs this
provisioning and a synthetic lossless encode/decode verification before producing
the deployable artifact. The API worker runs `python3` with that build-created
site-packages directory on `PYTHONPATH`. Set `AXIS_DICOM_PYTHON` only when using
an external interpreter; missing codec/runtime dependencies cause ingest to fail
closed. Run `pnpm dicom:verify` after deployment to re-check the installed worker
without changing application startup behavior. The verifier now also exercises a
synthetic JPEG Baseline → JPEG 2000 Lossless conversion with exact pixel-hash
verification and lossy-history preservation. For JPEG Baseline, absent
`LossyImageCompression` and method metadata are normalized to `01` and
`ISO_10918_1` based on the source transfer syntax; inconsistent present values
are rejected, and an absent ratio remains absent. All other lossy syntaxes
remain rejected.

After deployment, access Orthanc only from the API's private network.
Unauthenticated `/system`, `/studies`, `/patients`, `/plugins` and
`/dicom-web/studies` must return `401`. With credentials, `/system` must report
`Axis Orthanc 1.13.1`, `/plugins` must include `dicom-web`, and
`/dicom-web/studies` must return `200`. Compare the authenticated `/studies`
count before and after the rebuild to confirm no DICOM data was lost.

## Authentication recovery and abuse protection

### Password reset

`POST /api/auth/forgot-password` always returns the same generic response for
known and unknown email addresses. Approved, active accounts receive a
Resend-delivered link to `/reset-password`; pending, suspended, and unknown
accounts do not. Reset tokens are generated from 32 cryptographically random
bytes, only their SHA-256 hashes are stored, and tokens are single-use and
expire after 20 minutes by default. Configure
`PASSWORD_RESET_TOKEN_TTL_MINUTES` from 15 through 30 minutes. Successful resets
update the bcrypt password hash, invalidate other outstanding reset tokens, and
increment the user's authentication version so existing sessions stop working.

Configure these deployment variables:

- `RESEND_API_KEY` — secret API key for the Resend account.
- `EMAIL_FROM` — sender address verified by Resend.
- `NEXT_PUBLIC_APP_URL` — public frontend origin used in links.

Production startup requires the Resend API key and verified sender. Configure
them through the deployment's secret manager; do not put real credentials in
`.env.example`. For local development, set these values to test credentials to
exercise email delivery. If they are absent, requests still return the generic
response and the API logs a configuration error; no reset token is returned by
the API or written to logs.

### Shared rate limiting

Login failures are limited by both client IP and normalized email. Password
recovery requests are independently limited by IP and email/reset-token hash.
Limits and counters are in PostgreSQL, so all API replicas share them; they
expire automatically and `Retry-After` is returned with HTTP 429 responses.
Configure:

- `AUTH_LOGIN_MAX_ATTEMPTS` (default `10`) and
  `AUTH_LOGIN_WINDOW_SECONDS` (default `900`).
- `AUTH_RECOVERY_MAX_REQUESTS` (default `5`) and
  `AUTH_RECOVERY_WINDOW_SECONDS` (default `900`).

Set `TRUST_PROXY` to the correct proxy hop count when deployed behind a trusted
reverse proxy so IP-based limits use the real client address. These limits
expire by time window and do not permanently lock accounts.

### Deployment

The API start command applies pending additive migrations with
`prisma migrate deploy` before Nest listens, using the API's `DATABASE_URL`.
For a migration-only step, run `pnpm db:migrate:deploy` from the repo root, then
deploy the API and frontend. The migration adds reset-token and shared limiter
tables plus a user authentication-version column; it does not delete or rewrite
user, audit, or clinical data. Set the email and rate-limit variables before
rollout, verify API readiness, and test a reset end to end using a
non-production account. Never use `prisma migrate dev` or `db push` in
production.

A fresh-database migration-chain check currently stops at the pre-existing
`20261029000000_report_study_version_unique` migration because the
`Report_studyId_version_key` index already exists. This feature does not alter
that historical migration. Before a fresh installation, resolve that existing
migration-history issue separately; for an existing production database, verify
its migration history is current before deploying. Do not reset or baseline a
production database as a workaround.

## SLA & TAT

SLA deadlines, remaining time and breach state are always computed **server-side**
by `SlaService` from real database timestamps — never from client-supplied
values. There is no client override path.

- Default thresholds (fallback when no `SlaConfig` row exists):
  `STAT=60`, `URGENT=240`, `ROUTINE=1440` minutes.
- Persisted configuration overrides the default for that priority and is
  recorded in the audit log as `SLA_CONFIG_CHANGED`.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/sla/overview` | ADMIN / MANAGER | Live operational overview: state counts, average reporting & total TAT, breach count/percentage and breach list. |
| `GET /api/sla/config` | ADMIN / MANAGER | Current priority→minutes thresholds + fallback defaults. |
| `POST /api/sla/config` | ADMIN | Set/update a threshold (`{ priority, minutes }`, minutes ≥ 1). |

Response fields for the overview are derived as follows:

- `counts.*` — study counts grouped by current `StudyStatus`.
- `tat.averageReportingMinutes` — mean of `signedOffAt - assignedAt` over signed studies.
- `tat.averageTotalMinutes` — mean of `completedAt - (receivedAt ?? createdAt)` over completed studies.
- `sla.breaches` — server-computed list of in-progress studies past deadline.

### MIS Excel export

`GET /api/analytics/mis-report` is available to ADMIN and MANAGER roles. ADMIN
exports across hospitals; MANAGER scope comes only from the authenticated
account's `hospitalId`. Managers without a hospital assignment are denied.
The endpoint writes a streaming workbook to a private temporary file before
returning it, reads studies in deterministic 500-row batches, and removes the
temporary file after download. Additional worksheets are created only when the
Excel row limit is reached; each repeats the same 24 headers.

`Center / Site` uses the study's hospital name because `Study` has no site
relationship. `Patient-Id` removes the hospital namespace added by DICOM
ingestion and otherwise preserves the stored patient identifier. `Modality`
uses the recorded source value; legacy studies without one export blank rather
than the normalized workflow value.

`TurnAroundTime` uses `completedAt - (receivedAt ?? createdAt)` for completed
studies. `TatAssignedToSSignedOff` uses `signedOffAt - assignedAt`. Both values
are rounded minutes; missing or negative intervals are blank. Stored server
timestamps, including the latest `REPORT_VERIFIED` audit timestamp used for
`Verified At`, are exported as UTC ISO-8601 strings. DICOM `studyDateTime` is built
from a supplied study date and time only when its source is known; legacy rows
and ingests without a valid supplied date export a blank rather than the
ingestion-time fallback. The current schema does not retain the source timezone
offset, so the value is exported as an unzoned wall-clock string.
`historyCreatedAt` is nullable for studies created before the timestamp was
introduced.

## Backups

### How it works

`BackupService` and `prisma/backup-cli.ts` share one workflow in
`apps/api/src/backup/backup-workflow.ts`. Every run creates a `BackupRun` row
with lifecycle status `RUNNING → COMPLETED/FAILED → VERIFIED`. A run is marked
`COMPLETED` only after every requested artifact is generated, validated,
uploaded, and checksum-verified. A partial backup is always `FAILED`.

`BACKUP_STORAGE_PROVIDER` selects the mode:

- `LOCAL` (default) preserves the development Podman workflow:
  - **DATABASE** — `pg_dump` via `podman exec` into `axis-postgres`.
  - **DICOM** — `podman volume export` of `axis_orthanc_data`.
- `B2` is the production mode:
  - **DATABASE** — `pg_dump --format=custom --compress=9` connects directly to
    `DATABASE_URL`; credentials are passed in the child process environment,
    never in command arguments or logs. `pg_dump` must be installed; set
    `PG_DUMP_BIN` if it is not on `PATH`.
  - **DICOM** — authenticated QIDO-RS enumerates every study, series, and
    instance; WADO-RS retrieves each original DICOM object and streams them
    into `tar.gz` with a `manifest.json` recording UIDs, hierarchy, and hashes.
    An empty or incomplete enumeration fails the run.
  - Artifacts are streamed with multipart upload to the private Backblaze B2
    bucket (`B2_BUCKET_NAME`), then verified with `HEAD` metadata and a full
    download checksum comparison.

B2 object keys are namespaced as
`backups/{environment}/{runId}/{db|dicom}_{runId}_{timestamp}.*`. Credentials
stay server-side; no B2 value is exposed to the browser.

A separate **verify** action re-checks every required artifact (downloading it
from B2 when needed), validates the DB dump, and moves the run to `VERIFIED`
only when all requested artifacts pass. Verification, restore, object deletion,
and retention operations emit audit rows.

### DICOM recovery model

The B2 DICOM artifact contains the original DICOM instance bytes and the UID
hierarchy, not Orthanc's internal SQLite index. Restore first restores the
PostgreSQL dump, then re-imports the DICOM instances through the authenticated
Orthanc ingest endpoint. Orthanc internal IDs are deliberately regenerated and
the PostgreSQL `orthanc*Id` mappings are updated from the idempotent ingest
responses. No study, series, instance, or report content is overwritten.

### Schedule (recommended)

- DATABASE: nightly, off-peak (e.g. 02:00 local).
- DICOM: nightly (or weekly for very large archives).
- Run **FULL** periodically so a database artifact and DICOM artifact are kept
  as a matching pair; B2 retention only prunes verified FULL pairs.
- Run a **weekly verify** so a corrupt/incomplete dump is caught while the data
  still exists.

### CLI

```
pnpm --filter @axis/api db:backup            # full backup via CLI
pnpm --filter @axis/api db:backup --type DATABASE
pnpm --filter @axis/api db:backup --type DICOM
```

### Restore procedure

Admin-only endpoint:

```
POST /api/admin/backups/:id/restore
{ "type": "FULL", "confirm": true }
```

- The run must be `COMPLETED` or `VERIFIED`.
- Database restore requires `RESTORE_DATABASE_URL` to point to an explicitly
  chosen, empty target database. The endpoint never drops or clears a database.
- DICOM restore re-imports instances into Orthanc and updates only the internal
  Orthanc ID mappings in PostgreSQL.
- `pg_restore` must be installed; set `PG_RESTORE_BIN` if needed.

For local development, the previous Podman-based restore commands remain valid:

```
cat backups/db_TIMESTAMP.sql | podman exec -i axis-postgres psql -U axis -d axis_pacs
podman volume import axis_orthanc_data backups/orthanc_TIMESTAMP.tar
```

Always restore from a `VERIFIED` FULL backup when available. Restore is audited
as a surgical, operator-driven action; it is never part of a backup run.

## Retention & archival

There are two retention paths:

1. **Manual archival** — the existing preview/execute workflow.
2. **Lifecycle processing** — DB-backed jobs that start notification sequences,
   record user decisions, archive, and (only after explicit opt-in) expire
   archive objects or original DICOM data.

Manual retention marks **COMPLETED** studies as archived once their
`completedAt` is older than `AXIS_RETENTION_DAYS` (default 90). Archival is
non-destructive of records: it flips `Study.archivedAt`, writes a minimized
retention archive, and records `ARCHIVE_MARKED`, `ARCHIVE_CREATED`,
`ARCHIVE_VERIFIED`, and `RETENTION_EXECUTED` audit rows. Preview is read-only.

Eligibility requires:

- status `COMPLETED`, `archivedAt IS NULL`, and a valid lifecycle anchor,
- anchor ≤ cutoff,
- valid tenant linkage and an active hospital,
- `imagingAvailability = AVAILABLE`,
- no active correction (OPEN/ACKNOWLEDGED/APPROVED/IN_PROGRESS), active draft/
  review report, active delivery, or incomplete worklist item,
- no legal hold,
- for lifecycle mode only: a signed report, delivered report, and terminal
  `COMPLETED`/`HOSPITAL_ACCEPTED` status,
- a strict verified FULL backup when `AXIS_RETENTION_REQUIRE_BACKUP=true` (the
  default): status `VERIFIED`, `verifiedAt`/`completedAt` set, no `failedAt`,
  type `FULL`, both database/DICOM flags, object keys, and checksums present,
  and matching provider/environment. B2 runs also require `remoteVerifiedAt`.

PENDING/RUNNING/FAILED/unverified, database-only, and DICOM-only runs never
satisfy the backup gate. BackupRun metadata proves run-level protection, not
per-study inclusion; restoreability should be validated separately with the
DICOM archive manifest and a tested restore.

The lifecycle anchor is `completedAt`, then `hospitalAcceptedAt`; it is never
silently derived from `createdAt`/`studyDate` for lifecycle processing. Initial
eligibility starts `INITIAL_RETENTION_DAYS` (default 20) after that anchor.
Recipients are derived server-side: active approved `ADMIN` users plus active
approved `MANAGER`/`HOSPITAL` users in the study's hospital. Client input never
chooses recipients.

Decision rules:

- `CANCEL` increments `cancelCount` and defers by `CANCEL_REMINDER_DAYS`.
  Reaching `CANCEL_MAX_COUNT` enqueues `PROCESS_ARCHIVE`.
- A delivered notice with no response becomes `IGNORED` after
  `IGNORE_RESPONSE_HOURS`. One reminder is counted per sequence; reminders are
  sent every `IGNORE_REMINDER_DAYS`. Reaching `IGNORE_MAX_COUNT` enqueues
  `PROCESS_ARCHIVE`.
- `DELETE` enqueues `PROCESS_ARCHIVE` immediately.
- A legal hold blocks notification, response, archival expiry, and original-data
  cleanup. A hold applied to `IN_PROGRESS` or `FINALIZING` cleanup aborts the
  worker only before `RetentionArchive.orthancDeleteDispatchedAt` is written.
  Once that dispatch marker exists, the Orthanc DELETE is already in flight and
  cannot be rolled back; the hold records `deleteInFlight=true` for audit.
  Managers are scoped to their own hospital; admins are global.

### Retention endpoints

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/admin/retention/preview` | ADMIN, MANAGER | Read-only manual preview plus lifecycle status counts and upcoming actions. |
| `POST /api/admin/retention/execute` | ADMIN, MANAGER | Revalidate and archive eligible manual studies. |
| `GET /api/admin/retention/jobs` | ADMIN, MANAGER | Inspect retention queue state. |
| `POST /api/admin/retention/jobs/:id/retry` | ADMIN, MANAGER | Requeue a `DEAD` job. |
| `POST /api/admin/retention/holds/:studyId` | ADMIN, MANAGER | Apply a legal hold with reason and optional expiry. |
| `DELETE /api/admin/retention/holds/:studyId` | ADMIN, MANAGER | Release a legal hold. |
| `GET /api/retention/notifications` | ADMIN, MANAGER, HOSPITAL | List retention notices visible to the caller. |
| `POST /api/retention/notifications/:id/respond` | ADMIN, MANAGER, HOSPITAL | Record `CANCEL` or `DELETE`; only the recipient may respond. |
| `POST /api/internal/retention/tick` | `X-Cron-Secret` | Trigger one existing scheduler tick; never accepts a browser session. |

### Scheduler and jobs

`RETENTION_SCHEDULER_ENABLED` defaults to `false`. When enabled, each API
instance enqueues deduplicated recurring jobs (`START_RETENTION`,
`SEND_NOTIFICATION`, `MARK_IGNORED`, `DELETE_EXPIRED_BACKUPS`) on the configured
interval and claims up to five due jobs per tick using DB leases. Failed jobs
retry with backoff until `RETENTION_JOB_RETRY_LIMIT`; then they become `DEAD`
and can be retried explicitly.

For externally driven scheduling, call `POST /api/internal/retention/tick` with
header `X-Cron-Secret` matching `RETENTION_CRON_SECRET`. The endpoint is public
to `AuthGuard` only so its dedicated guard can enforce the shared secret; a
missing, weak, or invalid secret returns `401`. It invokes exactly one
`RetentionSchedulerService.tick()`, returns HTTP `200` with
`{ data: { accepted, claimed, processed, failed, skipped }, meta: { triggeredAt } }`,
and never calls manual `execute` or starts a second timer. Configure either the
in-process timer or the external cron as the primary driver; with cron-job.org,
keep `RETENTION_SCHEDULER_ENABLED=false`. `skipped: true` means a tick was
already running and no new work was claimed for that call. Cron-job.org should
run every 15 minutes and alert on non-2xx responses; job-level failures are
tracked in `RetentionJob.lastError` and the admin jobs list.

### Archive contents and expiry

Each retention archive records a `report.json`, `study.json`, and
`archive-manifest.json` with SHA-256 checksums. The report artifact includes
report content, author identity, patient identifiers, hospital identity, and
every immutable `ReportVersion` snapshot (version, status, author, hash,
timestamps, and content). Archive verification fails when a version snapshot is
missing or altered.
By default (`RETENTION_DICOM_ARCHIVE_ENABLED=false`) the archive references the
verified FULL backup's DICOM object but does not own it. In that mode original
Orthanc cleanup and DICOM backup expiry remain blocked. When enabled, a
per-study DICOMweb archive is generated, checksum-verified, and recorded as
owned before the archive record becomes `ARCHIVED`.

DICOM and metadata expiry are independent:
`DICOM_BACKUP_RETENTION_DAYS` (default 14) and
`METADATA_BACKUP_RETENTION_DAYS` (default 30), both from archive verification.
Only owned DICOM objects are eligible for expiry. `RETENTION_DRY_RUN=true` (the
default) prevents backup-object deletion and original-data deletion.
`RETENTION_BACKUP_DELETE_ENABLED` must also be `true` to delete expired archive
objects, and `RETENTION_DELETE_ENABLED` must also be `true` (with
`RETENTION_DICOM_ARCHIVE_ENABLED=true`) to delete the original Orthanc study.
Original-data deletion uses a database claim and an atomic dispatch marker,
rechecks legal hold, config, ownership, archive state, and eligibility
immediately before the external call, and records
`PERMANENT_DELETION_VERIFIED` only after Orthanc confirms the study is absent.
Archive-object expiry claims each deletion with a conditional update and
rechecks legal hold, ownership, checksum, and eligibility immediately before
each B2 purge. B2 purges re-list versions, delete markers, and multipart uploads
to confirm removal. No deletion path is active by default, and every deletion
attempt is audited.

For B2 backup pairs, `BACKUP_RETENTION_ENABLED` defaults to `true` and
`BACKUP_RETENTION_COUNT` defaults to `7`. Only older FULL runs with both DB and
DICOM artifacts verified are eligible; the newest valid pair and the current
run are always preserved. Backup retention is ADMIN-only and rechecks active
legal holds, retention references, run ownership, and the preserved count
immediately before each purge. BackupRun records are never deleted.

### Retention configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AXIS_RETENTION_DAYS` | `90` | Manual archival window. |
| `AXIS_RETENTION_REQUIRE_BACKUP` | `true` | Require a strict verified FULL backup. |
| `INITIAL_RETENTION_DAYS` | `20` | Days after lifecycle anchor before first notice. |
| `CANCEL_REMINDER_DAYS` | `20` | Defer period after `CANCEL`. |
| `CANCEL_MAX_COUNT` | `3` | `CANCEL` count that triggers automatic processing. |
| `IGNORE_RESPONSE_HOURS` | `24` | No-response window for delivered notices. |
| `IGNORE_REMINDER_DAYS` | `3` | Interval between ignored notices. |
| `IGNORE_MAX_COUNT` | `5` | Ignored sequences that trigger automatic processing. |
| `DICOM_BACKUP_RETENTION_DAYS` | `14` | DICOM archive object expiry. |
| `METADATA_BACKUP_RETENTION_DAYS` | `30` | Metadata archive object expiry. |
| `MANDATORY_RETENTION_DAYS` | `0` | Additional absolute retention floor. |
| `RETENTION_POLICY_VERSION` | derived | Override the version stored on retention records. |
| `RETENTION_JOB_RETRY_LIMIT` | `5` | Attempts before a job becomes `DEAD`. |
| `RETENTION_SCHEDULER_ENABLED` | `false` | Enable in-process lifecycle jobs. |
| `RETENTION_SCHEDULER_INTERVAL_MINUTES` | `15` | Job poll interval. |
| `RETENTION_CRON_SECRET` | unset | Shared secret for `X-Cron-Secret`; unset disables `/api/internal/retention/tick`. |
| `RETENTION_DRY_RUN` | `true` | Block destructive cleanup paths. |
| `RETENTION_DELETE_ENABLED` | `false` | Allow original Orthanc deletion; requires `RETENTION_DICOM_ARCHIVE_ENABLED=true`. |
| `RETENTION_BACKUP_DELETE_ENABLED` | `false` | Allow expired archive object deletion; only owned DICOM objects are eligible. |
| `RETENTION_DICOM_ARCHIVE_ENABLED` | `false` | Generate and own per-study DICOM archives. |

### Safe activation order

1. Confirm a recent verified FULL backup and a tested restore path.
2. Keep `RETENTION_DRY_RUN=true`, `RETENTION_DELETE_ENABLED=false`, and
   `RETENTION_BACKUP_DELETE_ENABLED=false`.
3. Enable `RETENTION_SCHEDULER_ENABLED=true` and review notices/jobs for at
   least one full policy cycle.
4. Only then set `RETENTION_DRY_RUN=false`, enable
   `RETENTION_DICOM_ARCHIVE_ENABLED=true`, and enable one deletion flag at a
   time, starting with `RETENTION_BACKUP_DELETE_ENABLED`.
5. Never enable deletion to resolve an eligibility or notification problem;
   fix the policy/data issue first.

## Rate limiting

Applied per-route (method-specific) via an in-process fixed-window limiter:

| Route | Method | Limit |
| --- | --- | --- |
| `/api/auth/login` | POST | 100 / 15 min |
| `/api/auth/register` | POST | 20 / 60 min |
| `/api/dicom/ingest` | POST | 20 / 60 sec |
| `/api/studies/:uid/correction-requests` | POST | 50 / 60 min |
| `/api/corrections/:id/approve` / `/reject` | POST | 100 / 60 min each |

## Security headers

Applied globally by `SecurityHeadersMiddleware`:

- `Strict-Transport-Security` (when behind TLS),
- `X-Content-Type-Options: nosniff`,
- `X-Frame-Options: DENY`,
- `Referrer-Policy: same-origin`,
- `X-XSS-Protection: 0`,
- a Content-Security-Policy from `SECURITY_HEADERS_CSP` (or a strict default).

Dev overrides: `SECURITY_HEADERS_DISABLED=true` disables headers locally;
`SECURITY_HEADERS_CSP` overrides the default CSP string.

## CORS

`CORS_ORIGIN` controls allowed origins for credentialed requests. For a single
origin use the literal origin (e.g. `https://pacs.example.com`). For several use
a comma-separated list (`https://a.example.com,https://b.example.com`). Leave
unset to use the app's resolve-first-origin default for local development. Never
use `*` with credentials in production.

## Required production environment variables

See `.env.example` for the full annotated list. Key Phase 7 variables:

| Variable | Meaning |
| --- | --- |
| `AXIS_ENV` | Runtime environment label (e.g. `production`) used in structured logs and B2 object keys. |
| `AXIS_BACKUP_DIR` | Local staging artifact directory (default `backups`). |
| `BACKUP_STORAGE_PROVIDER` | `LOCAL` (Podman) or `B2` (direct PostgreSQL + DICOMweb + Backblaze B2). |
| `AXIS_POSTGRES_CONTAINER` | Podman Postgres container name (default `axis-postgres`). |
| `AXIS_ORTHANC_DATA_VOLUME` | Orthanc data volume (default `axis_orthanc_data`). |
| `AXIS_PODMAN_BIN` | Podman binary path (default `podman`). |
| `AXIS_PACS_DB` / `AXIS_PACS_DB_USER` | Database name / user for LOCAL Podman backups. |
| `PG_DUMP_BIN` / `PG_RESTORE_BIN` | PostgreSQL client binaries for B2 backups/restores. |
| `RESTORE_DATABASE_URL` | Explicit empty target database for admin database restores. |
| `B2_KEY_ID` / `B2_APPLICATION_KEY` | Backblaze B2 S3-compatible credentials. Server-side only. |
| `B2_BUCKET_NAME` | Private B2 bucket (default `teleradiology-pacs`). |
| `B2_S3_ENDPOINT` / `B2_REGION` | B2 S3 endpoint and region for the bucket. |
| `B2_PREFIX` | Object key prefix (default `backups`). |
| `BACKUP_RETENTION_ENABLED` / `BACKUP_RETENTION_COUNT` | B2 verified FULL-pair retention (defaults `true` / `7`). |
| `AXIS_RETENTION_DAYS` | Clinical archival retention window (default `90`). |
| `AXIS_RETENTION_REQUIRE_BACKUP` | Require a verified backup before archival (default `true`). |
| `INITIAL_RETENTION_DAYS` / `CANCEL_MAX_COUNT` / `IGNORE_MAX_COUNT` | Lifecycle notification thresholds (see retention configuration above). |
| `RETENTION_SCHEDULER_ENABLED` / `RETENTION_SCHEDULER_INTERVAL_MINUTES` | Lifecycle job activation and poll interval. |
| `RETENTION_DRY_RUN` / `RETENTION_DELETE_ENABLED` / `RETENTION_BACKUP_DELETE_ENABLED` | Destructive-operation safety gates. |
| `BACKUP_ACTOR` | Audit actor identity for CLI backups. |
| `SECURITY_HEADERS_DISABLED` / `SECURITY_HEADERS_CSP` | Header toggles (see above). |
| `CORS_ORIGIN` | Allowed CORS origin(s). |

## Monitoring checklist

- [ ] Health `ready` endpoint wired to load-balancer / orchestrator checks.
- [ ] Correlate support tickets via `x-request-id`.
- [ ] Nightly database + DICOM backups scheduled; weekly verify job.
- [ ] Restore procedure rehearsed and documented (above).
- [ ] Retention preview + execute reviewed on a schedule.
- [ ] SLA overview reviewed for breach trends.
- [ ] Rate-limit and security-header settings confirmed for the ingress.
