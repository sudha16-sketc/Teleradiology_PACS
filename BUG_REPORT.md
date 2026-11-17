# AXIS Teleradiology PACS — Full Codebase Bug & Loophole Report

**Date:** 2026-09-17
**Scope:** Entire monorepo (apps/api, apps/web, packages/types, infra config, DB schema/migrations)
**Method:** Systematic read-through audit of every source file across 6 focus areas (auth/security, DICOM, clinical workflow, admin/ops, frontend, schema/config). Every finding below is verified against actual code at the cited `file:line`.

---

## Severity Legend
- **CRITICAL** — Remote compromise, full data breach, auth bypass, or permanent data destruction.
- **HIGH** — Significant data exposure, integrity break, or availability loss with moderate effort.
- **MEDIUM** — Meaningful bug/loophole; needs conditions or manual effort to exploit.
- **LOW** — Minor defect, defense-in-depth gap, or hygiene issue.

---

# A. CRITICAL FINDINGS

## A1. DICOMweb proxy is an unrestricted authenticated reverse proxy to the full Orthanc REST API (privilege escalation, SSRF, PHI exfiltration, data destruction)
- **Location:** `apps/api/src/dicomweb/dicomweb.service.ts:44-55, 131-180`; `apps/api/src/dicomweb/dicomweb.controller.ts:21-44`
- **Details:** The request path is appended verbatim onto the fixed base `http://<orthanc>/dicom-web`. URL normalization collapses `..` segments, so `GET /api/dicom-web/../../patients` becomes `GET http://orthanc:8042/patients`. `authorizeStudyAccess` (dicomweb.service.ts:81-129) only gates paths that contain `/studies/<uid>` and returns early at line 89 for everything else — traversal paths contain no `/studies/` segment, so the study-scope check never runs.
- **Impact:** Any authenticated RADIOLOGIST/HOSPITAL/MANAGER can reach every Orthanc REST endpoint: exfiltrate all hospitals' PHI (`GET /patients`, `/studies`), delete studies (`DELETE /studies/<id>`), inject arbitrary DICOM that bypasses the vetted ingest pipeline, and use `POST /modalities/<name>/store` or `/peers/*` as SSRF to arbitrary external DICOM endpoints.

## A2. JWT signing secret is publicly known whenever `AUTH_SECRET` is unset; validation only fires under the exact string `"production"`
- **Location:** `apps/api/src/auth/auth.constants.ts:7-9`; `apps/api/src/common/config/env-validation.ts:9-14, 25-36`; `apps/api/.env.example:29`
- **Details:** `sessionSecret()` falls back to the hardcoded `'axis-dev-secret-change-in-production'`. The fail-fast guard only runs when `NODE_ENV`/`AXIS_ENV` is **exactly** `'production'`, and even then only rejects that one literal value. `NODE_ENV=prod`, an unset var, or following the `.env.example` value `change-me-to-a-long-random-value-in-production` all pass validation while using a **repo-public** signing secret.
- **Impact:** Anyone can `jwt.sign({sub: <any user id>}, <public secret>)` and mint a valid `axis_session` cookie, giving full ADMIN session — complete authentication bypass across study/report/correction/backup APIs.

## A3. AI module has no authorization → cross-hospital PHI dump for any authenticated user
- **Location:** `apps/api/src/ai/ai.controller.ts:28-40` (no `@Roles()`); `apps/api/src/ai/ai.service.ts:22-27, 44-47`
- **Details:** `RolesGuard` (auth/roles.guard.ts:20) returns `true` when no role metadata exists. Any role — including HOSPITAL — can call `GET /api/ai/jobs` and `GET /api/ai/jobs/:id`. The service does `include: { study: { include: { patient: true } } }`, returning full patient objects (name, DOB, gender, hospitalId) plus AI results for **every** study in **every** hospital. `getJob` is a pure IDOR by id.
- **Impact:** Any low-privilege user can enumerate all patients' PHI and AI results across all tenants.

## A4. Hardcoded production credentials committed in seed scripts
- **Location:** `apps/api/prisma/seed.ts:72-73, 122-189` (and `upsertUser` update branch at `:40-49`)
- **Details:** Static, in-repo passwords `'Admin@123456'` and `'AxisDev123!'` are hashed and upserted. `upsert` **resets the password and forces role ADMIN** on any existing user with that email (update branch). Wired to `pnpm db:seed` (root package.json:19). No production guard (unlike create-admin.ts).
- **Impact:** Running the documented seed against a real DB instantly creates/hijacks a known-password ADMIN account, and overwrites a legitimate admin's credentials → login takeover.

## A5. Cross-tenant "study takeover" via globally-unique StudyInstanceUID
- **Location:** `apps/api/src/dicom/dicom.service.ts:273-318`; constraint `apps/api/prisma/schema.prisma:290` (`studyInstanceUid @unique`)
- **Details:** When an upload's StudyInstanceUID already exists (unique system-wide, independent of hospital), the code `update`s the study with the **current caller's** `hospitalId` (line 287) plus patient/accession/date/modality fields (299-307), and flips status back to `RECEIVING` → `UNASSIGNED` (404, 409). A HOSPITAL who uploads (or forges) a DICOM carrying another hospital's UID silently steals that study.
- **Impact:** Original hospital loses DICOMweb/worklist access; the study references the old hospital's patientId while owned by the attacker's hospital (inconsistent rows). Concurrent first-time uploads of the same UID also race the unique constraint → 500.

## A6. Unbounded in-memory multipart uploads → RAM-exhaustion DoS; `MAX_UPLOAD_BYTES` is dead config
- **Location:** `apps/api/src/dicom/dicom.controller.ts:31-38`; `apps/api/src/dicom/dicom.constants.ts:10`
- **Details:** `memoryStorage()` buffers every file fully in RAM. Limits are per-file (`MAX_FILE_BYTES`, 200 MB) and per-count (4000 files) with **no aggregate byte limit**: one request can hold 4000 × 200 MB in memory before validation, and the raw-instance path then re-zips and re-extracts it in memory (dicom.service.ts:199-217). `DICOM_LIMITS.MAX_UPLOAD_BYTES` is referenced nowhere — tuning the env var has zero effect. Only a 20 req/min IP rate limit mitigates.

## A7. Zip-bomb bypass: declared size = 0 defeats both decompression guards
- **Location:** `apps/api/src/dicom/zip-archive.ts:104-106, 125-129`; adm-zip `methods/inflater.js:5`
- **Details:** The pre-decompression check and adm-zip's inflater cap both key off the **declared** uncompressed size (`entry.header.size`). A DEFLATED entry declared with size `0` passes the pre-check and disables the cap (`expectedLength > 0` false) → `zlib.inflateRawSync` runs unbounded. The post-decompression check fires only after a gigabyte-scale buffer is already allocated.
- **Impact:** Memory-exhaustion DoS from a single tiny archive; CRC check passes if the attacker emits a well-formed bomb.

## A8. `exportOrthancVolume` always fails — `maxBuffer: 0` is not "unlimited"
- **Location:** `apps/api/src/backup/backup-ops.ts:69-73`
- **Details:** `execFileAsync(podman, ['volume','export',...], { maxBuffer: 0, encoding: 'buffer' })`. Node treats `maxBuffer: 0` as a zero-capacity stdout buffer; **any** stdout output aborts with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. Orthanc volume export always writes stdout.
- **Impact:** Every DICOM/FULL backup run fails (`backup.service.ts:109` → status `FAILED`). DICOM backups are entirely broken; a DB dump produced in a FULL run is discarded/orphaned.

---

# B. HIGH FINDINGS

## B1. Hospital can read full report content (incl. live drafts) before delivery — `GET /studies/:studyUid`
- **Location:** `apps/api/src/studies/studies.service.ts:113-135` (include at `:120-124`), scoping at `:377-391`
- **Details:** `getByUid` returns the latest report (any status, including DRAFT) to anyone passing `assertCanView`, whose HOSPITAL branch checks only hospitalId match — no workflow-status gate. This bypasses the explicit `HOSPITAL_VISIBLE_STATES` policy enforced in reviews.service.ts:26-31 and reports.service.ts:136-149.
- **Impact:** Premature PHI disclosure; a hospital user can watch the radiologist's in-progress draft and read reports in RADIOLOGIST_SIGNED / MANAGER_REVIEW / MANAGER_APPROVED states.

## B2. Radiologist can mark a study `RADIOLOGIST_SIGNED` without any (signed) report
- **Location:** `apps/api/src/studies/studies.service.ts:300-318`; transition table `:15-33` (line 22), actors `:35-53` (line 43); controller `studies.controller.ts:56` (no `@Roles`)
- **Details:** `requiresSignedReport` starts at `MANAGER_REVIEW` and explicitly omits `RADIOLOGIST_SIGNED`. An assigned radiologist can drive `ASSIGNED→IN_READING→REPORT_DRAFT→RADIOLOGIST_SIGNED` purely via status PATCHes — forging a "signed" state with no authored report, bypassing `ReportsService.signOff` integrity.
- **Impact:** Integrity anchor for the entire delivery chain can be faked; combined with B3/B4 it moves studies all the way to hospital delivery.

## B3. `POST /reports/:studyUid/amend` creates a new draft version in ANY study state — breaks report immutability
- **Location:** `apps/api/src/reports/reports.service.ts:518-581`; `reports.controller.ts:160-168`
- **Details:** `amend` only checks `assertAssignedRadiologist` — no study-status/state-machine check. The assigned radiologist can reopen a `COMPLETED`/`HOSPITAL_ACCEPTED`/`DELIVERED_TO_HOSPITAL` study and create a new DRAFT vN+1. `getLatestReport` orders by version desc, so the new draft silently replaces already-delivered content, then can be re-signed without any correction workflow.

## B4. `POST /reports/:studyUid/validate` bypasses the sign workflow and can un-sign reports
- **Location:** `apps/api/src/reports/reports.service.ts:609-633`; `reports.controller.ts:170-178`
- **Details:** A MANAGER/ADMIN can force any report to `SIGNED` without findings/impression, without creating an immutable ReportVersion snapshot, and without setting `signedOffBy/signedOffAt`; it also sets `study.status = MANAGER_REVIEW` from any state. Conversely `dto.status='DRAFT'` flips a SIGNED report back to DRAFT so it can be silently edited. No completeness check, no version snapshot, no state validation.

## B5. `respondChangeRequest` has no status/state checks — radiologist can yank completed studies back to `IN_READING`
- **Location:** `apps/api/src/reports/reports.service.ts:688-708`; `reports.controller.ts:217-225`
- **Details:** Only `assignedToId === actor.id` is checked. A radiologist can respond to an already RESOLVED/REJECTED change request still carrying their id; line 703 unconditionally sets `study.status = IN_READING`, moving COMPLETED/DELIVERED studies back into the workflow with no transition audit or state check.

## B6. Concurrent assignment race — double claim / two active reviewers
- **Location:** `apps/api/src/worklist/worklist.service.ts:272-275, 315-371`
- **Details:** The pre-check reads the study outside the transaction; two concurrent assigns for two radiologists both observe the same pre-state, both create **active** Assignment rows and both set `study.assignedRadiologistId` (last writer wins) → two active reviews, inconsistent with the study row. No `FOR UPDATE`/serializable isolation.

## B7. Concurrent `signOff` — double-sign, duplicate immutable ReportVersion snapshots
- **Location:** `apps/api/src/reports/reports.service.ts:419-508`
- **Details:** The double-sign guard re-reads the latest report inside the transaction but under READ COMMITTED with no row lock; two concurrent sign POSTs both read DRAFT, both sign, both create duplicate ReportVersion rows (no unique `(studyId, version)` constraint at schema.prisma:395-425) and duplicate audits.

## B8. Analytics grants MANAGER global (cross-hospital) visibility
- **Location:** `apps/api/src/analytics/analytics.controller.ts:9-25`; `analytics.service.ts:18-85, 117-131`
- **Details:** Endpoints are `@Roles('ADMIN','MANAGER')` but the service performs **no hospital scoping** (the pattern exists correctly in audit.service.ts:64-81). A MANAGER of Hospital A sees every other hospital's study counts, TAT, SLA compliance, and delivery success rates.

## B9. Admin user-management actions are entirely un-audited
- **Location:** `apps/api/src/users/users.service.ts:43-140` (create/update/remove); UsersModule doesn't import AuditModule
- **Details:** Role escalation, suspension, and deletion by an admin leave **zero audit trail**. Contrast with auth flows which do audit.

## B10. The only generic mutation-audit interceptor is dead code
- **Location:** `apps/api/src/common/interceptors/audit.interceptor.ts:12`
- **Details:** Defined but never registered — no `APP_INTERCEPTOR`, no `useGlobalInterceptors`, no `@UseInterceptors`. The intended POST/PATCH/PUT/DELETE audit never runs. Additionally its design labels every mutation `STUDY_STATUS_CHANGED` with `body?.studyInstanceUid || url`, so non-study mutations would be misrecorded. Ad-hoc audit writes elsewhere use `.catch(() => {})` and silently swallow failures (auth.service.ts:71-81, 132-141, 213-223, 250-260).

## B11. Sessions are not revocable; logout does not invalidate the token; no password-change endpoint
- **Location:** `apps/api/src/auth/auth.service.ts:118-158`; verification `auth.guard.ts:39`
- **Details:** Stateless JWT with no `jti`/server-side store. `logout()` only clears the cookie; the token remains valid until expiry (default 3600s). There is no password-change endpoint at all, so a stolen cookie keeps full validity. Account suspension IS enforced per-request (auth.guard.ts:57-60).

## B12. Retention "verified backup" gate accepts unverified COMPLETED backups
- **Location:** `apps/api/src/retention/retention.service.ts:45-47, 60`
- **Details:** `backupExists` counts runs with status `VERIFIED` **or** `COMPLETED`. Combined with A8 (backups always fail yet can be marked COMPLETED), studies can be marked archived with no trustworthy backup — disabling the safety gate against permanent data loss.

## B13. Backup filename collisions + no run concurrency control → corrupted/overwritten artifacts
- **Location:** `apps/api/src/backup/backup.service.ts:13-19, 46-55, 80, 91`
- **Details:** Artifact names use second resolution (`db_<ts>.sql`, `orthanc_<ts>.tar`). Two concurrent runs compute identical paths, both write the same file → interleaved/truncated backups. No check for an existing RUNNING run. `verifyChecksum` re-reads those racy files → TOCTOU.

## B14. Deleting a user crashes with a DB FK error (and is often impossible)
- **Location:** `apps/api/src/users/users.service.ts:134-140`; FK constraints `migrations/20260828182252_init/migration.sql:361` (ON DELETE RESTRICT on AuditLog, Report, Assignment, ChangeRequest, Notification)
- **Details:** Direct `prisma.user.delete` with no soft-delete, no transaction, no catch. Most users have audit rows → unhandled Prisma P2003 → generic 500. Blocks GDPR/retention purges.

## B15. Frontend read/edit gating is client-side only; sign-off without flushing editor content
- **Location:** `apps/web/src/components/reading/SignOffControls.tsx:43-63, 144-149`; `apps/web/src/components/reading/ReportPanel.tsx:101-156`; `apps/web/src/app/(dashboard)/layout.tsx:10`; `SessionGuard.tsx:90-95`
- **Details:** (a) "Sign Report" POSTs `/sign` without flushing current editor content — if autosave (500 ms) hasn't fired or is in-flight/failed, a report is signed containing stale text; missing-fields warning reads the saved `report` prop, not live inputs. (b) Autosave has no request serialization and the 60 s poll + reload-after-save resets the editor to server state — typed content can be silently clobbered. (c) Route access (`permissions.ts:74-89`) is enforced only in a `"use client"` component; role checks in middleware.ts:17,22-26 are cookie-presence-only (any string passes).

---

# C. MEDIUM FINDINGS

## C1. Login brute-force limit is high and IP-only; no per-account throttle; no `trust proxy`
- **Location:** `apps/api/src/main.ts:58` (100 attempts/15 min/IP); `apps/api/src/common/security/rate-limit.middleware.ts:24`
- **Details:** No per-account lockout. Without `app.set('trust proxy')`, behind any reverse proxy every user resolves to the LB's IP — the bucket becomes a global shared DoS, or NAT/proxy rotation trivially bypasses it. Rate-limiter Map (`rate-limit.middleware.ts:17,27-31`) also never evicts entries and is per-process only.

## C2. Account enumeration + lifecycle/rejection info disclosure
- **Location:** `apps/api/src/auth/auth.service.ts:46-52, 99-116`
- **Details:** `register` tells anonymous callers whether an email is registered and whether the account is PENDING vs existing. `login` reveals PENDING/REJECTED/SUSPENDED and returns the admin-written `rejectionReason` verbatim (105-110) to anyone with email+password, leaking internal approval notes.

## C3. Pre-delivery report leak via list endpoints (inconsistent with detail gate)
- **Location:** `apps/api/src/reports/reports.service.ts:205-207, 231-236`
- **Details:** `list` and `hospitalReports` include `MANAGER_APPROVED` in the hospital-visible set, so a hospital can read full report rows once manager-approved but **before** `deliver` fires. Detail endpoints (252-284) and PDF (720) correctly exclude MANAGER_APPROVED. Verdict depends on which endpoint is called.

## C4. Correction/change-request state-machine gaps
- **Location:** `apps/api/src/reports/reports.service.ts:654-686` (`requestChange` no state check, non-transactional); `apps/api/src/corrections/corrections.service.ts:139-144, 165-213, 454-508, 554-591`
- **Details:** `requestChange` can rip a study out of IN_READING/RADIOLOGIST_SIGNED with no state validation and three non-atomic writes. Concurrent duplicate correction requests bypass the `findActiveCorrection` dup-guard (outside transaction). Concurrent `begin()` double-start creates duplicate same-version draft rows and moves the study twice.

## C5. Reassigning to the same radiologist creates duplicate active Assignment rows
- **Location:** `apps/api/src/worklist/worklist.service.ts:318-323, 335-343`

## C6. `PATCH /studies/:uid/status` read-then-write race; audit outside the update
- **Location:** `apps/api/src/studies/studies.service.ts:245-362` (read `:245`, write `:354`); audit `:364-372`
- **Details:** Concurrent status PATCHes both validate against the stale read and both apply (last-writer wins lost update → illegal double-transition). Status can change without an audit row if the audit insert fails. No transaction.

## C7. Hospital role can strand/steer delivered studies via generic status PATCH
- **Location:** `apps/api/src/studies/studies.service.ts:27, 51`; `studies.controller.ts:56` (no `@Roles`)
- **Details:** `HOSPITAL_REVIEW→HOSPITAL_CHANGE_REQUESTED` with actor HOSPITAL — reachable only via the generic PATCH, bypassing the audited correction workflow.

## C8. Missing pagination / unbounded list queries (backend)
- **Location:** `worklist.service.ts:83-94`; `reports.service.ts:213-222, 239-248`; `corrections.service.ts:241-262`; `analytics.service.ts:42-53, 96-99, 117-131`; `users.service.ts:17-35`; `ai/ai.controller.ts:13-18` (`pageSize` has `@Min(1)` only)
- **Details:** Several endpoints load the entire table in one response. Analytics does full-table scans including all studies ever with N+1 `thresholdForPriority` queries per study (sla.service.ts:171-194 similar N+1). AI `listJobs` `skip` can be astronomically large.

## C9. Audit scoping silently bypassed for MANAGERs without a `hospitalId`
- **Location:** `apps/api/src/audit/audit.service.ts:64`
- **Details:** Restriction is `if (user.role === 'MANAGER' && user.hospitalId)` — a MANAGER with `hospitalId = null` (schema allows: `User.hospitalId` optional) skips the entire scoping block and can read the **full audit log** (actors, actions, metadata, ipAddress, userAgent) across all hospitals.

## C10. Admin can silently self-demote / deactivate the only admin (lockout)
- **Location:** `apps/api/src/users/users.service.ts:118, 124-127`
- **Details:** No guard against an admin changing their own role or disabling the last active admin. Permanent lockout with no recovery path.

## C11. Rejected accounts can be silently re-activated out of band
- **Location:** `apps/api/src/users/users.service.ts:99-129`
- **Details:** Admin `update` can set `status: APPROVED`/`isActive: true` on a previously REJECTED user, bypassing the audited `registration-requests/:id/approve` flow.

## C12. User create: unvalidated `hospitalId` → 500; TOCTOU on email uniqueness
- **Location:** `apps/api/src/users/users.service.ts:54-63`
- **Details:** `hospitalId` never verified to exist → P2003 500. `findUnique`-then-`create` races on email → P2002 500 instead of 409.

## C13. Invalid enum filter values cause 500s in audit listing
- **Location:** `apps/api/src/audit/audit.service.ts:33-34`; `audit.controller.ts:31-35`
- **Details:** Arbitrary strings cast to Prisma enums with no `IsEnum` validation → raw Prisma error → 500.

## C14. Rate limiter memory leak / unshared
- **Location:** `apps/api/src/common/security/rate-limit.middleware.ts:17, 27-31`
- **Details:** `hits` Map never evicts one-shot IPs — unbounded growth under many distinct IPs; per-process only (limits don't aggregate across replicas).

## C15. No timeout on outbound Orthanc requests (ingest + DICOMweb proxy)
- **Location:** `apps/api/src/dicom/dicom.service.ts:81-94`; `apps/api/src/dicomweb/dicomweb.service.ts:158-163`
- **Details:** Hung Orthanc indefinitely holds HTTP workers → availability DoS for all DICOM traffic. (Health check does use `AbortSignal.timeout(3000)`.)

## C16. DICOM parser O(n²) string building on oversized VR values
- **Location:** `apps/api/src/dicom/dicom.parser.ts:114-117`
- **Details:** `readString` uses `s += String.fromCharCode(...)` in a loop with no VR length limit; a single large string tag in a 200 MB attacker-controlled file causes near-quadratic CPU/memory burn.

## C17. Correction reason free-text (possible PHI) broadcast to all active managers globally
- **Location:** `apps/api/src/corrections/corrections.service.ts:215-221`; `notifications.service.ts:53-71`
- **Details:** `notifyManagers` sends `A correction was requested (${reason})` to EVERY APPROVED active MANAGER system-wide, including managers of unrelated hospitals. Clinical details in the reason cross hospital lines.

## C18. Missing max-length validation on clinical free-text
- **Location:** `apps/api/src/reports/reports.controller.ts:26-54` (findings/impression/clinicalHistory), `:65-73` (ChangeRequest reason/resolution)
- **Details:** `@IsString` with no `@MaxLength` → unbounded strings stored and rendered into PDF/broadcast notifications (compounds C17 and DoS).

## C19. Frontend API/query/cache bugs
- **Location:** `apps/web/src/lib/api-client.ts:54-67, 70`; `apps/web/src/.../settings/users/page.tsx:97-106`; `apps/web/next.config.mjs:5-6`
- **Details:** (a) `ApiError` is not `instanceof Error`, so callers using `instanceof Error` never surface the server's real error text; `response.json()` on 204/empty throws. (b) Settings→Users fires 2 requests per keystroke (debounce defeated). (c) Missing `NEXT_PUBLIC_API_URL`/`OHIF_URL` silently targets localhost in deployed builds. TanStack Query is configured but unused, so mutations never invalidate cross-page data.

## C20. Settings→Audit page downloads the whole audit log unpaginated
- **Location:** `apps/web/src/app/(dashboard)/settings/audit/page.tsx:48-75`
- **Details:** Fetches `/audit` with no page/pageSize and filters client-side → unbounded full-table download.

## C21. Timezone bugs — all clinical timestamps rendered as UTC + mixed local/UTC across pages
- **Location:** `apps/web/src/lib/format.ts:4, 24` (`FORMAT_TIME_ZONE = "UTC"` hardcoded); `hospitals/page.tsx:195`; `audit/page.tsx:58-67`; `operations/page.tsx:272` use local `toLocaleString()` while everything else is UTC → disagreeing timestamps. `hospitals/page.tsx:43-46` "Studies Sent (Today)" compares browser-local `toDateString()` against server UTC dates.

## C22. Destructive operations with no confirmation
- **Location:** `apps/web/src/app/(dashboard)/operations/page.tsx:136-147, 317-324` (archive studies — one click, no confirm); `settings/users/page.tsx:311-324, 614-620` (role changes/suspend apply instantly, no confirm, can demote last admin)

## C23. Form validation gaps (frontend)
- **Location:** `apps/web/src/app/register/page.tsx:199-227, 48-60` (password/confirm never compared client-side); `hospitals/new/page.tsx:63-66, 82` (past `dueAt` accepted, birthDate unvalidated); `hospitals/submit/page.tsx:111, 234-241` (per-file 200 MB cap only, no aggregate limit, ZIP accepted with name check only)

## C24. Routing rules feature is entirely non-functional
- **Location:** `apps/web/src/app/(dashboard)/settings/routing/page.tsx:29` + `src/components/admin/RoutingRuleBuilder.tsx:196-198`
- **Details:** The rule builder's `onSave` calls `setShowBuilder(false)` — the rule payload is **discarded**, no API call exists. Rules can never be persisted; page permanently shows "No data available".

## C25. Worklist shows personal queue for all roles
- **Location:** `apps/web/src/app/(dashboard)/worklist/page.tsx:137`
- **Details:** Endpoint hardcoded to `/worklist/my` for all roles while the page title shows "Assignment Queue" for coordinators; the Assign action therefore rarely has assignable items. (`queue/page.tsx:35` correctly uses `/worklist` for non-radiologists.)

## C26. OHIF viewer misconfigurations
- **Location:** `apps/web/src/components/reading/OHIFViewer.tsx:10-13, 70-91`; `apps/web/src/middleware.ts:38` (matcher covers `/ohif/*`)
- **Details:** No auth-token/study-UID validation before handing off to embedded viewer (relies wholly on backend); `NEXT_PUBLIC_APP_URL ?? ""` baked at build time. `middleware.ts` grants access on cookie presence only and runs over `/ohif/*`.

## C27. Internal Orthanc endpoints/paths leaked to API clients in error messages
- **Location:** `apps/api/src/dicom/dicom.service.ts:91` (`Orthanc returned ${res.status} for ${path}`), `:148-150` (`Subscribed ... ${body?.Message}`)
- **Impact:** Infrastructure/architecture disclosure to authenticated clients (though HttpExceptionFilter itself is clean).

## C28. Worklist Enter-key handler hijacks modal assignment
- **Location:** `apps/web/src/app/(dashboard)/worklist/page.tsx:238-264, 483`
- **Details:** Global `keydown` Enter branch navigates to reading unless target is input/select; inside the Assign modal, pressing Enter to confirm navigates away mid-assignment.

## C29. Missing error boundaries / null-safety crashes
- **Location:** apps/web/src/app (no `error.tsx`/`global-error.tsx`/`loading.tsx` anywhere); `queue/page.tsx:143, 146` and `worklist/page.tsx:369-377, 455-459` access `item.study.patient.displayName`/`accessionNumber` without optional chaining while neighboring code uses `item.study?.hospital?.name`.

---

# D. LOW FINDINGS

## D1. No CSRF token; SameSite=Lax only; no CSP by default
- **Location:** `apps/api/src/auth/auth.service.ts:126` (sameSite lax); `security-headers.middleware.ts:31-33` (CSP only if env set; no frame-ancestors)
- **Impact:** Defense-in-depth gap for state-changing top-level navigations; no script/style restriction by default.

## D2. Session-cookie `secure` flag and HSTS depend on exact env strings
- **Location:** `apps/api/src/auth/auth.service.ts:127`; `security-headers.middleware.ts:37`
- **Details:** Both gate on `NODE_ENV === 'production'`; any mislabeling (see A2) means the session cookie travels over plaintext HTTP and HSTS is absent.

## D3. Weak password policy
- **Location:** `apps/api/src/auth/auth.dto.ts:31-34`; `users.controller.ts:24-26`
- **Details:** `MinLength(8)` only — no complexity or breached-password check. (bcrypt cost 12 is good.)

## D4. No stream limit or confirmation on health endpoint
- **Location:** `apps/api/src/health/health.controller.ts:16-24` (`@Public`)
- **Details:** `/api/health/ready` returns per-component DB/Orthanc up/down + `latencyMs` with no auth and no rate limit — reconnaissance aid.

## D5. JWT verify doesn't pin algorithms/issuer/audience; no jti
- **Location:** `apps/api/src/auth/auth.guard.ts:39`
- **Details:** Not currently exploitable (jsonwebtoken v9 defaults to HMAC family for string secrets), but `alg` is header-influenced and replay/revocation without `jti` is impossible.

## D6. DICOMweb proxy forwards arbitrary client headers and echoes upstream cookies
- **Location:** `apps/api/src/dicomweb/dicomweb.service.ts:141-151, 166-169`
- **Impact:** Header-poisoning surface; upstream Set-Cookie forwarded to browser.

## D7. TOCTOU in registration → unhandled P2002 → 500 instead of 409
- **Location:** `apps/api/src/auth/auth.service.ts:42-52, 56-69`

## D8. `CorrectionsService.request` fallback `assignedToId: ''`
- **Location:** `apps/api/src/corrections/corrections.service.ts:172`
- **Details:** Null assigned radiologist → correction assigned to empty string; `approve` then fails, orphaning the request.

## D9. PDF byte-length vs character-length mismatch for non-ASCII content
- **Location:** `apps/api/src/reports/reports.service.ts:815-841`
- **Details:** `/Length ${contentStream.length}` uses JS string length; xref offsets use `Buffer.byteLength` — non-Latin names produce corrupt/invalid PDF delivery artifacts.

## D10. Query-string params written verbatim to request logs (PHI in logs)
- **Location:** `apps/api/src/common/observability/correlation.middleware.ts:48` (`path: req.originalUrl`); no scrubbing in `structured-logger.ts`
- **Details:** `?search=<patient name>` PHI lands in observability logs.

## D11. Audit log leaks staff `ipAddress`/`userAgent` and full rows to MANAGERs
- **Location:** `apps/api/src/audit/audit.service.ts:84-91`
- **Details:** PII of co-workers (personal IPs/user agents) returned raw to managers within a hospital.

## D12. Analytics metrics default to 100% with no data — misleading
- **Location:** `apps/api/src/analytics/analytics.service.ts:38-39, 72-73, 162-163`
- **Details:** "100% SLA compliance / 100% delivery success" with zero data — false confidence for new hospitals.

## D13. Frontend metric/render bugs
- **Location:** `analytics/page.tsx:46` (0% rendered as a visible 1% sliver); `operations/page.tsx:276` (`NaN KB` for non-numeric sizeBytes); `queue/page.tsx:64-67` & `worklist/page.tsx:223` (missing priority → `NaN` sort)

## D14. Dead/no-op UI
- **Location:** `apps/web/src/components/reading/CriticalFindingBanner.tsx:35-48, 55-60` (Acknowledge only toggles local state, never POSTed, resets on reload; "Flag as Critical Finding" button has no onClick); `apps/web/src/components/report/ReportEditor.tsx:83-100` ("Submit for sign-off" only PATCHes a draft, never moves the study toward review)

## D15. Assignment check inconsistency (report.authorId vs study.assignedRadiologistId)
- **Location:** `apps/web/src/components/reading/ReportPanel.tsx:55-59` vs `reading/[studyUid]/page.tsx:42-43`
- **Details:** Assigned radiologist who is not the current report author (e.g. after correction) sees read-only panel with no way to edit.

## D16. `docker-compose.yml` static default credentials and host-bound ports
- **Location:** `docker-compose.yml:8` (postgres axis/axis_dev), `:23-24` (Redis 0.0.0.0:6379 no password), `:35-36` (RabbitMQ axis/axis_dev + mgmt UI), `:49-51` (Orthanc 8042+4242 directly host-bound — bypasses API auth if orthanc.json has no auth), `:65-66` (Keycloak admin/admin), `:75` (`minio/minio:latest` unpinned), `:79-80` (minioadmin/minioadmin)

## D17. Real `.env` files on disk contain live secrets (not committed, present in workspace)
- **Location:** `/home/sudha/Teleradiology_PACS/.env` and `apps/api/.env` — non-placeholder `AUTH_SECRET`, `DATABASE_URL` (axis:axis_dev), `ORTHANC_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `MINIO_SECRET_KEY`, `REDIS_URL`, `RABBITMQ_URL`. Both files are gitignored, so not a repo leak, but any workspace snapshot/backup ships a working JWT secret + DB creds.
- **Note:** `apps/api/.env` also contains a malformed key `NEXT_PUBLICORTHANC_URL` (missing underscore) — `NEXT_PUBLIC_ORTHANC_URL`? This key is likely never read as intended.

## D18. `.gitignore` hygiene / backup artifacts
- **Location:** `.gitignore:13` — `backups/` ignored, but `apps/api/backups/*.sql` files exist on disk (untracked). A fresh clone re-runs seed with known passwords (A4); ECG backups not rsynced anywhere.
- `docker-compose.yml:75` unpinned `minio/minio:latest` tag.

---

# E. Root-Cause Themes
1. **Two competing authorization stories** for hospital report visibility: `HOSPITAL_VISIBLE_STATES` is enforced at detail/PDF endpoints but omitted in `GET /studies/:uid` (B1), `GET /reports` lists (C3), and the AI module (A3). Verdict-by-endpoint.
2. **The generic `PATCH /studies/:uid/status`** (`studies.service.ts`) is the only signed-report prerequisite mid-chain; because `RADIOLOGIST_SIGNED` itself is excluded (B2), the "signed report" trust anchor can be faked, after which racy transitions (C6) move studies all the way to delivery.
3. **Corrections vs change-requests implemented twice** (`reports.requestChange/respondChangeRequest` vs `corrections.*`) enforce different state guards and transactionality — drift is the vulnerability (B3/B4/B5 vs C4).
4. **No transactions/row locks anywhere** — the entire workflow layer runs READ COMMITTED with read-then-write patterns (B6, B7, C4, C6, A5).
5. **Dead config and dead code**: `MAX_UPLOAD_BYTES` (A6), audit interceptor (B10), `maxBuffer:0` mismatch (A8) — all signal "written but never validated against the real environment".

---

# F. Priority Fix Order
1. Restrict DICOMweb proxy to an explicit allow-list of DICOMweb routes and normalize/reject traversal (A1).
2. Harden `AUTH_SECRET` handling — hard-fail on weak/missing secret independent of env name (A2); remove static seed passwords / add production guard (A4).
3. Add `@Roles` + hospital scoping to AI module (A3) and analytics (B8); fix audit scoping (C9).
4. Enforce report-visibility consistency across ALL report-bearing endpoints (B1, C3).
5. Add transactional locking and state-machine validation for all status/sign/assign/amend/validate/correction writes (B2-B7, C4-C6); add unique `(studyId, version)` constraint.
6. Fix backup pipeline: correct `maxBuffer`, unique artifact names, run-lock, verified-only retention gate (A8, B12, B13).
7. Replace in-memory uploads with streaming + aggregate byte limit; cap allowed decompressed sizes (A6, A7).
8. Add real audit coverage for admin user actions + failed logins; fail loudly instead of swallowing (B9, B10, C1, C2).
9. Add pagination caps everywhere; fix analytics/ai N+1 and unbounded scans (C8).
10. Frontend: serialize autosave, flush before sign, add confirmation dialogs, error boundaries, timezone consistency, and functional routing rules (B15, C19-C29, D13-D15).