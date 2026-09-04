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
| `GET /api/health/ready` | Readiness — dependencies reachable | `200` if Postgres **and** Orthanc are up; `503` otherwise. Body has a `components[]` list with per-dependency `status` (`up`/`down`) and `latencyMs`. |

Configure L4/L7 health checks against `/api/health/ready` and alert when it is
not `200`. Wire `ready` into your orchestration/load-balancer drain logic so a
box is taken out of rotation when Postgres or Orthanc is unreachable.

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

`BackupService` (`apps/api/src/backup/`) runs artifact backups and records a
`BackupRun` row with lifecycle status `RUNNING → COMPLETED/FAILED → VERIFIED`.

- **DATABASE** — `pg_dump` via `podman exec` on the configured Postgres container.
- **DICOM** — `podman volume export` of the Orthanc data volume.
- **FULL** — both of the above.

Each run writes a checksum, validates the DB dump (header + non-trivial size),
and emits `STARTED` / `COMPLETED` / `FAILED` audit rows. A separate **verify**
action re-checks the artifact checksum and (for DB dumps) re-validates the file,
setting status to `VERIFIED` and emitting `BACKUP_VERIFIED`.

`BACKUP_ACTOR` selects the audit actor; if none is configured the backup CLI
resolves the first ADMIN for audit attribution.

### Schedule (recommended)

- DATABASE: nightly, off-peak (e.g. 02:00 local), retain N daily.
- DICOM volume: nightly (or weekly for large volumes), retain N.
- Run the `db:backup` script or the endpoint, and schedule a **weekly verify**
  so a corrupt/incomplete dump is caught while the data still exists.

### CLI

```
pnpm --filter @axis/api db:backup            # full backup via CLI
pnpm --filter @axis/api db:backup --type DATABASE
pnpm --filter @axis/api db:backup --type DICOM
```

### Restore procedure (database)

1. `podman exec -i axis-postgres psql -U axis -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='axis_pacs' AND pid <> pg_backend_pid();"`
2. `podman exec -i axis-postgres psql -U axis -c "DROP DATABASE IF EXISTS axis_pacs;"`
3. `podman exec -i axis-postgres psql -U axis -c "CREATE DATABASE axis_pacs;"`
4. `cat backups/db_TIMESTAMP.sql | podman exec -i axis-postgres psql -U axis -d axis_pacs`
5. Optionally verify a restored study is present and run `prisma migrate` if the
   dump predates a migration.

### Restore procedure (DICOM volume)

```
podman volume rm axis_orthanc_data
podman volume import axis_orthanc_data backups/orthanc_TIMESTAMP.tar
```

Always restore from a `VERIFIED` backup. Record the restore as a post-incident
audit item (there is no destructive-restore endpoint by design; restore is a
surgical, operator-driven action).

## Retention & archival

Retention marks **completed** studies as archived once their `completedAt` is
older than `AXIS_RETENTION_DAYS` (default 90). Archival is non-destructive of
records: it flips `Study.archivedAt` and records an `ARCHIVE_MARKED` audit row
per study plus `RETENTION_PREVIEW` / `RETENTION_EXECUTED` job rows. The clinical
data is retained; this is a policy compliance marker, not deletion.

Eligibility requires:

- status `COMPLETED` and `archivedAt IS NULL`,
- `completedAt ≤ cutoff` (now minus retention days),
- a `VERIFIED`/`COMPLETED` backup exists (`AXIS_RETENTION_REQUIRE_BACKUP=true`,
  the default) — archival is gated on having a verified backup,
- **no active correction** on the study (OPEN/ACKNOWLEDGED/APPROVED/IN_PROGRESS).

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/admin/retention/preview` | ADMIN | Dry-run: list candidates with `eligible`, `hasActiveCorrection`, `verifiedBackupExists`, `reason`. |
| `POST /api/admin/retention/execute` | ADMIN | Archive eligible studies; returns `{ reviewed, archived, skipped }`. |

Always run **preview** first to review candidates, then execute.

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
| `AXIS_ENV` | Runtime environment label (e.g. `production`) used in structured logs. |
| `AXIS_BACKUP_DIR` | Backup artifact directory (default `backups`). |
| `AXIS_POSTGRES_CONTAINER` | Podman Postgres container name (default `axis-postgres`). |
| `AXIS_ORTHANC_DATA_VOLUME` | Orthanc data volume (default `axis_orthanc_data`). |
| `AXIS_PODMAN_BIN` | Podman binary path (default `podman`). |
| `AXIS_PACS_DB` / `AXIS_PACS_DB_USER` | Database name / user for backups. |
| `AXIS_RETENTION_DAYS` | Retention window (default `90`). |
| `AXIS_RETENTION_REQUIRE_BACKUP` | Require a verified backup before archival (default `true`). |
| `BACKUP_ACTOR` | Audit actor id for CLI backups. |
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
