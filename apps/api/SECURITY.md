# Axis PACS — Security Notes

This document records the security posture of the Axis Teleradiology PACS and the
Phase 7 hardening work. It is intended for maintainers and anyone onboarding to
the codebase, and it documents a **known credential exposure** that requires
operator action.

## Known credential exposure (must read)

The repository's initial commit `6275740` committed `.env.example` containing a
**real** Neon-hosted `DATABASE_URL` and a live `AUTH_SECRET` (a JWT signing
secret). Although `.env.example` has since been sanitized to safe placeholders
and a `git grep` shows no tracked leaked values remain, the secrets are still
present in **git history**.

Actions required (operator-dependent, do not perform without authorization):

1. **Rotate the secrets now** — because they are recoverable from git history,
   treat both as compromised:
   - Recreate the Postgres credentials for the exposed `DATABASE_URL` (or move
     to a fresh database), and
   - rotate `AUTH_SECRET` to a new random value (sessions are short-lived; a
     rotation invalidates outstanding JWTs).
2. **Rewrite history** to purge the secret from the repository (GitHub
   support / `git filter-repo`) and force-push. Do this **after** rotation so
   the forced-push race does not expose anything new.
3. Audit the decoded JWT payload (`sub`, `email`) — these are not secrets, but
   confirm the exposed secret was not used to forge sessions beyond the current
   rotation window.

The current gitignored `.env` still holds the working values for local dev;
ensure the replacement values are never committed.

## Authentication & sessions

- Auth model is unchanged from earlier phases: a signed JWT in an
  `httpOnly`, `sameSite=lax` cookie (`axis_session`) that maps to a DB user
  (`role`, `hospitalId`, `displayName`).
- `secure` is set when `NODE_ENV === 'production'`, so the cookie is sent only
  over HTTPS in production.
- Login/register are rate-limited (see `PRODUCTION_OPERATIONS.md`).
- The Administrator role cannot self-assign during registration.

## Authorization invariants

- **Backend is always authoritative.** The client never selects its role,
  tenant, or destination; every scoping decision is enforced server-side.
- `assertHospitalScope` in `corrections.service` is intentionally synchronous.
- Tenant isolation (hospital) and radiologist case isolation are enforced at the
  controller/service layer and covered by e2e tests.
- Sensitive study transitions require a signed report and correct predecessors;
  the generic status endpoint cannot bypass the state machine (see
  `REVIEW_DELIVERY_SETUP.md`).

## Audit integrity

- Signed versions are forever immutable; corrections create new versions.
- The audit log is append-only in intent; each row captures actor, action,
  resource, timestamp, IP/UA, and a `correlationId` traced end-to-end from the
  request `x-request-id`.
- Auth audits are written through `AuditService.create` (they carry a
  correlation ID), unlike legacy direct writes — any new audit must use
  `AuditService.create`/`createTx`, never a raw `prisma.auditLog.create`.
- `AuditLog.actorId` has a foreign key to the `User` table: audit rows must use
  a real user id (never `'system'`).

## Transport & application headers

- `SecurityHeadersMiddleware` sets HSTS, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `X-XSS-Protection`, and a
  Content-Security-Policy (`SECURITY_HEADERS_CSP`).
- `CORS_ORIGIN` restricts credentialed cross-origin requests (never `*` with
  credentials).

## Failure behavior without optional dependencies

Phase 7 intentionally avoids introducing infrastructure (no Redis/RabbitMQ/
Keycloak/MinIO/Kafka/ES/Prometheus/Grafana/WebSockets/K8s). Where a dependency is
defined but unused, the application falls back gracefully:

- **Backups**: if `podman` or the Postgres/Orthanc container is unavailable, the
  backup run transitions to `FAILED` with a recorded reason and a `BACKUP_FAILED`
  audit row — the API itself stays up. Artifact-less runs verify to `FAILED`.
- **Health `/ready`**: returns `503` with per-component `down` status without
  crashing; `/live` stays `200`.
- **Rate limiter / headers / correlation**: in-process implementations, no
  external service to fail.

## Generic error safety

The global `HttpExceptionFilter` sanitizes unhandled exceptions: production
clients get a generic `500` with a `correlationId` and no internal details; full
error context (including stack) is written only to the structured server log.

## Reporting

Report new security issues privately to the maintainers. When a secret appears
in a diff or history, follow the rotate → rewrite-histories → verify sequence
above.
