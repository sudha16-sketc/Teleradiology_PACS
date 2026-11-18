# Axis — Teleradiology PACS Workflow & Clinical Reporting Platform

> **AXIS** is an end-to-end teleradiology PACS workflow management and clinical
> reporting platform. It orchestrates the full lifecycle of diagnostic imaging
> studies — from hospital intake through radiologist reading, report generation,
> critical finding escalation, and delivery — within a single, auditable system.

Axis is designed for teleradiology groups that manage reading workflows across
multiple hospitals. It provides real-time worklist management, structured
reporting with version control, automated routing rules, turnaround-time (TAT)
analytics, and HIPAA-aligned audit logging.

---

## Table of Contents

- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Docker Services](#docker-services)
- [Database Schema](#database-schema)
- [Orthanc & DICOMweb](#orthanc--dicomweb)
- [OHIF Viewer Integration](#ohif-viewer-integration)
- [Desktop Client (Windows)](#desktop-client-windows)
- [Synthetic Data Policy](#synthetic-data-policy)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
- [Production Considerations](#production-considerations)
- [Known Limitations](#known-limitations)
- [Project Status](#project-status)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                          │
│  React 18 · Tailwind CSS · Zustand · TanStack React Query           │
│  Worklist · Reading Room · Reports · Analytics · Admin               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  REST (JSON)
┌──────────────────────────────▼──────────────────────────────────────┐
│                         Backend (NestJS)                             │
│  Prisma ORM · Validation Pipes · Audit Interceptor                  │
│  Studies · Worklist · Reports · Users · Hospitals · Analytics · AI   │
└──┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┘
   │          │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼          ▼
┌──────┐ ┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐ ┌──────┐
│Postgr│ │Orthanc │ │ Redis  │ │RabbitMQ │ │Keycloak│ │MinIO │
│SQL 16│ │DICOMweb│ │ Cache  │ │Messaging│ │  OIDC  │ │  S3  │
│      │ │ WADO/  │ │        │ │         │ │        │ │      │
│      │ │ STOW/  │ │        │ │         │ │        │ │      │
│      │ │ QIDO   │ │        │ │         │ │        │ │      │
└──────┘ └────────┘ └────────┘ └─────────┘ └────────┘ └──────┘
```

```mermaid
graph LR
    FE["Next.js Frontend<br/>Port 3000"]
    API["NestJS API<br/>Port 4000"]
    PG["PostgreSQL 16<br/>Port 5432"]
    ORTH["Orthanc PACS<br/>Port 8042"]
    REDIS["Redis 7<br/>Port 6379"]
    RMQ["RabbitMQ 3<br/>Port 5672 / 15672"]
    KC["Keycloak 24<br/>Port 8180"]
    MINIO["MinIO<br/>Port 9000 / 9001"]
    OHIF["OHIF Viewer<br/>Port 3001"]

    FE -->|"REST API"| API
    FE -->|"DICOMweb (WADO-RS)"| ORTH
    FE -->|"OIDC Auth"| KC
    FE -->|"OHIF Viewer"| OHIF
    API -->|"Prisma ORM"| PG
    API -->|"DICOMweb Proxy"| ORTH
    API -->|"Session / Cache"| REDIS
    API -->|"Event Bus"| RMQ
    API -->|"OIDC Token Verif."| KC
    API -->|"Object Storage"| MINIO
    OHIF -->|"DICOMweb"| ORTH
```

---

## Technology Stack

| Layer          | Technology                                         |
| -------------- | -------------------------------------------------- |
| **Frontend**   | Next.js 14 (App Router), React 18, TypeScript 5.5  |
| **Styling**    | Tailwind CSS 3.4, clsx, Lucide React icons         |
| **State**      | Zustand (client), TanStack React Query (server)     |
| **Backend**    | NestJS 10, TypeScript 5.5, class-validator          |
| **ORM**        | Prisma 5.15                                        |
| **Database**   | PostgreSQL 16 (Alpine)                             |
| **PACS**       | Orthanc (jodogne/orthanc-plugins), DICOMweb        |
| **Viewer**      | OHIF Viewer (standalone)                           |
| **Desktop**     | Tauri 2 (Rust), WebView2, NSIS installer           |
| **Cache**      | Redis 7 (Alpine)                                   |
| **Messaging**  | RabbitMQ 3 (Management, Alpine)                    |
| **Auth**       | Keycloak 24 (OpenID Connect / OIDC)                |
| **Object S3**  | MinIO                                              |
| **Monorepo**   | pnpm 9+ workspaces                                 |
| **Infra**      | Docker Compose                                     |

---

## Repository Structure

```
axis-pacs/
├── apps/
│   ├── web/                          # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/                  # App Router pages
│   │   │   │   ├── (dashboard)/      # Authenticated dashboard routes
│   │   │   │   │   ├── worklist/     # Radiologist worklist
│   │   │   │   │   ├── queue/        # Personal reading queue
│   │   │   │   │   ├── reading/      # Reading room (DICOM viewer + reporting)
│   │   │   │   │   ├── reports/      # Report management & per-study reports
│   │   │   │   │   ├── hospitals/    # Hospital management & tracker
│   │   │   │   │   ├── analytics/    # TAT, modality, SLA dashboards
│   │   │   │   │   ├── audit/        # Audit log viewer
│   │   │   │   │   └── settings/     # Routing rules, AI, users, audit config
│   │   │   │   └── layout.tsx        # Root layout
│   │   │   ├── components/
│   │   │   │   ├── admin/            # RoutingRuleBuilder, AdminTabs, RoleBadge
│   │   │   │   ├── hospital/         # HospitalStudyTimeline, StudyPipeline
│   │   │   │   ├── layout/           # AppShell, NavigationRail, TopBar
│   │   │   │   ├── reading/          # OHIF placeholder, ReportPanel, SignOff
│   │   │   │   ├── report/           # ReportEditor, VersionHistory, CriticalFinding
│   │   │   │   └── ui/               # AcuityPulse, Badge, FilterBar, Skeleton
│   │   │   └── lib/
│   │   │       ├── api-client.ts     # HTTP client
│   │   │       ├── query-client.ts   # React Query setup
│   │   │       └── store.ts          # Zustand global state
│   │   ├── tailwind.config.ts
│   │   ├── next.config.mjs
│   │   └── package.json
│   │
│   ├── api/                          # NestJS backend
│   │   ├── src/
│   │   │   ├── main.ts               # Bootstrap, global prefix /api
│   │   │   ├── app.module.ts         # Root module
│   │   │   ├── prisma/               # PrismaModule, PrismaService
│   │   │   ├── studies/              # CRUD, status transitions, series
│   │   │   ├── worklist/             # Filtered list, assignment
│   │   │   ├── reports/              # Create, sign-off, amend, versioning
│   │   │   ├── users/                # User CRUD, role management
│   │   │   ├── hospitals/            # Hospital & site listing
│   │   │   ├── audit/                # Audit log queries
│   │   │   ├── analytics/            # Overview, TAT, hospital performance
│   │   │   ├── ai/                   # AI job tracking (placeholder)
│   │   │   └── common/
│   │   │       ├── filters/          # HttpExceptionFilter
│   │   │       └── interceptors/     # AuditInterceptor
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # Full database schema
│   │   │   └── seed.ts               # Synthetic seed data
│   │   └── package.json
│
│   └── desktop/                      # Tauri 2 Windows client
│       ├── src-tauri/
│       │   ├── src/
│       │   │   ├── main.rs           # Windows entry point
│       │   │   ├── lib.rs            # Window, navigation policy, plugins
│       │   │   └── server_url.rs     # Deployment URL resolution (unit tested)
│       │   ├── splash/index.html     # Shown while connecting / unconfigured
│       │   ├── capabilities/         # Grants no native access to remote content
│       │   ├── icons/                # Windows icon set
│       │   └── tauri.conf.json
│       └── package.json
│
├── packages/
│   └── types/                        # Shared TypeScript type definitions
│       ├── src/                      # Study, Report, User, Worklist, etc.
│       └── package.json
│
├── docs/
│   └── DESKTOP.md                    # Desktop architecture, config, build
│
├── infra/
│   └── orthanc/
│       └── orthanc.json              # Orthanc DICOMweb configuration
│
├── docker-compose.yml                # All infrastructure services
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── package.json                      # Root scripts (dev, build, db:*)
├── .env.example
└── .gitignore
```

---

## Local Setup

### Prerequisites

| Tool     | Minimum Version | Check Command     |
| -------- | --------------- | ----------------- |
| Node.js  | 20+             | `node --version`  |
| pnpm     | 9+              | `pnpm --version`  |
| Docker   | 24+             | `docker --version`|
| Docker Compose | v2+       | `docker compose version` |

### 1. Clone and Install

```bash
git clone <repository-url> axis-pacs
cd axis-pacs
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Review and edit `.env` as needed. The defaults work with the Docker Compose
services out of the box.

### 3. Start Infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, RabbitMQ, Orthanc, Keycloak, and MinIO.
Verify all services are healthy:

```bash
docker compose ps
```

### 4. Set Up Database

```bash
# Generate the Prisma client
pnpm db:generate

# Run migrations to create the schema
pnpm db:migrate

# Seed the database with synthetic data
pnpm db:seed
```

### 5. Start the Application

```bash
pnpm dev
```

The frontend is available at **http://localhost:3000** and the API at
**http://localhost:4000/api**.

### Available Scripts

| Command            | Description                                    |
| ------------------ | ---------------------------------------------- |
| `pnpm dev`         | Start Next.js dev server (port 3000)            |
| `pnpm build`       | Build types then Next.js production bundle      |
| `pnpm lint`        | Run ESLint across all packages                  |
| `pnpm typecheck`   | Run TypeScript type checking across all packages|
| `pnpm test`        | Run test suites across all packages             |
| `pnpm db:generate` | Generate Prisma client                          |
| `pnpm db:migrate`  | Run Prisma migrations (dev)                     |
| `pnpm db:seed`     | Seed database with synthetic data               |
| `pnpm desktop:dev` | Run the Tauri desktop shell (starts web dev too) |
| `pnpm desktop:build` | Build the desktop bundle for the host platform |
| `pnpm desktop:build:win` | Windows x64 release NSIS installer          |
| `pnpm desktop:build:win:debug` | Windows x64 debug NSIS installer       |
| `pnpm desktop:icon` | Regenerate the Tauri icon set from `source.svg`|

---

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable                   | Default                                              | Description                             |
| -------------------------- | ---------------------------------------------------- | --------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`     | `Axis`                                               | Application display name                |
| `NEXT_PUBLIC_APP_URL`      | `http://localhost:3000`                               | Optional canonical frontend origin      |
| `NODE_ENV`                 | `development`                                        | Environment mode                        |
| `NEXT_PUBLIC_API_URL`      | `http://localhost:4000/api`                           | Next.js `/api` rewrite upstream         |
| `API_PORT`                 | `4000`                                               | NestJS listen port                      |
| `DATABASE_URL`             | `postgresql://axis:axis_dev@localhost:5432/axis_pacs` | PostgreSQL connection string            |
| `NEXT_PUBLICORTHANC_URL`   | `http://localhost:8042`                               | Orthanc URL (browser, public)           |
| `ORTHANC_URL`              | `http://localhost:8042`                               | Orthanc URL (server-side)               |
| `DICOMweb_URL`             | `http://localhost:8042/dicom-web`                     | DICOMweb base URL                       |
| `ORTHANC_USERNAME`         | `orthanc`                                            | Orthanc HTTP auth username              |
| `ORTHANC_PASSWORD`         | `orthanc`                                            | Orthanc HTTP auth password              |
| `TRUST_PROXY`              | `1`                                                  | Trusted proxy hops for `X-Forwarded-For` rate limits |
| `AXIS_ORTHANC_TIMEOUT_MS`  | `30000`                                              | DICOMweb upstream request timeout        |
| `AXIS_ORTHANC_STREAM_IDLE_TIMEOUT_MS` | `60000`                                   | WADO stream idle timeout                 |
| `AXIS_ORTHANC_HEALTH_TIMEOUT_MS` | `5000`                                         | Orthanc readiness probe timeout          |
| `AXIS_ALLOW_LOOPBACK_ORTHANC` | _(unset)_                                         | Permit loopback `ORTHANC_URL` in production |
| `RESEND_API_KEY`           | _(unset)_                                            | Resend API key for password-reset email  |
| `EMAIL_FROM`               | _(unset)_                                            | Verified sender for password-reset email |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | `20`                                       | Password reset token lifetime            |
| `AUTH_RECOVERY_MAX_REQUESTS` | `5`                                               | Forgot/reset requests per window per IP and identifier |
| `AUTH_RECOVERY_WINDOW_SECONDS` | `900`                                           | Recovery rate-limit window               |
| `OHIF_URL`                 | `http://localhost:3001`                               | Next.js `/ohif` rewrite upstream        |
| `KEYCLOAK_URL`             | `http://localhost:8180`                               | Keycloak base URL                       |
| `KEYCLOAK_REALM`           | `axis`                                               | Keycloak realm name                     |
| `KEYCLOAK_CLIENT_ID`       | `axis-web`                                           | Keycloak client ID                      |
| `KEYCLOAK_CLIENT_SECRET`   | `change-me-in-production`                            | Keycloak client secret                  |
| `OIDC_ISSUER`              | `http://localhost:8180/realms/axis`                  | OIDC issuer URL                         |
| `OIDC_CLIENT_ID`           | `axis-web`                                           | OIDC client ID                          |
| `OIDC_CLIENT_SECRET`       | `change-me-in-production`                            | OIDC client secret                      |
| `REDIS_URL`                | `redis://localhost:6379`                              | Redis connection URL                    |
| `RABBITMQ_URL`             | `amqp://axis:axis_dev@localhost:5672`                 | RabbitMQ AMQP URL                       |
| `MINIO_ENDPOINT`           | `localhost`                                           | MinIO endpoint hostname                 |
| `MINIO_PORT`               | `9000`                                               | MinIO API port                          |
| `MINIO_ACCESS_KEY`         | `minioadmin`                                         | MinIO root user                         |
| `MINIO_SECRET_KEY`         | `minioadmin`                                         | MinIO root password                     |
| `MINIO_BUCKET`             | `axis-dicom`                                         | Default MinIO bucket name               |
| `AUTH_SECRET`              | `change-me-generate-a-real-secret`                   | Application auth secret                 |
| `SESSION_EXPIRY`           | `3600`                                               | Session TTL in seconds                  |
| `AXIS_DESKTOP_SERVER_URL`  | _(unset)_                                            | Desktop deployment origin (see below)   |
| `NEXT_PUBLIC_DESKTOP_API_URL` | _(unset)_                                        | Escape hatch only — leave empty         |

Password recovery requires `RESEND_API_KEY` and `EMAIL_FROM` on the API host.
The API returns `503` instead of a fake success when email delivery is not
configured or the provider fails. `/forgot-password` and `/reset-password` are
public web routes; all other application routes still require a session.

Phone numbers accept 10 digits (stored as `+91<number>`), `+91` followed by 10
digits, or an international `+` number with 8–15 digits. Spaces, letters and
other separators are rejected; the value is normalized before it is stored.

### Vercel web deployment

Configure these non-secret environment variables in the Vercel project for each
deployment environment:

- `NEXT_PUBLIC_API_URL`: the deployed API origin or API base URL ending in
  `/api`; an origin-only value is normalized to `/api` by the rewrite.
- `OHIF_URL`: the deployed OHIF service origin.

Both are read while Next.js builds the rewrites. Vercel builds fail if either is
missing, points to localhost/loopback, or does not use HTTPS; do not set these
to the local-development values from `.env.example`. `NEXT_PUBLIC_APP_URL` is
optional and may be set to the canonical frontend origin. Keep backend-only
secrets such as `DATABASE_URL` and `AUTH_SECRET` on the API host, not in the web
project.

### Render API deployment

Deploy the API from the monorepo root so pnpm can resolve workspace packages:

- **Root Directory:** `.`
- **Build Command:** `pnpm install --frozen-lockfile && pnpm run build`
- **Start Command:** `pnpm --filter @axis/api start:prod`

The root build generates Prisma Client from `apps/api/prisma/schema.prisma`,
builds `@axis/types`, and compiles the API. To build the web app separately,
run `pnpm run build:web`; its deployment also requires the web upstream settings
documented above.

Set the API's production environment variables in Render: `DATABASE_URL`,
`AUTH_SECRET`, `CORS_ORIGIN`, `TRUST_PROXY=1`, `ORTHANC_URL`, and the Resend
settings. Render supplies `PORT`; the API listens on it. Configure additional
integrations such as Redis, RabbitMQ, Keycloak, or object storage only when
enabled for that deployment.

Deploy Orthanc as a private service alongside the API. `render.yaml` contains a
starter service (`axis-orthanc`) using `infra/orthanc/Dockerfile.prod` with a
persistent disk; set `ORTHANC_URL` on the API to that service's internal
`host:port`. Do not point production at `localhost` — startup validation rejects
loopback URLs unless `AXIS_ALLOW_LOOPBACK_ORTHANC=1` is explicitly set for a
local production-mode test.

`/api/health/ready` returns `200` when PostgreSQL is reachable and includes an
`orthanc` component diagnostic. If Orthanc is down, the response includes
`"status":"degraded"` but reports/worklists remain available; viewer requests
return a sanitized `503`/`504` with a correlation ID instead of failing the
whole API. Verify the deployed service with `curl https://<api-host>/api/health/ready`.

---

## Docker Services

All services are defined in `docker-compose.yml` and can be started with
`docker compose up -d`.

| Service      | Image                                    | Ports                      | Purpose                                  |
| ------------ | ---------------------------------------- | -------------------------- | ---------------------------------------- |
| **postgres** | `postgres:16-alpine`                     | `5432`                     | Primary relational database              |
| **redis**    | `redis:7-alpine`                         | `6379`                     | Session cache, rate limiting, pub/sub    |
| **rabbitmq** | `rabbitmq:3-management-alpine`           | `5672`, `15672` (console)  | Async event messaging / job queues       |
| **orthanc**  | `jodogne/orthanc-plugins:latest`         | `8042` (HTTP), `4242` (DICOM) | DICOM archive & DICOMweb server      |
| **keycloak** | `quay.io/keycloak/keycloak:24.0`        | `8180`                     | OpenID Connect identity provider         |
| **minio**    | `minio/minio:latest`                     | `9000` (API), `9001` (console) | S3-compatible object storage         |

### Service URLs (Development)

| Service       | URL                                    |
| ------------- | -------------------------------------- |
| Frontend      | http://localhost:3000                   |
| API           | http://localhost:4000/api               |
| Orthanc       | http://localhost:8042                   |
| Keycloak      | http://localhost:8180/auth              |
| MinIO Console | http://localhost:9001                   |
| RabbitMQ Mgmt | http://localhost:15672                  |

### Volumes

Persistent data is stored in named Docker volumes:

- `postgres_data` — PostgreSQL data files
- `orthanc_data` — Orthanc DICOM database
- `keycloak_data` — Keycloak realm/user data
- `minio_data` — MinIO object storage

---

## Database Schema

The Prisma schema (`apps/api/prisma/schema.prisma`) defines the following
core models:

### Core Entities

| Model            | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| `User`           | Platform users with roles (Admin, Coordinator, Radiologist, Technician, Hospital User) |
| `Hospital`       | Hospital organizations with timezone and sites                |
| `Site`           | Physical locations within a hospital                          |
| `Patient`        | Patient demographics linked to a hospital                     |
| `Study`          | DICOM imaging studies with metadata, priority, status, SLA   |
| `Series`         | DICOM series within a study                                   |
| `Instance`       | Individual DICOM instances (slices/frames)                    |
| `WorklistItem`   | Reading queue entry tracking TAT and SLA                      |
| `Report`         | Clinical reports with versioning and critical finding flags   |
| `ReportVersion`  | Immutable version snapshots of reports                        |
| `AuditLog`       — HIPAA-aligned audit trail of all actions           |
| `RoutingRule`    | Automated study routing rules (conditions + actions as JSON)  |
| `DeliveryAttempt`| Report delivery attempts to hospitals                         |
| `AIJob`          | AI/ML processing job tracking (anatomy detection, screening) |

### Key Enums

| Enum            | Values                                                             |
| --------------- | ------------------------------------------------------------------ |
| `UserRole`      | `ADMIN`, `COORDINATOR`, `RADIOLOGIST`, `TECHNICIAN`, `HOSPITAL_USER` |
| `StudyStatus`   | `NEW`, `VALIDATED`, `UNASSIGNED`, `ASSIGNED`, `IN_READING`, `FINAL`, `AMENDED`, `DELIVERED` |
| `StudyPriority` | `STAT`, `URGENT`, `ROUTINE`                                        |
| `ReportStatus`  | `DRAFT`, `PENDING_SIGNOFF`, `FINAL`, `AMENDED`                     |
| `Modality`      | `CT`, `MRI`, `XR`, `US`, `NM`, `PET`, `MG`, `DX`, `CR`, `Fluoro`  |
| `Subspecialty`  | `NEURO`, `MSK`, `CHEST`, `ABDOMEN`, `CARDIOVASCULAR`, `MAMMOGRAPHY`, `MUSCULOSKELETAL`, `GENERAL`, `PEDIATRIC`, `ONCOLOGY`, `INTERVENTIONAL` |

### Study Status Lifecycle

```
NEW → VALIDATED → UNASSIGNED → ASSIGNED → IN_READING → FINAL → AMENDED → DELIVERED
```

---

## Orthanc & DICOMweb

Axis uses [Orthanc](https://www.orthanc-server.com/) as its DICOM archive
and DICOMweb server. The configuration is in `infra/orthanc/orthanc.json`.

### DICOMweb Endpoints

| Operation  | Method | Endpoint                          |
| ---------- | ------ | --------------------------------- |
| Search     | GET    | `/dicom-web/studies`              |
| Study metadata | GET | `/dicom-web/studies/{uid}`     |
| Series list | GET   | `/dicom-web/studies/{uid}/series` |
| Instances  | GET    | `/dicom-web/series/{uid}/instances` |
| Retrieve   | GET    | `/dicom-web/studies/{uid}` (Accept: multipart/related) |
| Store      | POST   | `/dicom-web/stow-rs/studies`      |

### Orthanc Configuration Highlights

- DICOMweb is enabled with QIDO-RS, WADO-RS, and STOW-RS
- All DICOMweb endpoints are rooted at `/dicom-web`
- DICOM C-STORE listener on port `4242`
- Authentication is disabled by default for local development
- Default credentials: `orthanc` / `orthanc`

### Uploading Test DICOM Data

You can push DICOM files to Orthanc via STOW-RS:

```bash
curl -X POST http://localhost:8042/dicom-web/stow-rs/studies \
  -u orthanc:orthanc \
  -H "Content-Type: multipart/related; type=application/dicom" \
  --data-binary @path/to/dicom-file.dcm
```

---

## OHIF Viewer Integration

Axis builds OHIF v3.13.0 from `infra/ohif/Dockerfile`. The image rebases the
viewer assets to `/ohif/`; its `app-config.js` sends QIDO-RS and WADO-RS through
the Axis API's `/api/dicom-web` proxy. That proxy enforces the signed-in user's
permissions and forwards to Orthanc using the API's `ORTHANC_URL`.

For production, deploy the Dockerfile as its own Render Web Service and set the
Vercel web app's `OHIF_URL` to that service's HTTPS origin. The existing
same-origin Vercel rewrites serve the viewer at `/ohif` and DICOMweb at `/api`,
so the browser keeps the first-party Axis session cookie. Do not configure the
viewer to call Orthanc directly or use a localhost URL in production. If the
QIDO preflight fails, the viewer shows an actionable imaging error instead of a
blank viewer; the message and logs contain only a safe route and correlation ID.

The Render service's own `/ohif/` URL serves the viewer assets, but direct
access to that service does not provide authenticated DICOM access: the API
session cookie is scoped to the Axis frontend origin and uses `SameSite=Lax`.
Open studies through the Axis frontend so its `/ohif` and `/api` rewrites remain
same-origin. The active viewer configuration uses WADO-RS; no WADO-URI route is
provided by the Axis DICOMweb proxy.

For local development, Docker Compose exposes OHIF on port `3001`. Use the
frontend's `http://localhost:3000/ohif` route for authenticated DICOM access;
the direct `:3001` URL is only a static viewer preview because the session is
first-party to the frontend origin.

---

## Desktop Client (Windows)

`apps/desktop` is a [Tauri 2](https://tauri.app) application that opens a native
WebView2 window against a running Axis deployment. It is a window around the
existing product — no second backend, no second auth, no offline store. Every
workflow, authorization decision and clinical data path stays in the NestJS API.

Full documentation: **[docs/DESKTOP.md](docs/DESKTOP.md)**.

### Quick start

```bash
pnpm install
pnpm desktop:dev            # starts the web dev server + the desktop window
pnpm desktop:build:win      # Windows x64 release NSIS installer
```

Requires Rust >= 1.77.2 and the MSVC build tools on Windows.

### The window loads a remote deployment, and that is deliberate

The frontend is **not** bundled into the executable. Session state is an httpOnly
`axis_session` cookie issued with `sameSite=lax`, and the API carries no CSRF
token. A UI bundled into a Tauri app is served from `http://tauri.localhost`,
which is cross-site with any real API host — browsers refuse to attach a
`SameSite=Lax` cookie to such a request, so **login would silently fail**. Making
a bundled build work would require reissuing the cookie as
`SameSite=None; Secure` or enabling a CORS + CSRF surface, both of which weaken
the browser client too.

Loading the deployment keeps the client same-origin with the API, so the existing
cookie, `SameSite=Lax`, RBAC, hospital/radiologist isolation and audit logging
apply unchanged. A static export is not an alternative either: three dynamic
routes (`hospitals/reports/[studyUid]`, `reading/[studyUid]`,
`reports/[studyUid]`) have no `generateStaticParams` and are server-rendered on
demand.

The trade-off is that the client needs a reachable deployment — which is also how
clinical viewers are normally shipped, since one installer then stays correct when
the UI is updated.

### Pointing it at a deployment

First valid source wins:

| # | Source                                     | Scope                      |
| - | ------------------------------------------ | -------------------------- |
| 1 | `AXIS_DESKTOP_SERVER_URL` env var           | read at launch             |
| 2 | `desktop.json` in the app config dir        | per-machine — **use this** |
| 3 | `AXIS_DESKTOP_SERVER_URL` at compile time  | baked into the binary      |
| 4 | `http://localhost:3000`                    | debug builds only          |

A release build with none of these set shows a bundled splash explaining how to
configure itself — it never guesses.

On Windows the config file is:

```text
%APPDATA%\com.axis.teleradiology.pacs\desktop.json
```

```json
{ "serverUrl": "https://pacs.example.org" }
```

The value must be a bare origin (optionally with a port). Path prefixes, query
strings, fragments and embedded credentials are rejected.

### Native surface

`capabilities/default.json` grants an **empty** permission list and declares no
`remote.urls`, so the deployment the user signs in to has **zero** access to
Tauri APIs — no filesystem, no shell, no clipboard, no commands. The navigation
allow-list restricts the window to the deployment origin; off-origin links open
in the system browser. A second launch focuses the existing window instead of
opening a second one.

No clinical data is written to the machine: there is no SQLite, no local cache
and no PHI on disk outside the OS-encrypted WebView2 cookie store.

---

## Synthetic Data Policy

All seed data is **explicitly synthetic** and must never be confused with
real patient data. Axis follows these conventions:

### Naming Conventions

- **Hospitals**: Names prefixed with `AX-SYN` (e.g., `AX-SYN City General Hospital`)
- **Hospital codes**: Prefixed with `AX-` (e.g., `AX-CGH`, `AX-MMC`)
- **Patient IDs**: `AX-SYN-PAT-XXXX` format
- **Accession numbers**: `AX-SYN-ACC-XXXXXX` format
- **Patient display names**: `AX-SYN Patient N`
- **User display names**: `AX-SYN Admin User`, `AX-SYN Dr. Radiologist`
- **Study descriptions**: `AX-SYN {Modality} {Subspecialty} Study N`
- **Referring physicians**: `Dr. AX-SYN Referrer N`
- **Email domains**: `@axis-synthetic.example.com`
- **Audit metadata**: Includes `{ "synthetic": true }` marker
- **User agent strings**: `AX-SYN-Seed/1.0`

### Seed Data Summary

| Entity    | Count | Prefix        |
| --------- | ----- | ------------- |
| Hospitals | 3     | `AX-SYN`      |
| Sites     | 4     | `AX-`         |
| Users     | 2     | `AX-SYN`      |
| Patients  | 10    | `AX-SYN-PAT`  |
| Studies   | 10    | `AX-SYN-ACC`  |
| Reports   | 3     | `AX-SYN`      |
| Audit logs| 5     | `AX-SYN`      |

---

## Authentication

Axis uses [Keycloak](https://www.keycloak.org/) as its OpenID Connect (OIDC)
identity provider.

### Configuration

| Setting          | Value                                    |
| ---------------- | ---------------------------------------- |
| Keycloak URL     | `http://localhost:8180/auth`             |
| Realm            | `axis`                                   |
| Client ID        | `axis-web`                               |
| Redirect URI     | `http://localhost:3000`                  |
| Scopes           | `openid`, `profile`, `email`             |

### Initial Keycloak Setup

1. Access the Keycloak Admin Console at `http://localhost:8180/auth/admin`
   - Username: `admin`
   - Password: `admin`
2. Create the `axis` realm
3. Register the `axis-web` client with OIDC protocol
4. Configure redirect URIs for `http://localhost:3000/*`
5. Create initial users and assign roles matching the database schema

### User Roles

| Role           | Access Level                                          |
| -------------- | ----------------------------------------------------- |
| `ADMIN`        | Full platform access, user management, routing rules  |
| `COORDINATOR`  | Worklist management, study assignment, delivery       |
| `RADIOLOGIST`  | Reading room, report creation/sign-off                |
| `TECHNICIAN`   | Study upload, validation, status updates              |
| `HOSPITAL_USER`| View-only access for their hospital's studies         |

---

## API Endpoints

All endpoints are prefixed with `/api`. The NestJS backend runs on port `4000`.

### Studies

| Method | Endpoint                         | Description                   |
| ------ | -------------------------------- | ----------------------------- |
| GET    | `/api/studies`                   | List studies (filterable)     |
| GET    | `/api/studies/:studyUid`         | Get study by Study Instance UID |
| GET    | `/api/studies/:studyUid/series`  | Get series for a study        |
| PATCH  | `/api/studies/:studyUid/status`  | Update study status           |

### Worklist

| Method | Endpoint                              | Description               |
| ------ | ------------------------------------- | ------------------------- |
| GET    | `/api/worklist`                       | List worklist (filterable) |
| POST   | `/api/worklist/:studyUid/assign`      | Assign study to radiologist |

### Reports

| Method | Endpoint                          | Description               |
| ------ | --------------------------------- | ------------------------- |
| GET    | `/api/reports`                    | List all reports          |
| GET    | `/api/reports/:studyUid`          | Get report for a study    |
| POST   | `/api/reports/:studyUid`          | Create or update a report |
| POST   | `/api/reports/:studyUid/sign`     | Sign off a report         |
| POST   | `/api/reports/:studyUid/amend`    | Amend a finalized report  |

### Users

| Method | Endpoint           | Description           |
| ------ | ------------------ | --------------------- |
| GET    | `/api/users`       | List all users        |
| GET    | `/api/users/:id`   | Get user by ID        |
| POST   | `/api/users`       | Create a new user     |
| PATCH  | `/api/users/:id`   | Update a user         |

### Hospitals

| Method | Endpoint            | Description           |
| ------ | ------------------- | --------------------- |
| GET    | `/api/hospitals`    | List all hospitals    |
| GET    | `/api/hospitals/:id`| Get hospital by ID    |

### Analytics

| Method | Endpoint                           | Description                |
| ------ | ---------------------------------- | -------------------------- |
| GET    | `/api/analytics/overview`          | Platform overview metrics  |
| GET    | `/api/analytics/tat`               | Turnaround time distribution |
| GET    | `/api/analytics/hospital-performance` | Per-hospital performance metrics |

### Audit

| Method | Endpoint       | Description                           |
| ------ | -------------- | ------------------------------------- |
| GET    | `/api/audit`   | List audit log entries (paginated)    |

### AI Jobs

| Method | Endpoint            | Description              |
| ------ | ------------------- | ------------------------ |
| GET    | `/api/ai/jobs`      | List AI processing jobs  |
| GET    | `/api/ai/jobs/:id`  | Get a specific AI job    |

---

## Production Considerations

### Security

- [ ] Replace all default credentials and secrets in `.env`
- [ ] Enable Orthanc authentication (`AuthenticationEnabled: true`)
- [ ] Configure Keycloak with TLS and production realm settings
- [ ] Set `AUTH_SECRET` to a cryptographically random value (min 32 chars)
- [ ] Enable HTTPS behind a reverse proxy (nginx, Caddy, Traefik)
- [ ] Restrict CORS origins to your production domain
- [ ] Implement rate limiting on API endpoints
- [ ] Enable PostgreSQL SSL connections
- [ ] Rotate MinIO access keys

### Infrastructure

- [ ] Use a managed PostgreSQL service (RDS, Cloud SQL, Azure Database)
- [ ] Deploy Redis with persistence and authentication enabled
- [ ] Use a managed RabbitMQ service or deploy with clustering
- [ ] Configure Orthanc with TLS and proper DICOM TLS for receiving
- [ ] Set up MinIO with erasure coding for production durability
- [ ] Configure Docker Compose health checks for orchestrator integration
- [ ] Set up log aggregation (ELK, Datadog, CloudWatch)

### Performance

- [ ] Enable Next.js ISR/caching for static-heavy pages
- [ ] Configure connection pooling for PostgreSQL (PgBouncer)
- [ ] Add Redis caching for frequently accessed study metadata
- [ ] Use CDN for Orthanc WADO-RS image delivery
- [ ] Optimize Orthanc database settings for expected study volume

### Compliance

- [ ] Ensure audit logging captures all PHI access events
- [ ] Configure report delivery encryption in transit
- [ ] Implement automatic session timeout enforcement
- [ ] Set up data retention policies for audit logs
- [ ] Document BAA requirements for cloud infrastructure providers

---

## Known Limitations

| Area               | Status                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| **OHIF Viewer**    | Placeholder component only (`OHIFViewerPlaceholder`). Full iframe/embed integration is pending. |
| **Mock Data**      | All data is seeded synthetic data prefixed with `AX-SYN`. No real clinical data is included. |
| **Authentication** | Keycloak is provisioned but full OIDC middleware (guards, token verification, session management) is not yet wired into the NestJS API or Next.js frontend. |
| **Authorization**  | Role-based access control is defined in the schema but route guards are not yet implemented. |
| **AI Integration** | AI job model and endpoints exist as placeholders. No actual ML inference pipelines are connected. |
| **Report Delivery**| DeliveryAttempt model exists. Actual delivery mechanisms (HL7, FHIR, email, fax) are not implemented. |
| **Routing Rules**  | RoutingRule model and UI (RoutingRuleBuilder) exist. The rule engine that evaluates conditions and triggers actions is not yet built. |
| **Real-time Updates** | WebSocket/SSE support for live worklist updates is not implemented. |
| **Testing**        | Test infrastructure (Vitest) is configured but comprehensive test coverage is not yet in place. |
| **Desktop client** | Windows x64 foundation only. The frontend is not bundled (the window loads a deployment — see [Desktop Client](#desktop-client-windows)), so the client needs network access and cannot start a session with the API unreachable. No code signing, no auto-update, and the installer has not been built end-to-end yet. |
| **CI/CD**          | No GitHub Actions or pipeline configuration exists yet. |

---

## Project Status

### Implementation Checklist

#### Completed

- [x] pnpm monorepo setup (`apps/web`, `apps/api`, `apps/desktop`, `packages/types`)
- [x] Docker Compose infrastructure (PostgreSQL, Redis, RabbitMQ, Orthanc, Keycloak, MinIO)
- [x] Orthanc DICOMweb configuration (QIDO-RS, WADO-RS, STOW-RS)
- [x] Prisma schema with 14 models, enums, and indexes
- [x] Database seed script with synthetic data (`AX-SYN` prefixed)
- [x] NestJS API — Studies, Worklist, Reports, Users, Hospitals, Audit, Analytics, AI modules
- [x] Report lifecycle: create, sign-off, amend with versioning
- [x] Audit logging with `AuditInterceptor`
- [x] Next.js 14 App Router frontend with Tailwind CSS
- [x] Dashboard layout: NavigationRail, TopBar, AppShell
- [x] Worklist page with filters (status, priority, modality, hospital)
- [x] Reading room with OHIF placeholder, report panel, sign-off controls
- [x] Report editor with version history, critical finding toggle
- [x] Hospital management with study timeline and pipeline visualization
- [x] Analytics dashboard (overview metrics, TAT, hospital performance)
- [x] Audit log viewer with pagination
- [x] Admin settings pages (routing rules, AI, users, audit config)
- [x] Shared TypeScript types package (`@axis/types`)
- [x] Zustand global state + TanStack React Query data fetching
- [x] Tauri 2 desktop foundation (`apps/desktop`): Windows x64 NSIS target, single-instance lock, deployment URL resolution, navigation allow-list, zero native capabilities for remote content
- [x] Platform abstraction (`apps/web/src/lib/platform.ts`) with unit tests, so web and desktop share one frontend with no duplicated URL logic

#### In Progress

- [ ] Keycloak OIDC integration (guards, token verification)
- [ ] OHIF viewer full embedding
- [ ] Real-time worklist updates (WebSocket/SSE)

#### Planned

- [ ] Route-level authorization guards
- [ ] AI inference pipeline integration
- [ ] Report delivery mechanisms (HL7/FHIR)
- [ ] Automated routing rule engine
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Comprehensive test suite
- [ ] Production deployment guides

---

## License

This project is private and proprietary. All rights reserved.
