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
| **Viewer**     | OHIF Viewer (standalone)                           |
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
│   └── api/                          # NestJS backend
│       ├── src/
│       │   ├── main.ts               # Bootstrap, global prefix /api
│       │   ├── app.module.ts         # Root module
│       │   ├── prisma/               # PrismaModule, PrismaService
│       │   ├── studies/              # CRUD, status transitions, series
│       │   ├── worklist/             # Filtered list, assignment
│       │   ├── reports/              # Create, sign-off, amend, versioning
│       │   ├── users/                # User CRUD, role management
│       │   ├── hospitals/            # Hospital & site listing
│       │   ├── audit/                # Audit log queries
│       │   ├── analytics/            # Overview, TAT, hospital performance
│       │   ├── ai/                   # AI job tracking (placeholder)
│       │   └── common/
│       │       ├── filters/          # HttpExceptionFilter
│       │       └── interceptors/     # AuditInterceptor
│       ├── prisma/
│       │   ├── schema.prisma         # Full database schema
│       │   └── seed.ts               # Synthetic seed data
│       └── package.json
│
├── packages/
│   └── types/                        # Shared TypeScript type definitions
│       ├── src/                      # Study, Report, User, Worklist, etc.
│       └── package.json
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

---

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable                   | Default                                              | Description                             |
| -------------------------- | ---------------------------------------------------- | --------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`     | `Axis`                                               | Application display name                |
| `NEXT_PUBLIC_APP_URL`      | `http://localhost:3000`                               | Frontend base URL                       |
| `NODE_ENV`                 | `development`                                        | Environment mode                        |
| `NEXT_PUBLIC_API_URL`      | `http://localhost:4000/api`                           | API base URL (browser)                  |
| `API_PORT`                 | `4000`                                               | NestJS listen port                      |
| `DATABASE_URL`             | `postgresql://axis:axis_dev@localhost:5432/axis_pacs` | PostgreSQL connection string            |
| `NEXT_PUBLICORTHANC_URL`   | `http://localhost:8042`                               | Orthanc URL (browser, public)           |
| `ORTHANC_URL`              | `http://localhost:8042`                               | Orthanc URL (server-side)               |
| `DICOMweb_URL`             | `http://localhost:8042/dicom-web`                     | DICOMweb base URL                       |
| `ORTHANC_USERNAME`         | `orthanc`                                            | Orthanc HTTP auth username              |
| `ORTHANC_PASSWORD`         | `orthanc`                                            | Orthanc HTTP auth password              |
| `NEXT_PUBLIC_OHIF_URL`     | `http://localhost:3001`                               | OHIF Viewer URL (browser)               |
| `OHIF_URL`                 | `http://localhost:3001`                               | OHIF Viewer URL (server-side)           |
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

Axis integrates with the [OHIF Viewer](https://ohif.org/) for interactive
DICOM image viewing within the reading room.

### Setup

The OHIF Viewer runs as a standalone application (default port `3001`).
Configure its DICOMweb source to point at the Orthanc instance:

```bash
# In your OHIF config (.env or config.json):
DICOM_WEB_ROOT=http://localhost:8042/dicom-web
```

### Embedding in the Reading Room

The reading room page (`/reading/[studyUid]`) includes an
`OHIFViewerPlaceholder` component that will be replaced with a full
`<iframe>` or modal embed once the OHIF instance is configured. The viewer
receives the study UID and loads images via DICOMweb WADO-RS.

### Launching OHIF Locally

```bash
# Using Docker (recommended)
docker run -d -p 3001:80 \
  -e DICOM_WEB_ROOT=http://host.docker.internal:8042/dicom-web \
  ohif/viewer:latest

# Or build from source
git clone https://github.com/OHIF/Viewers.git
cd Viewers
pnpm install
pnpm run dev
```

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
| **CI/CD**          | No GitHub Actions or pipeline configuration exists yet. |

---

## Project Status

### Implementation Checklist

#### Completed

- [x] pnpm monorepo setup (`apps/web`, `apps/api`, `packages/types`)
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
