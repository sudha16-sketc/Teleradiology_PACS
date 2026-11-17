# Project Context — Axis

## What this project is

Axis is a teleradiology PACS workflow and clinical reporting platform in the `Teleradiology_PACS` repository. It manages study intake, assignment, image review, reports, review/correction, hospital access, and operational oversight. It complements rather than replaces the DICOM archive and viewer.

## Stack and layout

- Monorepo: pnpm workspaces; Node.js 20+ and pnpm 9+.
- Web: Next.js 14 App Router, React 18, TypeScript, Tailwind, TanStack Query, Zustand.
- API: NestJS 10, Prisma 5, PostgreSQL 16.
- Imaging: Orthanc 1.12.6 and OHIF 3.13.0.
- Desktop: Tauri 2 Windows shell that loads a configured remote Axis origin.
- Shared types: `packages/types` (`@axis/types`).

## Important architecture facts

- Active authentication is the database-backed NestJS session flow using the httpOnly `axis_session` cookie. Keycloak is not integrated.
- API guards are the security boundary. Enforce role, hospital, and assignment scope on the server for every resource/action.
- The browser does not directly access PostgreSQL or Orthanc. OHIF is served via `/ohif` and its DICOMweb calls pass through the authenticated API proxy.
- The local Compose stack is PostgreSQL, Orthanc, and OHIF. Redis, RabbitMQ, and MinIO are not currently in the active runtime stack.
- Tauri intentionally loads the remote web deployment to preserve same-origin session behavior. It is not an offline client and should not persist clinical data locally.
- In-process rate limits and session revocation constrain horizontal scaling; do not assume multi-instance readiness.

## Workflow/domain notes

- The authoritative models and statuses are in `apps/api/prisma/schema.prisma`, not older summaries.
- Roles in the current schema are `ADMIN`, `MANAGER`, `RADIOLOGIST`, and `HOSPITAL`.
- Study statuses include intake/validation, assignment/reading, report review/delivery, hospital review/acceptance, completion, correction/change request, and cancellation states.
- Reports, versions, assignments, correction requests, audit records, SLA, delivery attempts, AI jobs, backups, and retention have dedicated data models.
- Synthetic data uses the `AX-SYN` convention. Never put real patient information in seeds, fixtures, logs, or docs.

## Report editor and patient records

- The report editor uses TipTap with pagination-plus for an A4 document. Formatting is persisted as `Report.richContent`; section text is also extracted into existing report columns so signing checks and existing workflows remain compatible.
- The API validates rich document nodes, marks, allowed formatting attributes, depth, node count, and serialized size. Rich JSON participates in the content hash and is copied into signed report versions. The migration is `apps/api/prisma/migrations/20261116090000_rich_report_content`.
- Only the assigned radiologist can edit or create a report. Signed versions remain immutable and corrections follow the existing correction workflow.
- Prior studies are filtered server-side: radiologists see only assigned finalized priors; hospitals see only released priors from their own hospital. The UI links to the read-only reading view.
- `@axis/types` builds ESM for web and CommonJS for the CommonJS API. Run `pnpm --filter @axis/types build` after changing shared runtime helpers.

## Known incomplete or unverified work

- AI job tracking exists; no ML inference pipeline is connected.
- Routing rule configuration exists; automatic rule evaluation is not complete.
- Live WebSocket/SSE worklist updates are not implemented.
- Delivery records exist; production HL7/FHIR/email/fax integrations are not complete.
- Production desktop signing and signed update feed require operator provisioning.
- Production security/compliance, restore, release, and clinical acceptance remain environment/team responsibilities.

## Useful commands

- `pnpm dev` — web development server.
- `pnpm dev:all` — web and API development servers.
- `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — workspace quality commands.
- `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:migrate:deploy`, `pnpm db:seed` — Prisma/database tasks.
- `docker compose up -d --wait postgres orthanc ohif` — local infrastructure (configure `.env` first).
- See `infra/README.md` for safe local setup and the warning not to remove persistent volumes.

## Documentation and source of truth

- `README.md`: current product overview, API/runtime notes, limitations, and status.
- `PROJECT_DOCUMENTATION.md`: broad project walkthrough; some sections may describe older implementation details.
- `DICOM_SETUP.md`: DICOM ingest and OHIF setup.
- `infra/README.md`: current Compose topology and operational guidance.
- `apps/api/prisma/schema.prisma`: current data model/status enums.
- `apps/api/src/app.module.ts`: active API feature modules.
- `apps/web/src/app/globals.css`: UI design tokens and theme behavior.

When project documentation conflicts, prefer current implementation/configuration and record the discrepancy before making architectural assumptions.
