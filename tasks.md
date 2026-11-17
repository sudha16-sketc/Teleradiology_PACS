# Tasks & Progress — Axis

This is a high-level project tracker, not a substitute for issue-level acceptance criteria. Status reflects the repository documentation and code structure inspected when this file was created; a checked item does not constitute a production readiness or clinical validation claim.

## Existing capabilities

- [x] pnpm workspaces for web, API, desktop, and shared types.
- [x] Local Compose services for PostgreSQL, Orthanc, and OHIF.
- [x] NestJS API with session authentication, global role guards, validation, and feature modules.
- [x] Study/worklist and report/review/correction workflow data models and APIs.
- [x] DICOM upload/ingest path and authenticated DICOMweb proxy to Orthanc.
- [x] Next.js role-aware application routes for hospital, radiologist, manager, and administrator workflows.
- [x] Audit, analytics, SLA, notifications, health, backup, and retention feature areas.
- [x] Tauri Windows desktop shell configured to load a remote deployment.
- [x] Synthetic seed data policy and local infrastructure documentation.

## In progress / operationally incomplete

- [ ] Run the reporting rich-content and prior-study integration tests with local PostgreSQL available; the current editor/API changes typecheck and build, but the e2e run could not connect to `localhost:5432`.
- [ ] Implement and validate live worklist updates (WebSocket or SSE), including reconnect behavior and authorization.
- [ ] Provision and test production Authenticode signing and a signed, HTTPS desktop update feed.
- [ ] Run release acceptance, complete web/API quality gates in the target release environment, and record results.
- [ ] Validate production role, hospital, assignment, and DICOM access boundaries with deployment-like data.
- [ ] Rehearse PostgreSQL and Orthanc backups and restores; document recovery objectives and evidence.

## Planned product work

- [ ] Define and implement a routing-rule evaluation engine; specify deterministic conflict handling and audit behavior.
- [ ] Choose and integrate real report delivery protocols (for example HL7/FHIR) with retries, acknowledgements, and operational monitoring.
- [ ] Define clinical governance, safety review, and data requirements before connecting any AI inference pipeline.
- [ ] Establish production monitoring, alerting, retention, privacy, and incident-response acceptance criteria.
- [ ] Select and configure a CI/CD provider and automated release workflow; none is currently documented as present.

## Before production use

- [ ] Complete threat modeling and security review of authentication, tenant isolation, DICOM ingest, viewer proxy, and desktop navigation.
- [ ] Configure HTTPS, proxy trust, CORS allow-list, secure session secrets, secret storage, network controls, and least-privilege service credentials.
- [ ] Verify backup encryption, retention, restoration, audit access, and operational ownership.
- [ ] Confirm legal/regulatory requirements and obtain the organization's compliance approval; the project is not itself a compliance certification.
- [ ] Validate with approved de-identified test studies and trained clinical users; do not use development seed data as clinical evidence.
- [ ] Document release versioning, installer signing, update feed ownership, rollback, and support process.

## Progress hygiene

- Move a task to complete only after its acceptance criteria are met and evidence is recorded.
- Keep implementation tasks small enough to test and review independently.
- Add owners, dates, priority, and links in the issue tracker when the team establishes those conventions.
- Reconcile this summary with repository state when starting a substantial release or planning cycle.
