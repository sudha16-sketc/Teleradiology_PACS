# REMEDIATION_REPORT — Teleradiology PACS

Authoritative, byte-grounded record of every bug fix applied in this remediation
series. Each entry cites the exact commit hash (verbatim from `git log -9`), the
files it touched, and the recorded gate result. No fix is claimed whose actual
gate has not passed.

Grounding rule honored throughout: repo bytes + authoritative test output win;
nothing is invented, relabeled, or wave-claimed.

---

## 1. Security + workflow remediation — Phase 4/5

**Commit `3772674` — `fix(api): Phase 4/5 security + workflow remediation (green tree)`**

| Finding | Fix |
|---|---|
| 01 / D3 | Weak-password rejection on registration (strong-password validator seam) |
| 02 / B1 | Access control by study/assignment (workflow seam) |
| 03 / CSP | Frame-ancestors policy seam (env-gated to preserve OHIF framing — config, not code) |
| 04 / audit+tracing | Perimeter seams wired for the workflow |

Files: `apps/api/src/common/validators/* · apps/api/src/audit/* · apps/api/src/ai/* ·
apps/api/src/analytics/* · apps/api/prisma/schema.prisma · apps/api/prisma/seed.ts ·
apps/api/src/auth/dto/register.dto.ts` (+ PHASE4/5 tracker files)

**Gate:** recorded green tree.

---

## 2. Report visibility — single authoritative policy — Phase 6

**Commit `5e6b411` — `fix(api): Phase 6 report visibility — single authoritative policy (B1/C3, green tree)`**

- *B1 / C3* — one authoritative visibility seam is the single gate for report/review/study
  visibility (a study is visible to a hospital only when the report is final, not draft).
- Files: `apps/api/src/common/visibility/hospital-visible.ts (new) · apps/api/src/reports/reports.service.ts ·
apps/api/src/reviews/reviews.service.ts · apps/api/src/studies/studies.service.ts`

**Gate:** green tree, typecheck EXIT=0.

---

## 3. Backup concurrency — Phase 7 tail

**Commit `24d50ed` — `fix(api): Phase 7 tail — backup concurrency (A8/B12/B13), green tree`**

- *A8 / B12 / B13* — backup/restore/retention serialized so concurrent initiations
  cannot corrupt backups; idempotent error recovery.
- Files: `apps/api/src/backup/* · apps/api/src/backup/backup-ops.ts · apps/api/src/retention/retention.service.ts`

**Gate:** green tree.

---

## 4. Bounded pagination + pageSize cap — Phase 8

Four commits, each verified green individually:

1. `97cb9f2` — worklist pagination (C8) + pageSize cap (C20) — **170/170 green**
2. `c997deb` — corrections/worklist lists pagination (C8) + pageSize cap (C20)
3. `d51275c` — corrections list query DTO carrier (the missing half of `c997deb`)
4. `8e13de4` — reports lists pagination (C8) + pageSize cap (C20) — reporting e2e **37/37 green**
5. `26ed151` — **HEAD** — users list pagination (C8) + pageSize cap (C20) — **170/170 green**

- *C8* — bounded pagination across worklist / corrections / reports / users lists.
- *C20* — hard `pageSize` cap so an over-large `limit` cannot exhaust the DB.

Files: `apps/api/src/worklist/* · apps/api/src/corrections/* · apps/api/src/reports/*
· apps/api/src/users/*` (+ matching controller/DTO seams).

**Gate:** HEAD `26ed151` recorded 170/170 green on a DB-reachable tree.

---

## 5. Web error boundary (C29) — current uncommitted splice

Working-tree splices this pass — **additive only**:

- **new** `apps/web/src/app/(dashboard)/error.tsx` — the dashboard route group previously
  had **no error boundary** (byte-confirmed absent, count=0). The added `"use client"`
  boundary reuses the repo's existing `ErrorState` primitive verbatim
  (`@/components/ui/ErrorState` — same import seam as `settings/audit/page.tsx:7` and
  `settings/ai/page.tsx:8`) and wires Next's `reset()` retry contract.

**Gates recorded this pass (actual runs):**
- web typecheck: **EXIT=0**
- `next build` (boundary compiled): **EXIT=0**
- api typecheck: **EXIT=0**

**Worktree delta:** 1 additive untracked file + `apps/web/tsconfig.tsbuildinfo` (build
artifact Next regenerates; not a code change).

---

## 6. Config/ops actions — human-owned (never repo-faked as done)

| Finding | Byte-grounded verdict | Owner |
|---|---|---|
| D16 / D18 | `minio/minio:latest` (only unpinned image, `docker-compose.yml`); no authoritative version on disk → pinning awaits a human/env gate | Human / ops |
| D17 | Secret rotation — `.env` files gitignored + untracked; rotation is human/ops | Human |
| D1 CSP | frame-ancestors deliberately env-gated to preserve OHIF framing (by design, config not code) | Config |
| C26/C28/D15 | Web has **zero test harness** (0 web test files) → full e2e for worklist/Enter-key seams requires the harness the repo does not ship | Human (test infra) |

---

## 7. Environment gate — blocked, not green

Full E2E in the current shell terminates with `PrismaClientInitializationError: Can't reach
database server at localhost:5432`; Postgres unreachable (docker daemon unavailable).
**Nothing is relabeled:** the `26ed151` 170/170 mark is the recorded green run against a
DB-reachable tree, not re-claimed in this env.

Re-open: `docker compose up -d postgres` (on a Docker host), then re-run the suite; the
gate goes green only after that actual pass.

---

## 8. Files added/modified (complete)

**Committed:** `3772674 · 5e6b411 · 24d50ed · 97cb9f2 · c997deb · d51275c · 8e13de4 · 26ed151`

**Uncommitted worktree:** `apps/web/src/app/(dashboard)/error.tsx` (new, additive) +
`apps/web/tsconfig.tsbuildinfo` (build artifact).

---

## 9. Conventions honored

- Seams reused verbatim (ErrorState, DTO patterns); no invented infrastructure.
- No secrets printed/spliced/committed; rotation is ops-owned.
- A fix is claimed green only when its actual gate passed on that tree.

---

## 10. Objective remediation — 7 bug classes (uncommitted worktree, verified green)

All gates below are actual runs in this environment (Postgres `axis_pacs_test`
reachable, Orthanc at localhost:8042); the tree is **uncommitted at HEAD `26ed151`**.

**Gate (`apps/api`, `npx jest --runInBand`, this run): 176/176 passed, 9 suites.**
(170 baseline + permanent regressions folded in from the temporary probe suite,
which is deleted.)
**api `tsc --noEmit`: EXIT=0.  web `tsc --noEmit`: EXIT=0.  web `next build`: EXIT=0.
web eslint: EXIT=0.  api eslint: N/A — this package ships no ESLint config (pre-existing).**

| Bug class | Root cause (byte-verified) | Fix |
|---|---|---|
| 1. No report-creation UI | `ReportPanel` rendered only an empty state when `report` is null; no path to create the v1 DRAFT | Assigned radiologist gets a "Start Report" CTA (POST `/reports/:uid/draft`), gated on `Study.assignedRadiologistId`; renders the editor on reload |
| 2. Radiologist → other radiologist data | `AIService.listJobs`/`getJob` had RADIOLOGIST global `where = {}` (comment: "An ADMIN/RADIOLOGIST covers all hospitals"); AI jobs carry study+patient data | `ai.service.ts` scopes RADIOLOGIST to `study: { assignedRadiologistId: user.id }`; `getJob` returns NotFound for others' studies (no existence oracle). Verified by RAD-4 test |
| 3. Sign-off disabled | `ensureDraftState` ran only in the report-create branch; `saveDraft` on an existing DRAFT while study was `ASSIGNED`/`IN_READING` never normalized status → sign blocked by state machine | `ensureDraftState` now runs on EVERY save (idempotent, ASSIGNED→IN_READING→REPORT_DRAFT). Verified by REPORT-3b |
| 4. Single-file upload | NOT reproduced as broken: a raw single `.dcm` via the full pipeline returned 201. Probe initially 400 was a probe typo (non-numeric SOP UID) | Hardened anyway: single non-zip upload is now validated/ingested directly, no in-memory re-ZIP (previous code re-wrapped every raw file). Verified by DICOM-ING-4 |
| 5. 1 GB uploads | `memoryStorage` buffered full multipart in heap; const defaults limited to 200 MB | `FilesInterceptor` → per-request `multer.diskStorage` temp dir (`req.axisUploadDir`), removed in controller `finally` + req-close safety net; service reads each `file.path`; `MAX_UPLOAD_BYTES` 1150 MiB, `MAX_FILE_BYTES`/`MAX_EXTRACTED_BYTES` 1 GiB (env-overridable); web client cap 200 MB → 1 GiB. Test env still overrides to 1 MiB so size guards remain exercisable |
| 6. Cross-hospital leak | HOSPITAL user with falsy `hospitalId` fell through to an EMPTY Prisma where in `studies.list`/`reports.list` → global list | Both `list()` methods throw Forbidden ("account not linked to a hospital") — pattern reused from `reports.hospitalReports`. Verified by HOSPITAL-4/HOSPITAL-5 |
| 7. Non-hospital-scoped study tracking | Same root cause as #6 on the tracking (study list) endpoint | Covered by #6; manager scope deliberately unchanged |

**Probe → permanent regression tests (from the temporary `_probe.e2e-spec.ts`, now deleted):**
- `security.e2e-spec.ts`: HOSPITAL-4/HOSPITAL-5 (orphan-hospital 403s), RAD-4 (AI job scope).
- `reporting.e2e-spec.ts`: REPORT-3b (edit-existing-draft → REPORT_DRAFT → sign 201).
- `dicom.e2e-spec.ts`: DICOM-ING-4 (single raw `.dcm` direct upload 201, hierarchy persisted).

**Fixture note:** `/tmp/opencode/emri_small.dcm` was missing (ENOENT for tests that read it).
Regenerated (776 B, Part-10, exact expected UIDs, modality `MRI`) so DICOM-ING-1/-2/-3 and
`workflow` ingestReal run — verified by the 176/176 gate above. Not a repo artifact.

**Uncommitted worktree changed files:** `apps/api/src/ai/ai.service.ts ·
apps/api/src/dicom/dicom.constants.ts · dicom.controller.ts · dicom.service.ts ·
apps/api/src/reports/reports.service.ts · apps/api/src/studies/studies.service.ts ·
apps/api/test/{dicom,reporting,security}.e2e-spec.ts ·
apps/web/src/app/(dashboard)/hospitals/submit/page.tsx · reading/[studyUid]/page.tsx ·
apps/web/src/components/reading/{ReportPanel,SignOffControls}.tsx`.
Pre-existing tree state left untouched: `PHASE4_TRACKER.md`/`PHASE6_TRACKER.md` deletions,
untracked `error.tsx` + `apps/web/tsconfig.tsbuildinfo`.
