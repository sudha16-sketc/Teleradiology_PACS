# Local infrastructure

The local Compose stack contains only services used by the current application:

| Service | Purpose | Host access | Health check |
| --- | --- | --- | --- |
| PostgreSQL 16 | Prisma workflow, user, report, and audit data | `localhost:5432` (loopback only) | `pg_isready` for the application database |
| Orthanc | DICOM archive and DICOMweb server; OHIF image data remains here | REST `http://localhost:8042` (loopback); DICOM `localhost:4242` | `GET /system` |
| OHIF | DICOM viewer, proxied by the web app under `/ohif` | `http://localhost:3001` (loopback) | `wget` request to `/ohif/`; starts after Orthanc is healthy |

All containers share the Compose bridge network `axis_internal`. Containers
resolve one another by service name (`postgres:5432`, `orthanc:8042`); apps
running on the host use `localhost` and the published ports. PostgreSQL and
Orthanc data use named volumes. Compose has `unless-stopped` restart policies.
The PostgreSQL test database `axis_pacs_test` is created by the official image
init hook in `postgres/init/10-create-test-database.sh` on first initialization.

## Environment

Copy `.env.example` to `.env` and replace
`POSTGRES_PASSWORD=ReplaceThisLocalPlaceholderWithARandomSecret123456` with a
random local password. Set the same password in the API's `DATABASE_URL`; use
an alphanumeric value or percent-encode reserved characters in the URL. The
template contains placeholders only. Do not reuse them outside local
development. The API loads `apps/api/.env` when launched from its package
directory, so keep that file's `DATABASE_URL` in sync with Compose. Host-run
development uses `localhost` URLs; a future API container should use
`postgres:5432` on `axis_internal`.

Compose variables used by PostgreSQL:

| Variable | Default / purpose |
| --- | --- |
| `POSTGRES_USER` | `axis`, database owner created on initial database setup |
| `POSTGRES_PASSWORD` | Required; set in `.env`, never committed |
| `AXIS_PACS_DB` | `axis_pacs`, main application database |
| `AXIS_PACS_TEST_DB` | `axis_pacs_test`, isolated E2E database |

The official PostgreSQL image applies `POSTGRES_*` initialization values and
scripts only when the data directory is empty. Editing `.env` does not rotate
the password in an existing database. To rotate it safely, use PostgreSQL's
`ALTER ROLE` procedure and update `DATABASE_URL`; do not remove the data volume.

## Start and stop

Validate the Compose model and start the required services:

```sh
docker compose config --quiet
docker compose up -d --wait postgres orthanc ohif
docker compose ps
```

Run the Prisma migrations from the repository root after PostgreSQL is healthy:

```sh
pnpm db:generate
pnpm db:migrate:deploy
```

For interactive local schema development, `pnpm db:migrate` uses Prisma's
development migration flow. Do not run it against production data.

Pause services while preserving their containers and data:

```sh
docker compose stop
```

Stop and remove containers/networks while preserving named data volumes:

```sh
docker compose down
```

Do not add `-v` to `docker compose down`; that removes persisted databases and
DICOM data.

## Verify service and DICOM access

```sh
docker compose ps
curl -fsS http://localhost:8042/system
curl -fsS http://localhost:3001/ohif/
```

The application readiness endpoint reports PostgreSQL and Orthanc status at
`GET /api/health/ready`. The OHIF page should normally be opened through the
application's same-origin `/ohif` route so its DICOMweb requests retain the
authenticated session and pass through the API authorization proxy. DICOM
modalities can send C-STORE to port `4242`; the Orthanc HTTP administration/API
port is bound to loopback by default.

## Troubleshooting

- **Compose reports missing `POSTGRES_PASSWORD`:** copy `.env.example` to `.env`,
  set the password, and make the password portion of `DATABASE_URL` match.
- **PostgreSQL is healthy but Prisma cannot connect:** confirm the API uses the
  host URL (`localhost:5432`) and credentials from `.env`; containers should
  instead use `postgres:5432` on `axis_internal`.
- **`axis_pacs_test` is missing:** the init hook runs only for a fresh volume.
  Create it without dropping or recreating the existing database:
  `docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" axis_pacs_test'`.
  Then deploy migrations with `DATABASE_URL` pointed at `axis_pacs_test` and set
  `TEST_DATABASE_URL` to the same DSN when running the API E2E suite.
- **Orthanc does not become healthy:** inspect `docker compose logs orthanc`,
  verify `infra/orthanc/orthanc.json`, and confirm ports 8042/4242 are available.
- **OHIF is unavailable:** check `docker compose logs ohif`, wait for Orthanc's
  healthy status, and verify the viewer through the web app's `/ohif` route.
- **Credential changes have no effect:** PostgreSQL initialization variables
  are not reapplied to an existing volume. Change the role password using SQL
  and update the application's DSN.

## Services intentionally omitted

- **Keycloak:** the active implementation is NestJS session authentication
  (`axis_session`) with database-backed users and role guards. There is no OIDC
  provider integration or verified migration plan.
- **Redis:** current rate limiting and session revocation are in-process and
  designed for one API instance; nothing connects to Redis. Add a shared store
  only as part of a multi-instance design.
- **RabbitMQ:** notifications are persisted and polled from PostgreSQL; no
  broker client or async worker consumes AMQP messages.
- **MinIO:** uploaded DICOM instances are sent directly to Orthanc, which is the
  existing binary archive. No S3-compatible workflow exists.

The root `docker-compose.yml` keeps the existing OHIF build/configuration,
Orthanc config, service names, and named volume keys. This stack is for local
development and does not provide production TLS, backups, or secret management.
