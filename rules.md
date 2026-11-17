# Coding Rules — Axis

These rules complement the existing package configuration and established patterns. When a rule here and the source disagree, verify the intended behavior and update the code and documentation together.

## General

- Make the smallest change that fully addresses the requirement; avoid unrelated refactors.
- Follow the formatting, naming, imports, and file organization of the surrounding package.
- Use TypeScript types and runtime validation. Avoid `any`, unsafe casts, and broad catch blocks.
- Make failures explicit through repository-standard exceptions, error responses, and logs; do not silently return success-shaped fallback data.
- Keep secrets, credentials, PHI, and real patient examples out of source, tests, logs, screenshots, and fixtures.
- Update directly affected documentation and tests.

## Web (`apps/web`)

- Use the App Router and existing shared components, API client, React Query setup, Zustand store, and `@axis/types` where appropriate.
- Treat the API as the authority for authentication, permissions, and clinical state. Never rely on hidden controls or client route checks for security.
- Keep API calls on the established same-origin path unless a documented architecture change is approved.
- Use CSS custom properties / Tailwind semantic tokens for app theme colors; support dark and light palettes. Preserve the light paper surface and readable ink for clinical report text.
- Include loading, error, empty, and disabled states where the workflow needs them.
- Preserve keyboard access, `:focus-visible`, and reduced-motion behavior. Do not convey clinical urgency by color alone.
- Add focused Vitest coverage for meaningful new behavior, following colocated `*.test.ts` conventions.

## API (`apps/api`)

- Keep controllers focused on HTTP concerns and DTO validation; place business rules in services.
- Validate and transform untrusted request data with DTOs and the configured validation pipeline.
- Enforce role, hospital/tenant, and assignment scope server-side for every protected resource and mutation.
- Use Prisma models/migrations as the persistence contract; preserve transaction and concurrency safeguards used by the affected workflow.
- Audit clinically significant and security-sensitive actions. Do not log passwords, session identifiers, DICOM payloads, or unnecessary patient data.
- Preserve DICOM validation, upload limits, archive safety, and the authorized DICOMweb proxy boundary.
- Use explicit HTTP exceptions for expected failures and structured logging for operational failures. Avoid swallowing exceptions.
- Add focused API tests for authorization boundaries and workflow transitions; run the smallest relevant test suite.

## Shared types and database

- Put types used by both web and API in `packages/types`; build/type-check the package when changing its public exports.
- Keep both ESM and CommonJS outputs of `@axis/types` aligned; the web imports ESM and the NestJS API runs as CommonJS.
- Treat rich report JSON as untrusted input. Validate supported nodes/marks and document bounds on the API, and derive compatibility text fields from the validated document rather than trusting client-supplied copies.
- Make schema changes through Prisma schema and checked-in migrations; do not edit generated client output.
- Treat enum/status changes as workflow changes: check transitions, permissions, UI labels, filtering, seeds, and tests.
- Keep seed/test records synthetic and clearly marked with the existing `AX-SYN` conventions.

## Validation and tests

- Run the narrowest applicable test, lint, typecheck, or build command first; report exactly what ran and any environmental limitation.
- Do not claim a production or clinical workflow is verified by a unit test alone.
- Keep test data deterministic and non-identifying; never use live clinical records.

## Operations and documentation

- Do not commit `.env` files, secrets, database dumps, clinical data, or generated build artifacts.
- Do not remove persistent Docker volumes or modify production data as part of routine development.
- Update the architecture/runbook when changing service boundaries, ports, credentials, data flow, or deployment behavior.
