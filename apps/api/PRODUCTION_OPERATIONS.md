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

Orthanc runs on the existing public Render web service; do not create a new paid
private service. Configure the service Build settings with Runtime `Docker`,
Dockerfile Path `infra/orthanc/Dockerfile.prod`, and Docker Context
`infra/orthanc`. Keep its existing disk mounted at `/var/lib/orthanc/db` and
leave the Render HTTP health check path unset so the default TCP probe on `8042`
is used.

Set these values on the Orthanc service:

```text
PORT=8042
ORTHANC_AUTH_ENABLED=true
ORTHANC_USERNAME=<generated non-default username>
ORTHANC_PASSWORD=<generated strong secret>
```

`infra/orthanc/orthanc.prod.json` requires all three `ORTHANC_*` auth variables;
missing values stop startup. Set the same credentials on the API plus
`ORTHANC_URL=https://<public-orthanc-origin>` with no `/dicom-web` suffix. If the
API and a private `axis-orthanc` service share a Render private network, use
`ORTHANC_URL=http://axis-orthanc:8042` instead; startup validation allows that
exact private hostname. Never put these credentials in the frontend or OHIF
configuration. Never point a health check at DICOM port `4242`; non-DICOM probes
there cause repeated `Unrecognized PDU type` log entries. Probe port `8042` or
`/api/health/ready`.

After deployment, unauthenticated `/system`, `/studies`, `/patients`, `/plugins`
and `/dicom-web/studies` must return `401`. With credentials, `/system` must
report `Axis Orthanc 1.13.1`, `/plugins` must include `dicom-web`, and
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

Retention marks **completed** studies as archived once their `completedAt` is
older than `AXIS_RETENTION_DAYS` (default 90). Archival is non-destructive of
records: it flips `Study.archivedAt` and records `ARCHIVE_MARKED` and
`RETENTION_EXECUTED` audit rows. Preview is read-only and writes no audit rows.
The clinical data is retained; this is a policy compliance marker, not deletion.

Eligibility requires:

- status `COMPLETED`, `archivedAt IS NULL`, and a valid `completedAt`,
- `completedAt ≤ cutoff` (now minus retention days),
- valid tenant linkage and an active hospital,
- `imagingAvailability = AVAILABLE`,
- no active correction (OPEN/ACKNOWLEDGED/APPROVED/IN_PROGRESS), active draft/
  review report, active delivery, or incomplete worklist item,
- a strict verified FULL backup when `AXIS_RETENTION_REQUIRE_BACKUP=true` (the
  default): status `VERIFIED`, `verifiedAt`/`completedAt` set, no `failedAt`,
  type `FULL`, both database/DICOM flags, object keys, and checksums present,
  and matching provider/environment. B2 runs also require `remoteVerifiedAt`.

PENDING/RUNNING/FAILED/unverified, database-only, and DICOM-only runs never
satisfy the backup gate. BackupRun metadata proves run-level protection, not
per-study inclusion; restoreability should be validated separately with the
DICOM archive manifest and a tested restore.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/admin/retention/preview` | ADMIN, MANAGER | Dry-run: `policy`, `reviewed`, `eligibleCount`, `skipped`, `skippedReasons`, and safe candidate details. |
| `POST /api/admin/retention/execute` | ADMIN, MANAGER | Revalidate and archive eligible studies; returns the preview summary plus `archived`. |

Managers are scoped to their own hospital; a manager without a hospital sees no
candidates. Admins are global. Always run **preview** first to review candidates,
then execute.

### Backup object retention

When `BACKUP_STORAGE_PROVIDER=B2`, successful FULL runs apply separate object
retention after each backup. `BACKUP_RETENTION_ENABLED` defaults to `true` and
`BACKUP_RETENTION_COUNT` defaults to `7`. Only older FULL runs with both DB and
DICOM artifacts verified are eligible; the newest valid pair and the current
run are always preserved. BackupRun records are never deleted, and every object
deletion is audited.

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
