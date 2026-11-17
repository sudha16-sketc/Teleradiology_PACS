# Product Requirements — Axis

## Product summary

Axis is a teleradiology PACS workflow and clinical reporting platform. It coordinates diagnostic imaging studies from hospital submission through image review, report approval, and delivery. Axis manages workflow and authorization; Orthanc stores DICOM objects and OHIF displays them.

## Users

| Role | Primary needs |
| --- | --- |
| Hospital user | Submit studies, follow their progress, review released reports, and request corrections. Access is limited to their hospital. |
| Radiologist | Review assigned studies and images, write and sign reports, and handle corrections. |
| Manager | Triage and assign studies, monitor workflow and service levels, and review reports. |
| Administrator | Manage users and operational settings, review audit activity, and oversee the platform. |

Roles and permitted actions are enforced by the API, not only hidden in the interface.

## Goals

- Provide one traceable workflow from study intake to hospital review.
- Let authorized clinicians view DICOM images without exposing Orthanc directly to the browser.
- Make report authorship, review, approval, corrections, and delivery status visible.
- Protect tenant and assignment boundaries for hospital and radiologist users.
- Give operations staff worklists, audit history, and service-level visibility.
- Support browser and Windows desktop access to the same deployment.

## Core workflows

1. A hospital user submits a DICOM study; the API validates and imports it into Orthanc and records metadata in PostgreSQL.
2. The study is validated, placed in the appropriate queue, and assigned to a radiologist.
3. The assigned radiologist reviews images in OHIF through the authenticated DICOMweb proxy and prepares a report in the paginated A4 report editor. Structured clinical sections support rich text, autosave, draft save, and sign-off.
4. The report proceeds through the configured radiologist/manager review process. Critical findings and correction activity are recorded.
5. An authorized user releases the report to the hospital. The hospital reviews it or requests a correction.
6. User actions and important workflow transitions are auditable.

The actual supported study and report status values are defined in `apps/api/prisma/schema.prisma`; use that schema rather than assuming a simplified lifecycle.

## Product scope

### In scope

- Role-aware login and registration approval, hospital and user administration.
- Study submission, DICOM ingest, study metadata, worklists, assignment, and status tracking.
- Reading room integration with OHIF and the API-authorized DICOMweb path.
- Report editing, review/sign-off, report history, and correction workflows.
- Rich report formatting is persisted with the report and its immutable signed version; legacy plain-text fields remain available to workflow checks and existing consumers.
- Prior studies are shown only when visible under the viewer's assignment or hospital boundary and are opened in the read-only reading workflow.
- Notifications, analytics, audit views, SLA configuration, and operational backup/retention tooling as implemented in the application.
- A Tauri desktop shell that connects to a configured remote Axis deployment.

### Explicitly not promised as complete

- Automated AI inference: AI job tracking exists, but no inference pipeline is connected.
- Automatic execution of routing rules: configuration/UI exists, but a complete rule evaluation engine is not available.
- Live WebSocket/SSE worklist updates.
- Production delivery integrations such as HL7/FHIR, email, or fax unless separately implemented and verified.
- Production compliance certification. “HIPAA-aligned” design language is not a certification or guarantee.

## Requirements and acceptance criteria

- A user can only perform actions allowed by their role and organization/assignment scope; direct API requests must enforce the same restrictions as the UI.
- DICOM ingest validates submitted content and persists matching workflow metadata. Failures are explicit and leave a traceable outcome.
- Image requests from the viewer pass through the authenticated API authorization proxy.
- Report changes and review actions preserve the available version/history semantics and are attributable to an authenticated user.
- Only the assigned radiologist can create or edit a study report; server validation derives compatibility text fields from the rich document and rejects unsupported document nodes.
- Hospitals can only view their own studies and released reports.
- Pages provide clear loading, empty, error, and successful-action feedback.
- Clinical information is not silently replaced with mock or success-shaped fallback data in operational flows.
- The UI remains usable with keyboard navigation, visible focus, and reduced-motion preferences.
- Development seed/sample data is clearly synthetic and must not be mixed with real patient information.

## Quality attributes

- **Security and privacy:** least privilege, server-side authorization, secure session handling, input validation, PHI minimization, and protected secrets.
- **Reliability:** explicit errors, health/readiness visibility, durable workflow persistence, and documented backup/restore operations.
- **Performance:** paginated/filterable lists and bounded DICOM upload handling.
- **Auditability:** record security-sensitive and clinically meaningful actions with actor and time.
- **Maintainability:** shared types and established workspace/module patterns.

## Product measures to establish

No target service levels are prescribed here. Instrument and agree targets for study intake success, median and percentile turnaround time, correction rate, delivery success, queue age/SLA breaches, and operational availability before production use.
