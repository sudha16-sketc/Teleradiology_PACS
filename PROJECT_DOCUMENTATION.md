# Axis — Complete Project Documentation

> **AXIS** is a teleradiology PACS workflow management and clinical reporting platform.
> It manages the entire lifecycle of diagnostic imaging studies — from hospital intake
> through radiologist reading, report generation, critical finding escalation, and
> delivery — within a single, auditable system.

This document covers everything: what was built, how it works, the architecture,
workflows, data flows, user flows, how to run it locally from scratch, and a
complete file structure with descriptions.

---

## Table of Contents

1. [What Axis Is](#1-what-axis-is)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [How It All Connects](#5-how-it-all-connects)
6. [Workflow — The Study Lifecycle](#6-workflow--the-study-lifecycle)
7. [Data Flow](#7-data-flow)
8. [User Flows](#8-user-flows)
9. [Frontend Deep Dive](#9-frontend-deep-dive)
10. [Backend Deep Dive](#10-backend-deep-dive)
11. [Database Schema](#11-database-schema)
12. [Design System](#12-design-system)
13. [Running Locally From Scratch](#13-running-locally-from-scratch)
14. [Docker Services Reference](#14-docker-services-reference)
15. [API Reference](#15-api-reference)
16. [Synthetic Data](#16-synthetic-data)
17. [What Works vs. What Needs External Infrastructure](#17-what-works-vs-what-needs-external-infrastructure)
18. [Production Considerations](#18-production-considerations)

---

## 1. What Axis Is

Axis is a **radiology reading workflow platform** — not a DICOM archive, not an
image viewer, not a generic admin dashboard. It sits *around* the imaging
infrastructure and manages the **human workflow**:

```
Hospital sends imaging study
        ↓
Axis validates and indexes metadata
        ↓
Routing rules assign it to the right radiologist
        ↓
Radiologist sees it in their worklist
        ↓
Radiologist opens the study → OHIF viewer loads images from Orthanc
        ↓
Radiologist writes a report in the Axis report editor
        ↓
Radiologist signs off → Report becomes FINAL
        ↓
Report is delivered to the hospital
        ↓
Hospital can view/download it in their portal
        ↓
Everything is audit-logged
```

Axis does **not** reinvent DICOM storage, image rendering, or diagnostic viewing.
It uses:
- **Orthanc** for DICOM storage and DICOMweb APIs
- **OHIF** for interactive diagnostic image viewing
- **PostgreSQL** for workflow metadata, reports, and audit
- **Keycloak** for authentication

Axis owns everything else: the worklist, the routing, the reporting, the
sign-off workflow, the audit trail, the analytics, and the hospital portal.

---

## 2. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js 14)                       │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │Worklist  │ │Reading Room│ │Reports   │ │Hospital  │ │Admin    │ │
│  │          │ │(OHIF+Meta) │ │Editor    │ │Portal    │ │Console  │ │
│  └──────────┘ └────────────┘ └──────────┘ └──────────┘ └─────────┘ │
│  State: Zustand (client) + TanStack Query (server)                  │
│  Styling: Tailwind CSS + CSS custom properties                      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │  REST API (JSON)       │
                    │  GET/POST/PATCH/DELETE  │
                    └───────────┬───────────┘
                                │
┌───────────────────────────────┴──────────────────────────────────────┐
│                         BACKEND (NestJS 10)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │Studies   │ │Worklist  │ │Reports   │ │Users/    │ │Audit/    │  │
│  │Module    │ │Module    │ │Module    │ │Hospitals │ │Analytics │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│  ORM: Prisma 5  |  Validation: class-validator  |  Logging: Audit  │
└──┬────────┬────────┬────────┬────────┬────────┬────────┬───────────┘
   │        │        │        │        │        │        │
   ▼        ▼        ▼        ▼        ▼        ▼        ▼
┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
│Postgr││Orthan││Redis ││Rabbit││Keycl ││MinIO ││OHIF  │
│eSQL  ││c     ││      ││MQ    ││ock   ││      ││Viewer│
│:5432 ││:8042 ││:6379 ││:5672 ││:8180 ││:9000 ││:3001 │
└──────┘└──────┘└──────┘└──────┘└──────┘└──────┘└──────┘
```

### How Each Piece Connects

| Connection | Protocol | Purpose |
|---|---|---|
| Frontend → Backend | REST/JSON over HTTP | All CRUD, workflow operations |
| Frontend → OHIF | iframe / redirect | DICOM image viewing |
| Frontend → Keycloak | OIDC / OAuth2 | User authentication |
| Backend → PostgreSQL | Prisma TCP | Metadata persistence |
| Backend → Orthanc | DICOMweb (HTTP) | Study metadata queries |
| Orthanc → Scanner | DICOM C-STORE (TCP :4242) | Receive images from modality |
| OHIF → Orthanc | DICOMweb WADO-RS | Load images for display |
| Backend → Redis | TCP | Session cache, rate limiting |
| Backend → RabbitMQ | AMQP | Async job queues, events |
| Backend → MinIO | S3 API | Object storage |
| Keycloak → Frontend | OIDC tokens | Session management |

---

## 3. Technology Stack

| Layer | Technology | Version | Role |
|---|---|---|---|
| **Monorepo** | pnpm workspaces | 9.x | Package management |
| **Frontend** | Next.js (App Router) | 14.2 | React framework, SSR, routing |
| **UI Library** | React | 18.3 | Component rendering |
| **Language** | TypeScript | 5.5 | Type safety across all packages |
| **Styling** | Tailwind CSS | 3.4 | Utility-first CSS |
| **Client State** | Zustand | 4.5 | UI state (rail, filters, selection) |
| **Server State** | TanStack React Query | 5.50 | API data fetching, caching |
| **Icons** | Lucide React | 0.400 | Consistent icon set |
| **Utilities** | clsx, date-fns | 2.1 / 3.6 | Conditional classes, date formatting |
| **Backend** | NestJS | 10.3 | Node.js API framework |
| **ORM** | Prisma | 5.15 | Database access, migrations |
| **Database** | PostgreSQL | 16 | Primary data store |
| **PACS** | Orthanc | latest | DICOM archive + DICOMweb |
| **Viewer** | OHIF | latest | Diagnostic DICOM viewer |
| **Cache** | Redis | 7 | Session, caching, pub/sub |
| **Queue** | RabbitMQ | 3 | Async messaging |
| **Auth** | Keycloak | 24.0 | OIDC identity provider |
| **Object Store** | MinIO | latest | S3-compatible file storage |
| **Infrastructure** | Docker Compose | 3.9 | Local development services |

---

## 4. Repository Structure

Every file in the repository with its purpose:

```
Teleradiology_PACS/
│
├── package.json                          # Monorepo root: scripts (dev, build, lint, typecheck, db:*)
├── pnpm-workspace.yaml                   # Declares workspaces: apps/*, packages/*
├── pnpm-lock.yaml                        # Locked dependency versions
├── .env.example                          # All environment variables with defaults
├── .gitignore                            # Ignores node_modules, .next, dist, .env, etc.
├── docker-compose.yml                    # 6 infrastructure services
├── README.md                             # This documentation file
│
├── infra/
│   └── orthanc/
│       └── orthanc.json                  # Orthanc DICOMweb config (QIDO/WADO/STOW enabled)
│
├── packages/
│   └── types/                            # @axis/types — Shared TypeScript definitions
│       ├── package.json                  # ESM package, builds with tsc
│       ├── tsconfig.json                 # Strict TS, ES2022, NodeNext
│       └── src/
│           ├── index.ts                  # Barrel export of all types
│           ├── study.ts                  # Study, Series, Instance, Modality, StudyStatus, etc.
│           ├── patient.ts               # Patient interface
│           ├── user.ts                  # User, UserRole
│           ├── hospital.ts             # Hospital, Site
│           ├── report.ts               # Report, ReportVersion, ReportTemplate, ReportStatus
│           ├── worklist.ts             # WorklistItem, WorklistFilters, WorklistSort
│           ├── audit.ts                # AuditLogEntry, AuditAction, AuditResource
│           ├── routing.ts              # RoutingRule, RoutingCondition, RoutingAction
│           ├── delivery.ts             # DeliveryAttempt, DeliveryStatus
│           ├── ai.ts                   # AIJob, AIJobStatus, AITaskType
│           ├── analytics.ts            # Analytics types (TAT, modality, hospital perf, SLA)
│           └── api.ts                  # ApiResponse<T>, ApiError, PaginationParams
│
├── apps/
│   ├── web/                              # @axis/web — Next.js 14 frontend
│   │   ├── package.json                  # Dependencies: Next.js, React, TanStack Query, Zustand, Lucide
│   │   ├── tsconfig.json                 # Strict TS, path alias @/* → ./src/*
│   │   ├── next.config.mjs               # Transpiles @axis/types
│   │   ├── tailwind.config.ts            # Custom theme: CSS variable colors, Inter/IBM Plex Mono fonts
│   │   ├── postcss.config.js             # Tailwind + Autoprefixer
│   │   ├── .eslintrc.json               # next/core-web-vitals + next/typescript
│   │   └── src/
│   │       ├── app/
│   │       │   ├── globals.css           # CSS variables, design tokens, Acuity Pulse keyframes
│   │       │   ├── layout.tsx            # Root layout: fonts (Inter, IBM Plex Mono, Inter Tight, Source Serif 4)
│   │       │   ├── page.tsx              # Landing page: "Axis" title + "Open Worklist" link
│   │       │   ├── providers.tsx         # TanStack Query provider wrapper
│   │       │   └── (dashboard)/          # Route group — all pages share the AppShell layout
│   │       │       ├── layout.tsx        # Dashboard layout: wraps children in AppShell
│   │       │       ├── worklist/
│   │       │       │   └── page.tsx      # ★ FLAGSHIP: Study worklist with 10 mock studies, filters, keyboard nav
│   │       │       ├── queue/
│   │       │       │   └── page.tsx      # Personal reading queue (studies assigned to current user)
│   │       │       ├── reading/
│   │       │       │   └── [studyUid]/
│   │       │       │       └── page.tsx  # Reading room: OHIF placeholder + metadata panel
│   │       │       ├── reports/
│   │       │       │   ├── page.tsx      # Reports listing (8 mock reports)
│   │       │       │   └── [studyUid]/
│   │       │       │       └── page.tsx  # Report editor: findings/impression on paper surface
│   │       │       ├── hospitals/
│   │       │       │   ├── page.tsx      # Hospital portal dashboard
│   │       │       │   ├── tracker/
│   │       │       │   │   └── page.tsx  # Study tracker (8 mock studies)
│   │       │       │   └── reports/
│   │       │       │       └── page.tsx  # Reports library for hospital users
│   │       │       ├── analytics/
│   │       │       │   └── page.tsx      # Analytics: TAT, modality, hospital perf, SLA breaches
│   │       │       ├── audit/
│   │       │       │   └── page.tsx      # Audit log viewer (12 mock entries)
│   │       │       └── settings/
│   │       │           ├── page.tsx      # Admin console overview with tabs
│   │       │           ├── users/
│   │       │           │   └── page.tsx  # User management (8 mock users)
│   │       │           ├── routing/
│   │       │           │   └── page.tsx  # Routing rule list + builder
│   │       │           ├── audit/
│   │       │           │   └── page.tsx  # Audit config (embeds audit log)
│   │       │           └── ai/
│   │       │               └── page.tsx  # AI Queue Monitor (6 mock jobs)
│   │       │
│   │       ├── components/
│   │       │   ├── layout/
│   │       │   │   ├── AppShell.tsx      # Main layout: NavigationRail + TopBar + content
│   │       │   │   ├── NavigationRail.tsx # Left sidebar: 8 nav items, collapsible, icon-first
│   │       │   │   └── TopBar.tsx        # Top bar: breadcrumbs, user info, notifications
│   │       │   ├── ui/
│   │       │   │   ├── AcuityPulse.tsx   # ★ Signature: Thin vertical indicator per study row
│   │       │   │   ├── StatusBadge.tsx   # Study status pill (color-coded)
│   │       │   │   ├── PriorityBadge.tsx # Priority pill (STAT=amber, URGENT=amber, ROUTINE=muted)
│   │       │   │   ├── FilterBar.tsx     # Reusable filter dropdown row
│   │       │   │   ├── EmptyState.tsx    # Empty state with icon + message + action
│   │       │   │   ├── ErrorState.tsx    # Error state with retry button
│   │       │   │   └── Skeleton.tsx      # Skeleton loading (SkeletonTable, SkeletonLine)
│   │       │   ├── reading/
│   │       │   │   ├── OHIFViewerPlaceholder.tsx  # Documented placeholder (NOT a fake viewer)
│   │       │   │   ├── StudyContextBar.tsx         # Breadcrumb: Axis / Reading / Patient / Accession
│   │       │   │   ├── StudyMetadataPanel.tsx      # Patient/study info collapsible sections
│   │       │   │   ├── PriorStudiesList.tsx        # 3 mock prior studies for same patient
│   │       │   │   ├── ReportPanel.tsx             # Report preview or "Create Report" CTA
│   │       │   │   ├── CriticalFindingBanner.tsx   # Amber warning or flag button
│   │       │   │   └── SignOffControls.tsx         # Sign Off / Amend / Mark Delivered buttons
│   │       │   ├── report/
│   │       │   │   ├── ReportEditor.tsx            # ★ Main editor: paper surface, template selector
│   │       │   │   ├── ReportSidebar.tsx           # Study metadata sidebar for report page
│   │       │   │   ├── ReportActions.tsx           # Save/Submit/Sign/Amend action bar
│   │       │   │   ├── ReportVersionHistory.tsx    # Collapsible version history
│   │       │   │   └── CriticalFindingToggle.tsx   # Toggle with amber active state
│   │       │   ├── hospital/
│   │       │   │   ├── MetricCard.tsx              # Reusable metric display card
│   │       │   │   ├── StudyPipeline.tsx           # Horizontal 7-step status pipeline
│   │       │   │   └── HospitalStudyTimeline.tsx   # Vertical timeline of status transitions
│   │       │   └── admin/
│   │       │       ├── AdminTabs.tsx               # Tab navigation for settings
│   │       │       ├── MetricCard.tsx              # Admin metric card
│   │       │       ├── RoleBadge.tsx               # Color-coded role badges
│   │       │       └── RoutingRuleBuilder.tsx      # Interactive IF/THEN rule builder
│   │       │
│   │       └── lib/
│   │           ├── api-client.ts         # HTTP client (GET/POST/PUT/PATCH/DELETE) with error handling
│   │           ├── query-client.ts       # TanStack Query client (30s stale, 5min GC, 2 retries)
│   │           └── store.ts             # Zustand store: railCollapsed, selectedStudyUid, filters, sort
│   │
│   └── api/                              # @axis/api — NestJS 10 backend
│       ├── package.json                  # Dependencies: NestJS, Prisma, class-validator
│       ├── tsconfig.json                 # CommonJS (NestJS standard), strict
│       ├── tsconfig.build.json           # Build-specific config
│       ├── nest-cli.json                 # NestJS CLI config
│       ├── prisma/
│       │   ├── schema.prisma             # ★ 14 models, 12 enums, indexes, relations
│       │   └── seed.ts                   # Seed: 3 hospitals, 2 users, 10 studies, reports, audit
│       └── src/
│           ├── main.ts                   # Bootstrap: CORS, /api prefix, ValidationPipe, port 4000
│           ├── app.module.ts             # Root module importing all feature modules
│           ├── prisma/
│           │   ├── prisma.service.ts     # PrismaClient with lifecycle hooks
│           │   └── prisma.module.ts      # Global module exporting PrismaService
│           ├── studies/
│           │   ├── studies.module.ts     # Module definition
│           │   ├── studies.controller.ts # GET /studies, GET /:uid, GET /:uid/series, PATCH /:uid/status
│           │   ├── studies.service.ts    # Prisma queries for Study CRUD
│           │   └── dto/
│           │       ├── list-studies.dto.ts        # Query DTO: page, pageSize, status, modality, etc.
│           │       └── update-study-status.dto.ts # Body DTO: status, reason
│           ├── worklist/
│           │   ├── worklist.module.ts
│           │   ├── worklist.controller.ts # GET /worklist, POST /:uid/assign
│           │   └── worklist.service.ts
│           ├── reports/
│           │   ├── reports.module.ts
│           │   ├── reports.controller.ts # GET /, GET /:uid, POST /:uid, POST /:uid/sign, POST /:uid/amend
│           │   └── reports.service.ts    # Version creation on sign-off and amend
│           ├── users/
│           │   ├── users.module.ts
│           │   ├── users.controller.ts   # GET /, GET /:id, POST /, PATCH /:id
│           │   └── users.service.ts
│           ├── hospitals/
│           │   ├── hospitals.module.ts
│           │   ├── hospitals.controller.ts # GET /, GET /:id
│           │   └── hospitals.service.ts
│           ├── audit/
│           │   ├── audit.module.ts
│           │   ├── audit.controller.ts   # GET / (paginated)
│           │   └── audit.service.ts      # Append-only audit log creation
│           ├── analytics/
│           │   ├── analytics.module.ts
│           │   ├── analytics.controller.ts # GET /overview, GET /tat, GET /hospital-performance
│           │   └── analytics.service.ts
│           ├── ai/
│           │   ├── ai.module.ts
│           │   ├── ai.controller.ts      # GET /jobs, GET /jobs/:id
│           │   └── ai.service.ts
│           └── common/
│               ├── filters/
│               │   └── http-exception.filter.ts  # Consistent error response format
│               └── interceptors/
│                   └── audit.interceptor.ts       # Auto-log audit events for mutating requests
```

**Total: 120 source files** across the monorepo.

---

## 5. How It All Connects

### Package Dependencies

```
@axis/web  ──depends on──▶  @axis/types
@axis/api  ──depends on──▶  @axis/types
```

The shared `@axis/types` package ensures that the frontend and backend use
**identical TypeScript type definitions** for Study, Report, User, etc.
Changes to types propagate to both sides.

### Frontend Component Hierarchy

```
RootLayout (layout.tsx)
 └── Providers (QueryClientProvider)
      └── Page or DashboardLayout
           └── AppShell
                ├── NavigationRail (fixed left, 240px / 64px)
                ├── TopBar (fixed top, breadcrumbs + user)
                └── <main> (scrollable content area)
                     └── {children} — the actual page
```

### Backend Module Hierarchy

```
AppModule
 ├── PrismaModule (global)
 ├── StudiesModule
 │    └── StudiesController → StudiesService → PrismaService
 ├── WorklistModule
 │    └── WorklistController → WorklistService → PrismaService
 ├── ReportsModule
 │    └── ReportsController → ReportsService → PrismaService
 ├── UsersModule
 ├── HospitalsModule
 ├── AuditModule
 ├── AnalyticsModule
 └── AIModule
```

Every module follows the same pattern: **Controller** (handles HTTP) →
**Service** (business logic) → **PrismaService** (database queries).

---

## 6. Workflow — The Study Lifecycle

### The Complete Journey

```
SCANNER/MODALITY
      │
      │ DICOM C-STORE (port 4242)
      ▼
ORTHANC (DICOM archive)
      │
      │ Axis ingests study metadata via DICOMweb QIDO-RS
      ▼
┌─────────────────────────────────────────────────────┐
│                   AXIS WORKFLOW                      │
│                                                     │
│  NEW ─── Coordinator validates metadata             │
│   │                                                 │
│   ▼                                                 │
│  VALIDATED ─── Routing rules evaluate               │
│   │              (modality + subspecialty +          │
│   │               hospital + timezone)               │
│   │                                                 │
│   ▼                                                 │
│  UNASSIGNED ─── Auto-assign to radiologist pool     │
│   │                                                 │
│   ▼                                                 │
│  ASSIGNED ─── Radiologist picks up study            │
│   │                                                 │
│   ▼                                                 │
│  IN_READING ─── Radiologist views images (OHIF)     │
│   │              writes report in Axis               │
│   │              flags critical findings             │
│   │                                                 │
│   ▼                                                 │
│  FINAL ─── Report signed off                        │
│   │                                                 │
│   ├──▶ AMENDED ─── Radiologist amends report        │
│   │         │       (new version created)            │
│   │         └──▶ FINAL again                        │
│   │                                                 │
│   ▼                                                 │
│  DELIVERED ─── Report sent to hospital              │
│                                                     │
└─────────────────────────────────────────────────────┘

Every state transition records:
  • Previous state
  • New state
  • Actor (who did it)
  • Timestamp
  • Reason (when applicable)
```

### Priority Handling

Studies are color-coded by urgency:

| Priority | Acuity Pulse | Behavior |
|---|---|---|
| **STAT** | Amber, pulsing | Top of queue. SLA: typically 1-2 hours. |
| **URGENT** | Amber, static | Elevated priority. SLA: typically 4-8 hours. |
| **ROUTINE** | Muted gray | Standard queue order. SLA: typically 24-48 hours. |

The **Acuity Pulse** is Axis's visual signature — a thin vertical colored bar on the
left edge of every study row. It instantly communicates urgency without consuming
horizontal space.

---

## 7. Data Flow

### Study Ingestion Flow

```
1. Scanner sends DICOM to Orthanc (C-STORE on port 4242)
2. Orthanc stores the DICOM binary, indexes metadata
3. Axis backend queries Orthanc via QIDO-RS:
   GET http://localhost:8042/dicom-web/studies
4. Axis creates Study/Series/Instance records in PostgreSQL
5. Study appears as NEW in the worklist
6. Routing rules evaluate and assign priority/subspecialty/radiologist
7. Study transitions through the status lifecycle
```

### Image Viewing Flow

```
1. Radiologist clicks a study in the worklist
2. Frontend navigates to /reading/{studyInstanceUid}
3. OHIF viewer loads, requests images from Orthanc via WADO-RS:
   GET http://localhost:8042/dicom-web/studies/{uid}
4. Orthanc returns DICOM binary data
5. OHIF decodes and renders the images
6. Axis displays study metadata in the right panel
```

### Report Creation Flow

```
1. Radiologist opens report editor (/reports/{studyUid})
2. Selects a template (General, CT Chest, MSK)
3. Types findings in Source Serif 4 (paper background)
4. Types impression
5. Flags critical findings if applicable
6. Saves draft (DRAFT status)
7. Submits for sign-off (PENDING_SIGNOFF)
8. Signs off (FINAL status) — new ReportVersion is created
9. If amended: new version created, old version preserved
10. Delivery system picks up FINAL report and sends to hospital
```

### API Data Flow

```
Frontend                     Backend                     Database
   │                            │                            │
   │  GET /api/worklist         │                            │
   │  (with filters)            │                            │
   │ ──────────────────────────▶│                            │
   │                            │  SELECT * FROM studies     │
   │                            │  JOIN worklist_items       │
   │                            │  WHERE status IN (...)     │
   │                            │  ORDER BY priority         │
   │                            │ ──────────────────────────▶│
   │                            │                            │
   │                            │  ◀── rows ─────────────────│
   │  ◀── JSON response ────────│                            │
   │                            │                            │
   │  POST /api/reports/:uid    │                            │
   │  { findings, impression }  │                            │
   │ ──────────────────────────▶│                            │
   │                            │  INSERT INTO reports       │
   │                            │  INSERT INTO report_versions│
   │                            │  INSERT INTO audit_logs    │
   │                            │ ──────────────────────────▶│
   │  ◀── 201 Created ─────────│                            │
```

---

## 8. User Flows

### Radiologist Flow

```
1. Log in → Land on /worklist
2. See all assigned studies sorted by priority
3. STAT studies pulse amber at the top
4. Press 'j' to move down, 'k' to move up
5. Press 'Enter' to open the selected study
6. Reading room opens:
   - Left: OHIF viewer loads images from Orthanc
   - Right: study metadata, prior studies, report panel
7. View images in OHIF
8. Click "Create Report" or navigate to /reports/{studyUid}
9. Write findings and impression on paper-textured editor
10. Toggle critical finding if applicable
11. Save draft → Submit for sign-off → Sign off
12. Study status moves to FINAL
13. Navigate back to worklist (next case)
```

### Coordinator Flow

```
1. Log in → See /worklist with all studies
2. Filter by UNASSIGNED status
3. Assign studies to radiologists
4. Monitor SLA countdown (amber when <2hr, red when <1hr)
5. Check /analytics for turnaround metrics
6. Review /audit for compliance
```

### Hospital User Flow

```
1. Log in → Land on /hospitals (hospital portal)
2. See dashboard: studies sent, in progress, delivered, avg TAT
3. Click "Study Tracker" → see their studies' status progression
4. Click "Reports Library" → browse finalized reports
5. Download FINAL reports as PDF
6. Read-only view — cannot modify studies or reports
```

### Admin Flow

```
1. Log in → Navigate to /settings
2. Overview tab: org stats, quick links
3. Users tab: create/edit/deactivate users, assign roles
4. Routing Rules tab: build IF/THEN rules for auto-assignment
   - IF modality=CT AND subspecialty=Neuro AND hospital=Metro General
   - THEN assign to Neuro Pool, set priority STAT
5. Audit tab: review all system events for compliance
6. AI Queue tab: monitor AI processing jobs
```

---

## 9. Frontend Deep Dive

### 9 Routes / 16 Page Files

| Route | Page | Role |
|---|---|---|
| `/` | Landing | Entry point with "Open Worklist" CTA |
| `/worklist` | Worklist | ★ Flagship — full study queue with filters and keyboard nav |
| `/queue` | My Queue | Personal assigned studies sorted by priority |
| `/reading/[studyUid]` | Reading Room | DICOM viewer placeholder + metadata sidebar |
| `/reports` | Reports List | All reports with status filters |
| `/reports/[studyUid]` | Report Editor | Paper-surface editor with templates and versioning |
| `/hospitals` | Hospital Dashboard | Metrics, study pipeline, recent studies |
| `/hospitals/tracker` | Study Tracker | Search and filter studies by status |
| `/hospitals/reports` | Reports Library | Download finalized reports |
| `/analytics` | Analytics | TAT, modality, hospital performance, SLA breaches |
| `/audit` | Audit Log | Append-only event viewer with action filters |
| `/settings` | Admin Overview | Metric cards and quick links |
| `/settings/users` | User Management | User table with role badges |
| `/settings/routing` | Routing Rules | Interactive rule builder |
| `/settings/audit` | Audit Config | Audit log in settings context |
| `/settings/ai` | AI Queue Monitor | AI job status with disclaimer |

### State Management

**Zustand** (client state, in `lib/store.ts`):
- `railCollapsed` — whether the navigation rail is collapsed
- `selectedStudyUid` — currently selected study in the worklist
- `filterState` — active worklist filters (priority, modality, hospital, status)
- `sortState` — current sort field and direction

**TanStack React Query** (server state):
- Configured with 30-second stale time, 5-minute garbage collection
- 2 retries on failure, no refetch on window focus
- Used for all API data fetching when connected to the backend

### Keyboard Navigation

In the worklist:
| Key | Action |
|---|---|
| `j` | Move selection down |
| `k` | Move selection up |
| `Enter` | Open selected study in reading view |
| `/` | Focus search input |
| `Esc` | Close modals/panels |

### Key UI Components

**AcuityPulse** — The visual signature of Axis:
- A 32px tall, 2px wide vertical bar on the left edge of each study row
- Color encodes urgency: amber (STAT), cyan (IN_READING), green (FINAL/DELIVERED), red (ERROR), gray (ROUTINE)
- STAT cases get a subtle 2-second pulsing animation
- Respects `prefers-reduced-motion: reduce` — disables animation but keeps the static color indicator

**StatusBadge** — Color-coded status pill:
- NEW/VALIDATED/UNASSIGNED → muted gray
- ASSIGNED/IN_READING → cyan
- FINAL/DELIVERED → green
- AMENDED → amber

**ReportEditor** — Intentionally different from the rest of the dark UI:
- Editing surface has a light paper background (`#F6F4EF`)
- Uses Source Serif 4 (serif font) for the text areas
- This creates a visual distinction: dark clinical UI for navigation, light paper for clinical documentation
- Template selector, character counts, critical finding toggle

### Design System

**"Reading Room" metaphor**: dark, restrained, information-dense, low-glare.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0B0E14` | Page background |
| `--bg-surface` | `#141924` | Card/panel background |
| `--bg-surface-raised` | `#1B2130` | Elevated surfaces, hover states |
| `--border-hairline` | `#262D3D` | All borders |
| `--text-primary` | `#E8EAF0` | Main text |
| `--text-muted` | `#8A93A6` | Secondary text |
| `--accent-cyan` | `#3FD0E0` | Active states, links, focus rings |
| `--accent-amber` | `#F5A623` | Warnings, STAT priority |
| `--accent-signal` | `#5FD98A` | Success, FINAL status |
| `--accent-alert` | `#EF5A5A` | Errors, SLA breaches |
| `--paper` | `#F6F4EF` | Report editor surface |

**Typography**:
- UI text: **Inter** (system-ui fallback)
- Headings: **Inter Tight** (tighter letter-spacing for density)
- Technical IDs: **IBM Plex Mono** (Study UIDs, accession numbers, timestamps)
- Reports: **Source Serif 4** (clinical document feel)

**Shape**:
- Maximum border radius: 6px
- Hairline (1px) borders throughout
- No shadows (except tooltips and collapsed nav tooltips)
- No gradients, no glassmorphism, no rounded hero cards

---

## 10. Backend Deep Dive

### NestJS Application Structure

**Bootstrap** (`main.ts`):
1. Creates the NestJS application
2. Enables CORS for cross-origin requests
3. Sets global route prefix `/api` (all endpoints become `/api/...`)
4. Applies global `ValidationPipe` with `whitelist: true` (strips unknown fields) and `transform: true` (auto-transforms payloads to DTO instances)
5. Listens on port 4000

### Feature Modules (9 total)

| Module | Routes | Purpose |
|---|---|---|
| **StudiesModule** | `GET /studies`, `GET /studies/:uid`, `GET /studies/:uid/series`, `PATCH /studies/:uid/status` | Study CRUD and status management |
| **WorklistModule** | `GET /worklist`, `POST /worklist/:uid/assign` | Filtered worklist, study assignment |
| **ReportsModule** | `GET /reports`, `GET /reports/:uid`, `POST /reports/:uid`, `POST /reports/:uid/sign`, `POST /reports/:uid/amend` | Report lifecycle with versioning |
| **UsersModule** | `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id` | User CRUD |
| **HospitalsModule** | `GET /hospitals`, `GET /hospitals/:id` | Hospital listing with sites |
| **AuditModule** | `GET /audit` | Paginated audit log queries |
| **AnalyticsModule** | `GET /analytics/overview`, `GET /analytics/tat`, `GET /analytics/hospital-performance` | Operational metrics |
| **AIModule** | `GET /ai/jobs`, `GET /ai/jobs/:id` | AI job tracking |
| **PrismaModule** | (global) | Database access for all modules |

### Cross-Cutting Concerns

**HttpExceptionFilter** — All errors return a consistent format:
```json
{
  "statusCode": 400,
  "message": "Study not found",
  "error": "Bad Request",
  "timestamp": "2026-08-25T14:00:00.000Z",
  "path": "/api/studies/invalid-uid"
}
```

**AuditInterceptor** — Automatically logs audit events for:
- POST requests (creates)
- PATCH requests (updates)
- DELETE requests (deletes)
Records: actor, action, resource, resourceId, timestamp, IP, user agent.

### Report Versioning Logic

When a report is **signed off**:
1. Current report status → `FINAL`
2. `signedOffBy` and `signedOffAt` are set
3. A new `ReportVersion` record is created (immutable snapshot)
4. An audit log entry is created

When a report is **amended**:
1. Current report status → `AMENDED`
2. New report version is created with updated findings/impression
3. Report `version` counter increments
4. Report status is set to `AMENDED`
5. An audit log entry is created

---

## 11. Database Schema

### 14 Models, 12 Enums

```
User ──────┬──── assignedStudies ──── Study ──────┬──── series ──── Series ────── instances ──── Instance
           │                                       │
           ├──── authoredReports ── Report ────────┘
           │                       │
           │                       └──── versions ──── ReportVersion
           │
           └──── auditLogs ────── AuditLog

Hospital ──┬──── sites ──── Site
           ├──── patients ──── Patient
           ├──── studies ──── Study
           └──── deliveryAttempts ──── DeliveryAttempt

Study ──────┬──── worklistItem ──── WorklistItem
            ├──── reports ──── Report
            ├──── deliveryAttempts ──── DeliveryAttempt
            └──── aiJobs ──── AIJob

RoutingRule ──── createdBy ──── User
```

### Key Enums

| Enum | Values | Used By |
|---|---|---|
| `StudyStatus` | NEW, VALIDATED, UNASSIGNED, ASSIGNED, IN_READING, FINAL, AMENDED, DELIVERED | Study |
| `StudyPriority` | STAT, URGENT, ROUTINE | Study |
| `Modality` | CT, MRI, XR, US, NM, PET, MG, DX, CR, Fluoro | Study, Series |
| `Subspecialty` | NEURO, MSK, CHEST, ABDOMEN, CARDIOVASCULAR, MAMMOGRAPHY, MUSCULOSKELETAL, GENERAL, PEDIATRIC, ONCOLOGY, INTERVENTIONAL | Study |
| `ReportStatus` | DRAFT, PENDING_SIGNOFF, FINAL, AMENDED | Report, ReportVersion |
| `UserRole` | ADMIN, COORDINATOR, RADIOLOGIST, TECHNICIAN, HOSPITAL_USER | User |
| `AuditAction` | 20 values (LOGIN, STUDY_VIEWED, REPORT_SIGNED, etc.) | AuditLog |

### Database Indexes

For performance on common worklist queries:
- `Study.status` — filter by current status
- `Study.hospitalId` — filter by hospital
- `Study.assignedRadiologistId` — filter by assigned radiologist
- `Study.priority` — sort by priority
- `Study.studyDate` — sort/filter by date
- `Report.studyId` — look up report by study
- `Report.status` — filter by report status
- `AuditLog.timestamp` — time-range queries
- `AuditLog.actorId` — filter by user
- `AuditLog.[resource, resourceId]` — look up events for a resource
- `AIJob.status` — filter by job status
- `AIJob.studyId` — look up jobs for a study

---

## 12. Design System

### CSS Custom Properties

All colors are defined as CSS variables in `globals.css` and mapped through
Tailwind's theme configuration. No hardcoded colors appear in components.

```css
:root {
  /* Core palette */
  --bg-base: #0B0E14;
  --bg-surface: #141924;
  --bg-surface-raised: #1B2130;
  --border-hairline: #262D3D;
  --text-primary: #E8EAF0;
  --text-muted: #8A93A6;
  --accent-cyan: #3FD0E0;
  --accent-amber: #F5A623;
  --accent-signal: #5FD98A;
  --accent-alert: #EF5A5A;
  --paper: #F6F4EF;

  /* Semantic tokens (aliases) */
  --color-background: var(--bg-base);
  --color-surface: var(--bg-surface);
  --color-surface-raised: var(--bg-surface-raised);
  --color-border: var(--border-hairline);
  --color-text-primary: var(--text-primary);
  --color-text-muted: var(--text-muted);
  --color-accent: var(--accent-cyan);
  --color-warning: var(--accent-amber);
  --color-success: var(--accent-signal);
  --color-error: var(--accent-alert);
  --color-paper: var(--paper);

  /* Fonts */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-heading: 'Inter Tight', 'Inter', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
  --font-serif: 'Source Serif 4', Georgia, serif;
}
```

### Acuity Pulse Animation

```css
@keyframes acuity-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.acuity-pulse-stat {
  animation: acuity-pulse 2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .acuity-pulse-stat {
    animation: none !important;
  }
}
```

### Tailwind Theme Overrides

| Setting | Value |
|---|---|
| Max border radius | 6px (`md` and `lg` both map to `6px`) |
| Font families | 4 families mapped to CSS variables |
| Colors | All mapped to CSS variables (no default palettes) |
| Plugins | None |

---

## 13. Running Locally From Scratch

> This section assumes you have **nothing installed** — no Node.js, no Docker,
> no pnpm. We start from a bare Ubuntu machine.

### Step 1: Install Node.js (via nvm)

```bash
# Install nvm (Node Version Manager)
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Load nvm into your shell
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Install Node.js 20
nvm install 20

# Verify
node --version    # Should show v20.x.x
npm --version     # Should show 10.x.x
```

### Step 2: Install pnpm

```bash
npm install -g pnpm@9

# Verify
pnpm --version    # Should show 9.x.x
```

### Step 3: Install Docker

```bash
# For Ubuntu:
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin

# Add your user to the docker group (log out and back in after):
sudo usermod -aG docker $USER

# Verify (after re-login):
docker --version
docker compose version
```

### Step 4: Clone the Repository

```bash
git clone <repository-url> Teleradiology_PACS
cd Teleradiology_PACS
```

### Step 5: Install Node Dependencies

```bash
pnpm install
```

This installs dependencies for all 3 workspace packages (@axis/web, @axis/api, @axis/types).

### Step 6: Set Up Environment Variables

```bash
cp .env.example .env
```

The defaults in `.env.example` work with the Docker Compose services.
You do **not** need to edit `.env` for local development.

### Step 7: Start Infrastructure Services

```bash
docker compose up -d
```

This starts 6 services. Wait for them to be healthy:

```bash
docker compose ps
```

All should show "Up" or "(healthy)". This may take 1-2 minutes on first run
because Docker needs to pull the images.

**What just started:**

| Service | URL | Credentials |
|---|---|---|
| PostgreSQL | `localhost:5432` | axis / axis_dev / axis_pacs |
| Redis | `localhost:6379` | (none) |
| RabbitMQ | `localhost:5672` (AMQP), `localhost:15672` (console) | axis / axis_dev |
| Orthanc | `localhost:8042` (HTTP), `localhost:4242` (DICOM) | orthanc / orthanc |
| Keycloak | `localhost:8180/auth` | admin / admin |
| MinIO | `localhost:9000` (API), `localhost:9001` (console) | minioadmin / minioadmin |

### Step 8: Set Up the Database

```bash
# Generate the Prisma client (reads schema.prisma, generates TypeScript types)
pnpm db:generate

# Run database migrations (creates all tables)
pnpm db:migrate

# Seed the database with synthetic data
pnpm db:seed
```

After seeding, the database contains:
- 3 hospitals (Metro General, St. Luke's, Riverside)
- 2 users (Admin, Radiologist)
- 10 synthetic studies with various statuses
- 3 reports (Draft, Final, Amended)
- 5 audit log entries

### Step 9: Start the Frontend

```bash
pnpm dev
```

Wait for the "Ready" message. The frontend is now available at:
**http://localhost:3000**

### Step 10: Start the Backend (optional, for API)

```bash
# In a second terminal:
cd apps/api
pnpm dev
```

The API is now available at:
**http://localhost:4000/api**

### Step 11: Open the Application

Open **http://localhost:3000** in your browser.

You will see:
1. Landing page with "Axis" title and "Open Worklist" button
2. Click "Open Worklist" → `/worklist`
3. See 10 synthetic studies with Acuity Pulse indicators
4. Use `j`/`k` to navigate, `Enter` to open a study
5. Navigate using the left rail to Reports, Hospitals, Analytics, Audit, Settings

### Step 12: Upload DICOM Data (optional)

If you have real DICOM files, upload them to Orthanc:

```bash
curl -X POST http://localhost:8042/dicom-web/stow-rs/studies \
  -u orthanc:orthanc \
  -H "Content-Type: multipart/related; type=application/dicom" \
  --data-binary @your-dicom-file.dcm
```

Or use Orthanc's web interface at **http://localhost:8042** to upload via browser.

### Step 13: Connect OHIF Viewer (optional)

```bash
# Run OHIF in Docker:
docker run -d -p 3001:80 \
  -e DICOM_WEB_ROOT=http://host.docker.internal:8042/dicom-web \
  ohif/viewer:latest
```

Then access OHIF at **http://localhost:3001**.

### Available Commands Summary

| Command | What It Does |
|---|---|
| `pnpm dev` | Start Next.js dev server on port 3000 |
| `pnpm build` | Production build (types → Next.js) |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm typecheck` | TypeScript type checking across all packages |
| `pnpm test` | Run test suites |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:seed` | Seed database with synthetic data |
| `docker compose up -d` | Start all infrastructure services |
| `docker compose ps` | Check service health |
| `docker compose down` | Stop all services |
| `docker compose logs -f` | Follow service logs |

---

## 14. Docker Services Reference

| Service | Image | Ports | Purpose | Volume | Healthcheck |
|---|---|---|---|---|---|
| **postgres** | `postgres:16-alpine` | 5432 | Primary database | `postgres_data` | `pg_isready` every 5s |
| **redis** | `redis:7-alpine` | 6379 | Cache, sessions, pub/sub | — | `redis-cli ping` every 5s |
| **rabbitmq** | `rabbitmq:3-management-alpine` | 5672, 15672 | Async messaging, job queues | — | `rabbitmq-diagnostics` every 10s |
| **orthanc** | `jodogne/orthanc-plugins:latest` | 8042, 4242 | DICOM archive + DICOMweb | `orthanc_data` | `curl /is-alive` every 10s |
| **keycloak** | `quay.io/keycloak/keycloak:24.0` | 8180 | OIDC identity provider | `keycloak_data` | — |
| **minio** | `minio/minio:latest` | 9000, 9001 | S3 object storage | `minio_data` | — |

### Service Credentials

| Service | Username | Password | Database |
|---|---|---|---|
| PostgreSQL | `axis` | `axis_dev` | `axis_pacs` |
| Orthanc | `orthanc` | `orthanc` | — |
| RabbitMQ | `axis` | `axis_dev` | — |
| Keycloak | `admin` | `admin` | — |
| MinIO | `minioadmin` | `minioadmin` | — |

---

## 15. API Reference

All endpoints prefixed with `/api`. Backend runs on port 4000.

### Studies

| Method | Endpoint | Description | Query/Body |
|---|---|---|---|
| `GET` | `/api/studies` | List studies | `?page=&pageSize=&status=&modality=&hospitalId=&priority=&search=` |
| `GET` | `/api/studies/:studyUid` | Get study by UID | — |
| `GET` | `/api/studies/:studyUid/series` | Get series for a study | — |
| `PATCH` | `/api/studies/:studyUid/status` | Update status | `{ "status": "ASSIGNED", "reason": "..." }` |

### Worklist

| Method | Endpoint | Description | Body |
|---|---|---|---|
| `GET` | `/api/worklist` | Get filtered worklist | `?status=&priority=&modality=&hospitalId=&subspecialty=` |
| `POST` | `/api/worklist/:studyUid/assign` | Assign to radiologist | `{ "radiologistId": "..." }` |

### Reports

| Method | Endpoint | Description | Body |
|---|---|---|---|
| `GET` | `/api/reports` | List all reports | — |
| `GET` | `/api/reports/:studyUid` | Get report for a study | — |
| `POST` | `/api/reports/:studyUid` | Create/update report | `{ "authorId", "findings", "impression", "criticalFinding" }` |
| `POST` | `/api/reports/:studyUid/sign` | Sign off report | `{ "signedOffBy": "..." }` |
| `POST` | `/api/reports/:studyUid/amend` | Amend report | `{ "authorId", "findings", "impression" }` |

### Users

| Method | Endpoint | Description | Body |
|---|---|---|---|
| `GET` | `/api/users` | List users | — |
| `GET` | `/api/users/:id` | Get user | — |
| `POST` | `/api/users` | Create user | `{ "email", "displayName", "role" }` |
| `PATCH` | `/api/users/:id` | Update user | `{ "role", "isActive", ... }` |

### Hospitals

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/hospitals` | List hospitals |
| `GET` | `/api/hospitals/:id` | Get hospital with sites |

### Analytics

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analytics/overview` | Summary metrics |
| `GET` | `/api/analytics/tat` | TAT distribution |
| `GET` | `/api/analytics/hospital-performance` | Per-hospital performance |

### Audit

| Method | Endpoint | Description | Query |
|---|---|---|---|
| `GET` | `/api/audit` | List audit entries | `?page=&pageSize=&action=&actorId=&resource=` |

### AI Jobs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/ai/jobs` | List AI jobs |
| `GET` | `/api/ai/jobs/:id` | Get job detail |

---

## 16. Synthetic Data

All demo data is **explicitly synthetic**. No real patient information is used.

### Naming Conventions

| Data Type | Format | Example |
|---|---|---|
| Patient ID | `AX-SYN-PAT-XXXX` | `AX-SYN-PAT-0001` |
| Accession Number | `AX-SYN-ACC-XXXXXX` | `AX-SYN-ACC-000001` |
| Study Instance UID | `AX-SYN-UID-XXXX` | `AX-SYN-UID-0001` |
| Report ID | `AX-SYN-RPT-XXXX` | `AX-SYN-RPT-0001` |
| Patient Name | `AX-SYN Patient N` | `AX-SYN Patient 1` |
| Hospital | `AX-SYN {Name}` | `AX-SYN Metro General Hospital` |
| Email | `@axis-synthetic.example.com` | `admin@axis-synthetic.example.com` |
| Audit metadata | `{ "synthetic": true }` | — |

### Frontend Mock Data

The worklist page contains 10 inline mock studies with realistic (but synthetic) data covering:
- Multiple modalities (CT, MRI, XR, US, MG, DX, NM)
- All priority levels (STAT, URGENT, ROUTINE)
- All statuses (NEW, VALIDATED, UNASSIGNED, ASSIGNED, IN_READING, FINAL, AMENDED, DELIVERED)
- 3 hospitals
- 4 subspecialties
- SLA deadlines and TAT measurements

---

## 17. What Works vs. What Needs External Infrastructure

### Fully Working (no external dependencies)

- [x] Complete Next.js frontend with 16 page routes
- [x] All UI components (AcuityPulse, StatusBadge, FilterBar, etc.)
- [x] Dark "reading room" design system with CSS variables
- [x] Keyboard navigation in worklist (j/k/Enter)
- [x] Report editor with paper surface, templates, version history
- [x] Hospital portal with dashboard, tracker, reports library
- [x] Admin console with user management, routing rule builder, AI monitor
- [x] Analytics dashboard with TAT, modality, hospital performance, SLA
- [x] Audit log viewer with action filtering
- [x] Navigation rail with 8 sections, collapsible, tooltips
- [x] Zustand state management (rail, filters, sort, selection)
- [x] API client ready for backend connection
- [x] Production build (verified, zero errors)
- [x] TypeScript type checking (verified, zero errors)
- [x] ESLint (verified, zero errors)
- [x] Shared types package consumed by both frontend and backend
- [x] NestJS backend with 9 feature modules
- [x] Prisma schema with 14 models and 12 enums
- [x] Database seed script
- [x] Docker Compose with 6 services
- [x] Orthanc DICOMweb configuration

### Requires Running Infrastructure (Docker)

| Component | Needs | How |
|---|---|---|
| Backend API | PostgreSQL running | `docker compose up -d postgres` |
| Database migrations | Prisma + PostgreSQL | `pnpm db:generate && pnpm db:migrate` |
| Seed data | PostgreSQL + Prisma | `pnpm db:seed` |
| DICOM viewing | Orthanc + OHIF | `docker compose up -d orthanc` |

### Not Yet Implemented

| Feature | Status | What Exists |
|---|---|---|
| **OIDC Authentication** | Schema + Keycloak running, guards not wired | Keycloak Docker service, OIDC env vars |
| **Route Authorization** | RBAC types defined, guards not implemented | UserRole enum, role badges in UI |
| **OHIF Embedding** | Placeholder only | `OHIFViewerPlaceholder` component, documented integration |
| **Routing Rule Engine** | UI builder exists, evaluation logic not built | `RoutingRuleBuilder` component, Prisma model |
| **Report Delivery** | Schema exists, delivery not implemented | `DeliveryAttempt` model, status types |
| **AI Inference** | Schema + endpoints exist, no ML connected | `AIJob` model, queue monitor UI |
| **Real-time Updates** | Not implemented | — |
| **WebSocket/SSE** | Not implemented | — |
| **Comprehensive Tests** | Vitest configured, tests not written | `vitest` in devDependencies |
| **CI/CD Pipeline** | Not configured | — |

---

## 18. Production Considerations

### Security

- Replace all default credentials in `.env`
- Enable Orthanc authentication
- Configure Keycloak with TLS
- Set `AUTH_SECRET` to a cryptographically random value (32+ chars)
- Enable HTTPS behind a reverse proxy
- Restrict CORS origins
- Enable PostgreSQL SSL
- Rotate MinIO access keys
- Implement rate limiting

### Infrastructure

- Use managed PostgreSQL (RDS, Cloud SQL, Azure Database)
- Use managed Redis with authentication
- Use managed RabbitMQ or deploy with clustering
- Configure Orthanc with TLS for DICOM TLS receiving
- Set up MinIO with erasure coding

### Performance

- Enable Next.js ISR/caching for static-heavy pages
- Configure PostgreSQL connection pooling (PgBouncer)
- Add Redis caching for frequently accessed study metadata
- Use CDN for Orthanc WADO-RS image delivery
- Optimize Orthanc database for expected volume

### Compliance

- Ensure audit logging captures all PHI access
- Configure report delivery encryption
- Implement automatic session timeout
- Set up data retention policies for audit logs
- Document BAA requirements for cloud providers

---

## Quick Reference Card

| What | Where | Port |
|---|---|---|
| Frontend | http://localhost:3000 | 3000 |
| API | http://localhost:4000/api | 4000 |
| PostgreSQL | localhost:5432 | 5432 |
| Orthanc | http://localhost:8042 | 8042 |
| Orthanc DICOM | localhost:4242 | 4242 |
| Redis | localhost:6379 | 6379 |
| RabbitMQ | localhost:5672 / http://localhost:15672 | 5672 / 15672 |
| Keycloak | http://localhost:8180/auth | 8180 |
| MinIO API | http://localhost:9000 | 9000 |
| MinIO Console | http://localhost:9001 | 9001 |
| OHIF (optional) | http://localhost:3001 | 3001 |
