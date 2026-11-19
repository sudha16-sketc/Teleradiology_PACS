# AXIS Redis

Docker-based Redis 7.4 used by the Main API for centralized session state and
small, disposable reference-data caches. The password is supplied at runtime;
nothing in this directory contains a credential.

## What is stored

- `axis:session:<jti>` — session identity, role, tenant id, authVersion and TTL.
  No password, password hash, DICOM data or report text.
- `axis:session-index:<userId>` — set of session ids for bulk revocation.
- `axis:cache:<namespace>:<tenant>:<generation>:<key>` — short-lived non-PHI
  reference data (currently hospital configuration only).

PostgreSQL remains authoritative for identity, role, status and study access.
A Redis outage returns `503` for protected requests; it never downgrades a user
or bypasses authorization.

## Local development

Add a password to `.env` (see `.env.example`), then start the infrastructure:

```sh
docker compose up -d redis
```

The service binds `127.0.0.1:6379` only. Set on the API:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
REDIS_PASSWORD=<same value as REDIS_PASSWORD in .env>
REDIS_KEY_PREFIX=axis
```

Verify:

```sh
docker compose exec redis redis-cli ping   # PONG (REDISCLI_AUTH is set)
docker compose ps redis                    # healthy
```

## Render

`render.yaml` declares `axis-redis` as a private service. It has no public URL.
The API and Redis must be in the same Render region and private network.

Set on the API service (never in source control):

```dotenv
REDIS_URL=redis://axis-redis:6379
REDIS_PASSWORD=<the generated axis-redis REDIS_PASSWORD>
REDIS_KEY_PREFIX=axis
```

If the API is managed by the same Blueprint, reference the generated password
with `fromService` (`type: pserv`, `name: axis-redis`,
`envVarKey: REDIS_PASSWORD`) instead of copying the literal value.

The service uses a paid `0.5c-512mb` plan with a 1 GB disk at `/data` (AOF plus
RDB snapshots). A filesystem disk is required: without it, all sessions are
lost on redeploy. Restarting the service with an empty disk invalidates every
existing session, which is safe but visible to users.

## Security notes

- `requirepass` is mandatory; the container refuses to start without
  `REDIS_PASSWORD`. Passwords containing quotes or backslashes are rejected.
- The rendered config is written to `/tmp/redis.conf` with mode `0600` and the
  process drops root privileges via `su-exec`.
- `FLUSHALL`, `FLUSHDB`, `KEYS` and `DEBUG` are renamed to disabled.
- `volatile-lru` evicts only TTL-bearing keys. Keep `REDIS_MAXMEMORY` below the
  plan's RAM so sessions are not reclaimed under normal load.
- Do not publish port 6379 to the public internet or give the browser a Redis
  URL. The viewer authenticates through the Main API session cookie only.
