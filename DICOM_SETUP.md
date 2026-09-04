# DICOM Setup & Real Dataset Import Guide

This document describes how the Teleradiology PACS **DICOM ingest pipeline**
is set up, how to obtain and import a **real, de-identified DICOM dataset**,
and how the Orthanc / DICOMweb / OHIF layers connect. It is a companion to
the Phase 2 (DICOM ingest) implementation.

---

## 1. Architecture overview

```
Hospital UI (apps/web)
      │  multipart POST /api/dicom/ingest  (file field "file")
      ▼
apps/api  DicomController → DicomService
      │
      ├─ 1. ZIP safety validation (extractDicomArchive)
      │        • Zip-Slip / path-traversal, entry-count, per-file size,
      │          total extracted size, nested archive, executable rejection
      │  + 2. DICOM parsing & validation (parseDicomBuffer / validateDicomIdentifiers)
      │        • Part-10 meta header + dataset, required UID checks
      │  + 3. Persist Patient → Study (`RECEIVING`) + audit STUDY_UPLOADED
      │  + 4. POST each instance  →  Orthanc REST /instances
      │          (returns exact Patient/Series/Study/Instance internal IDs)
      │  + 5. Persist Series + Instance rows (with orthanc* IDs)
      │  + 6. Finalize Study `UNASSIGNED`, create WorklistItem
      │        + audit DICOM_IMPORTED
      ▼
   PostgreSQL (axis_pacs)             Orthanc (localhost:8042)
   Patient / Study / Series /         stores the actual pixel data,
   Instance / WorklistItem            exposes DICOMweb
                                        │
      resources served to OHIF via  ───┘
      /api/dicom-web proxy (RBAC + session guarded)
      ▼
   OHIF viewer (axis-ohif, :3001) proxied at /ohif by apps/web
```

Key design decisions (avoiding brittle heuristics):

- **Per-instance `POST /instances`** instead of STOW-RS batch. Orthanc returns
  the exact `ParentStudy` / `ParentSeries` / `ParentPatient` / `ID` in a single
  response, so we map real PACS identifiers back to PostgreSQL rows with no
  "find new study" guesswork. Orthanc is idempotent by SOP Instance UID and
  may answer `Status: "Success"` **or** `Status: "AlreadyStored"`; both are
  treated as success.
- **Hospital ownership always comes from the authenticated user**
  (`request.user.hospitalId`), never from the request body.

---

## 2. Real, de-identified DICOM dataset

The pipeline is verified against a real DICOM MR volume from the
**pydicom test-data repository**, which is freely redistributable and public.

- **File:** `emri_small.dcm` (~84 KB, single-slice MR, brain)
- **SOP Class:** `1.2.840.10008.5.1.4.1.1.4.1` (MR Image Storage)
- **Transfer Syntax:** `1.2.840.10008.1.2.1` (Explicit VR Little Endian)
- **Modality:** MR
- **Patient name / ID:** empty (already de-identified)
- **Source:** https://github.com/pydicom/pydicom-data

> This file is intentionally **not committed** to the repository. Download it
> into a scratch location (e.g. `/tmp/opencode`) for local testing. If you
> have your own de-identified DICOM, it works identically.

### Download

```bash
mkdir -p /tmp/opencode
curl -L -o /tmp/opencode/emri_small.dcm \
  https://raw.githubusercontent.com/pydicom/pydicom-data/master/data_store/data/emri_small.dcm
```

### Licensing / usage note

The pydicom test data set is published under a permissive license for
testing and is fully de-identified. Treat it as **synthetic / non-clinical**
data. Do **not** upload real protected-health-information (PHI) into a dev
environment. For production validation, use a properly de-identified dataset
governed by your organization's policies.

---

## 3. Orthanc setup

- Container: `axis-orthanc`, bound to `http://localhost:8042`.
- Config: `infra/orthanc/orthanc.json`
  - DICOMweb plugin enabled (`/dicom-web`).
  - `AuthenticationEnabled: false` for the dev image.
- REST auth (used by the API, from `apps/api/.env`):
  `ORTHANC_USERNAME=orthanc`, `ORTHANC_PASSWORD=orthanc`.

Verify it is reachable:

```bash
curl -s http://localhost:8042/system | head -c 300
# → {"Version":"...","ApiVersion":27, ...}
```

Instances you POST land at `/instances` and are also exposed over DICOMweb
(e.g. `GET /dicom-web/studies`).

---

## 4. apps/api environment (`apps/api/.env`)

```ini
ORTHANC_URL=http://localhost:8042
DICOMWEB_URL=http://localhost:8042/dicom-web
ORTHANC_USERNAME=orthanc
ORTHANC_PASSWORD=orthanc
# Optional DICOM limits (bytes / counts) — defaults are 200 MiB / 4000 entries.
# AXIS_DICOM_MAX_UPLOAD_BYTES=209715200
# AXIS_DICOM_MAX_FILE_BYTES=209715200
# AXIS_DICOM_MAX_EXTRACTED_BYTES=209715200
# AXIS_DICOM_MAX_ENTRY_COUNT=4000
```

Run the schema migration (requires the test DB too, for e2e):

```bash
cd apps/api
pnpm db:generate
pnpm db:migrate
DATABASE_URL="postgresql://axis:axis_dev@localhost:5432/axis_pacs_test" npx prisma migrate deploy
```

---

## 5. DICOMweb proxy (`/api/dicom-web`)

`apps/web/next.config.mjs` rewrites `/api/:path*` to the API (`:4000`). The API
exposes a full DICOMweb proxy at `/api/dicom-web` that:

- authenticates via `axis_session` cookie + RBAC, then
- forwards QIDO-RS / WADO-RS / WADO-URI to Orthanc's `/dicom-web`.

This guarantees a radiologist can only WADO images they are authorized to
read (tenant + assignment isolation is enforced at the proxy).

---

## 6. OHIF setup

- Container: `axis-ohif`, published `:3001` → internal `:80`.
- Config: `infra/ohif/app-config.js`
  - `routerBasename: '/ohif'`
  - `extensions` / `modes` arrays present (required by OHIF).
  - DICOMweb `qidoRoot` / `wadoRoot` → `http://localhost:3000/api/dicom-web`
    (all traffic through the Axis API proxy).
- `apps/web/next.config.mjs` rewrites `/ohif/:path*` → `:3001` so the viewer
  is same-origin with the app and inherits the session cookie.

Verify the viewer serves:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/ohif/
```

---

## 7. Import procedure (manual E2E)

1. Start the API + web dev servers (and ensure postgres, orthanc, ohif are up).
2. Log in as a hospital user (e.g. `registrar@citygeneral.com`).
3. On the hospital "Submit Study" flow, pick the real DICOM (either the raw
   `.dcm` or zipped as `study.zip`).
4. The API validates the ZIP, parses DICOM, stores instances in Orthanc, and
   persists `Patient → Study → Series → Instance` in PostgreSQL; the study is
   released to the manager worklist as `UNASSIGNED` and emitted
   `STUDY_UPLOADED` + `DICOM_IMPORTED` audit events.
5. A manager assigns the study to a radiologist.
6. The radiologist opens the study; OHIF loads the real image through the
   `/api/dicom-web` proxy.

See the Phase 2 automated e2e (`apps/api/test/dicom.e2e-spec.ts`) for the
scripted equivalent of this flow.

---

## 8. Related files

- `apps/api/src/dicom/dicom.constants.ts` — limits + UID/transfer-syntax tables
- `apps/api/src/dicom/dicom.parser.ts` — Part-10 / raw DICOM parsing + validation
- `apps/api/src/dicom/zip-archive.ts` — hardened ZIP extraction
- `apps/api/src/dicom/dicom.service.ts` — ingest orchestration + Orthanc mapping
- `apps/api/src/dicom/dicom.controller.ts` — multipart ingest endpoint
- `apps/api/prisma/schema.prisma` — `Series.orthancSeriesId`,
  `Instance.orthancInstanceId`, new `AuditAction` values
- `infra/orthanc/orthanc.json`, `infra/ohif/app-config.js` — service configs
