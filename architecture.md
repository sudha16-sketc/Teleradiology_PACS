# Architecture — Axis

## Overview

Axis is a pnpm monorepo. The browser and Tauri desktop client use the Next.js application; the NestJS API owns workflow decisions and authorization. PostgreSQL stores workflow metadata, Orthanc stores DICOM objects, and OHIF is served behind the web application.

```text
Browser ───────────────┐
                       ├── Next.js web origin ── /api ── NestJS API ── PostgreSQL
Tauri WebView ─────────┘          │                    └── Orthanc
                                  └── /ohif ── OHIF ── /api/dicom-web ── API ── Orthanc
Modality ─────────────────────────────────────────────── DICOM C-STORE ── Orthanc
```

The browser does not connect directly to PostgreSQL or Orthanc. OHIF's DICOMweb traffic is routed through the API proxy, where the authenticated session and resource authorization are applied.

## Workspace

| Package | Responsibility |
| --- | --- |
| `apps/web` (`@axis/web`) | Next.js App Router UI, session-aware navigation, API client, OHIF same-origin proxy configuration. |
| `apps/api` (`@axis/api`) | NestJS REST API, authentication/role guards, workflow services, validation, audit, Prisma access, DICOM ingest and DICOMweb proxy. |
| `apps/desktop` (`@axis/desktop`) | Tauri 2 Windows client shell loading a configured remote deployment; it is not a separate backend or offline client. |
| `packages/types` (`@axis/types`) | Shared types and report-document helpers, built as ESM for web consumers and CommonJS for the API. |

## Runtime and data responsibilities

- **PostgreSQL 16 / Prisma:** users, hospitals, patients, studies, series and instance metadata, worklists/assignments, reports and versions, audit events, routing configuration, notifications, delivery/AI job records, SLA, backup, and retention metadata. The Prisma schema is authoritative.
- **Orthanc:** DICOM object storage, DICOM REST and DICOMweb; local DICOM listener is configured on port 4242.
- **OHIF 3.13:** image display. In the local stack it is built with a `/ohif` path prefix and proxied through Next.js to preserve same-origin browser behavior.
- **Next.js:** frontend and same-origin rewrites for API/OHIF access.
- **Tauri:** native application window around the remote web deployment. URL resolution and navigation permissions are configured in `apps/desktop/src-tauri`.

The development Compose stack currently contains PostgreSQL, Orthanc, and OHIF. Keycloak, Redis, RabbitMQ, and MinIO are not active runtime dependencies.

## API structure

`apps/api/src/app.module.ts` composes feature modules. Modules generally follow controller → service → Prisma service. The API has a global `/api` prefix, global authentication and role guards, DTO validation, exception filtering, request correlation/logging, security headers, targeted rate limits, and graceful shutdown.

Feature areas include authentication, studies, worklist, reports, reviews, corrections, users, hospitals, audit, analytics, AI job records, DICOM ingest, DICOMweb proxy, notifications, health, SLA, backups, and retention.

### Reports and patient records

The report editor stores TipTap document JSON in nullable `Report.richContent` alongside the existing plain-text report columns. The API validates the permitted document nodes, attributes, size, and depth; extracts the six clinical sections into the legacy columns; and includes rich JSON in the content hash and immutable `ReportVersion` snapshot. Corrections can seed a new draft from the signed rich snapshot. Existing assignment, sign-off, manager review, delivery, and correction transitions remain authoritative.

The study-priors endpoint returns finalized related studies only. Radiologists see priors assigned to them; hospital users see released priors belonging to their hospital. Prior reports are opened through the read-only reading view, where the normal study and report authorization checks still apply.

## DICOM ingest and viewing

1. An authenticated hospital user submits DICOM data to the API.
2. The ingest path applies upload and archive validation, parses DICOM identifiers, and uses the authenticated user's hospital scope.
3. The API persists study workflow metadata and sends instances to Orthanc.
4. Orthanc identifiers are associated with the corresponding PostgreSQL records; study/worklist and audit state are finalized.
5. OHIF issues DICOMweb requests via `/api/dicom-web`; the API applies session and resource authorization before proxying to Orthanc.

See `DICOM_SETUP.md` for detailed local ingest and viewer setup. Do not send real PHI to a development environment.

## Authentication and authorization

- The active implementation is database-backed NestJS session authentication using the `axis_session` httpOnly cookie.
- Global API guards enforce authentication and roles. Service-level scope checks must protect hospital ownership and radiologist assignment.
- The web app applies role-aware navigation and route handling, but UI checks are supplementary; the API is the security boundary.
- The Tauri application loads the deployment origin to preserve same-origin session behavior. Do not bundle the web application or alter cookie/CORS policy without an explicit security review.
- Rate limiting and session revocation currently use in-process mechanisms. Multi-instance deployment requires a separately designed shared state solution.

## Local topology

Use `docker-compose.yml` and `infra/README.md` as the operational source of truth. PostgreSQL and Orthanc HTTP and OHIF host ports bind to loopback; services share the `axis_internal` Docker network and persistent named volumes. Local Compose is a development stack, not a production deployment architecture.

## Boundaries and limitations

- AI job records are not an inference service.
- Routing-rule configuration is not proof of automatic rule execution.
- Real-time worklist push updates are not implemented.
- Delivery-attempt records do not imply an operational HL7/FHIR/email/fax integration.
- In-process rate limiting/session state is not suitable for horizontally scaled APIs without redesign.
- Production TLS, secret management, network controls, backups, restore validation, monitoring, and compliance review are operator responsibilities.

For code changes, preserve these trust boundaries: web → API, API → database/archive, and authenticated OHIF → API proxy → archive.
