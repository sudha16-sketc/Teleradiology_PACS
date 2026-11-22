# Backend Lossless DICOM Compression Design

## Status

Design rationale plus the implemented ingest policy. The original design proposed fail-open fallback; the current implementation is fail-closed and never posts an instance whose decode/re-encode/verification did not succeed.

Current supported source classes are uncompressed Explicit/Implicit VR Little Endian, already-lossless JPEG-LS/JPEG 2000 pass-through, and JPEG Baseline (`1.2.840.10008.1.2.4.50`) re-encoding. JPEG Baseline is accepted only with `LossyImageCompression=01`, a positive finite ratio, and `ISO_10918_1` method. It is decoded, wrapped in an Explicit VR Little Endian intermediate, encoded to JPEG 2000 Lossless (`1.2.840.10008.1.2.4.90`), and verified by exact decoded-pixel equality. The original lossy history is preserved; the stored file is lossless only relative to the decoded JPEG Baseline pixels and must not be described as recovering the original acquisition pixels. All other compressed/private syntaxes are rejected.

## Existing upload, storage, and viewing behavior

- [dicom.controller.ts](../../apps/api/src/dicom/dicom.controller.ts) accepts ZIP or raw DICOM uploads through multipart disk storage. It creates a per-request staging directory and removes it in `finally`.
- [dicom.service.ts](../../apps/api/src/dicom/dicom.service.ts) extracts a ZIP, parses and validates every instance, creates/updates the PostgreSQL hierarchy, and POSTs the original bytes to Orthanc at `POST /instances` with `Content-Type: application/dicom`.
- [dicom.parser.ts](../../apps/api/src/dicom/dicom.parser.ts) identifies transfer syntax, Study/Series/SOP UIDs, SOP class, and imaging metadata. Unknown valid transfer syntax UIDs are currently allowed for ingest.
- [dicom.module.ts](../../apps/api/src/dicom/dicom.module.ts) registers `DicomService` and the audit/DICOMweb dependencies.
- [dicom-backup.ts](../../apps/api/src/backup/dicom-backup.ts) downloads instances from Orthanc through DICOMweb WADO-RS, hashes the returned instance bytes, builds `dicom.tar.gz`, and validates restored bytes against the manifest.
- [retention-archive.service.ts](../../apps/api/src/retention/retention-archive.service.ts) creates and verifies the DICOM archive before permitted retention deletion. Deletion of the Orthanc study is a separate destructive step.
- Orthanc is at `jodogne/orthanc-plugins:1.12.6` for development and `jodogne/orthanc-plugins:1.13.1` for production. Both local JSON files enable DICOMweb but do not currently configure ingest transcoding or storage compression.
- OHIF requests WADO-RS/DICOMweb through the guarded Axis API proxy using `wadors` rendering.

## 1. Ingest step order

Compression belongs in `DicomService.ingestDicom()` and `DicomService.reingestDicom()`, immediately after parsing/identifier validation and before the loop calls `storeRawInstance()`. It must operate independently for each instance.

Required order:

1. **Parse and validate.** Preserve the existing ZIP extraction, transfer syntax parsing, UID validation, hierarchy consistency checks, and size limits.
2. **Capture the original.** Compute SHA-256 over the exact uploaded instance bytes and record original size. Keep the original buffer/file until the entire success or fallback decision completes.
3. **Determine transfer syntax.**
   - If the input transfer syntax is one of the lossless target syntaxes (`1.2.840.10008.1.2.4.90`, `1.2.840.10008.1.2.4.80`, or `1.2.840.10008.1.2.5`) and recompression is not expected to improve storage materially, skip recompression.
   - If the input transfer syntax is JPEG Baseline (`1.2.840.10008.1.2.4.50`), verify the mandatory lossy history and re-encode with JPEG 2000 Lossless (`1.2.840.10008.1.2.4.90`); reject any other configured target.
   - Otherwise, select the target using a preconfigured policy. Recommended policy: JPEG 2000 Lossless for CT/MR-style multi-frame or 8/16-bit data only after real codec testing; JPEG-LS Lossless where supported and benchmarked; never RLE as the target except for explicit compatibility needs. The final target must be a lossless UID, not a lossy UID.
   - Already-compressed J2K/JPEG-LS/RLE inputs must be decoded before recompression only as a POC process. Production can skip if already under policy or first validate/reencode.
4. **Write to a temporary file.** The compressor receives the original instance and writes exactly one candidate DICOM file to a temporary directory. No in-place replacement and no overwrite of upload or staging files.
5. **Decompress and verify the candidate.**
   - Decode the original and candidate pixel arrays in memory.
   - Require equal array shapes and types and exact byte equality for every decoded pixel sample.
   - Compare metadata tags. Preserve every Study/Series/SOP and non-pixel tag except the transfer syntax and explicitly expected pixel-related fields.
   - Reject changes to SOP Instance UID, Study Instance UID, Series Instance UID, Pixel Spacing, rescale tags, photometric interpretation, rows/columns, bits allocated/stored/high bit, samples per pixel, planar configuration, or any DICOM tag outside the documented transcoding allowance.
   - Verify the candidate file's Part 10 transfer syntax is the selected lossless target.
6. **Audit the result.** Write the audit record described below before Orthanc receives the candidate. Audit failure must not discard a successfully verified candidate, but it must trigger an observable warning and not silently report success.
7. **POST the candidate to Orthanc.** Use the existing `POST /instances` endpoint and hierarchy assertion. Orthanc must return `Status=Success|AlreadyStored`, instance ID, and all parent IDs.
8. **Confirm storage, then discard.** Only after Orthanc returns success and hierarchy verification succeeds may the request consider the original discarded. Delete temporary candidate and original staging/temp files through the existing cleanup path. The upload staging directory remains the lifecycle boundary.

For reingest, repeat the same sequence before `storeRawInstance()`. It must never replace a previously stored instance's original bytes unless the candidate is independently verified and Orthanc confirms the replacement resource.

### Failure fallback

The implemented compressor is fail-closed:

- If parsing, lossy-history validation, decode, metadata verification, pixel verification, temp-file write, or candidate verification fails, no candidate is posted to Orthanc and no output file remains.
- Do not add lossy tags, reset lossy history, or convert a file outside the configured lossless targets.
- Log a bounded diagnostic with the failure stage, error type, and allowlisted metadata only.
- Audit `DICOM_IMPORT_FAILED` or `DICOM_REINGEST` failure metadata with the diagnostic and failure stage.
- Existing staging cleanup still removes the source temp files after each request.

## 2. Implementation options

### A. Orthanc native ingest transcoding

The Orthanc 1.12.6 and 1.13.1 configuration versions in this repository support documented ingest settings:

- `IngestTranscoding`: target transfer syntax UID.
- `IngestTranscodingOfUncompressed`: controls transcoding of Implicit/Explicit Little Endian and Big Endian Explicit.
- `IngestTranscodingOfCompressed`: controls transcoding of already-compressed inputs. It is available starting with Orthanc 1.8.2.
- `StorageCompression`: transparent compression of Orthanc's heavyweight storage files. This is storage-container compression, not a change to the DICOM transfer syntax.
- `AcceptedTransferSyntaxes` and the grouped JPEG/JPEG 2000/JPEG-LS/RLE flags control which DICOM syntaxes Orthanc accepts.

Orthanc documentation confirms that `IngestTranscoding` changes the transfer syntax for instances received through REST or DICOM; failed ingest transcoding leaves the original transfer syntax stored. Orthanc 1.7.0 introduced transcoding. Orthanc 1.12.6's checked-in default configuration also confirms `StorageCompression` is a top-level boolean defaulting to `false`. Orthanc 1.12.6 and 1.13.1 both expose `IngestTranscodingOfCompressed/Uncompressed` in the documented transcoding behavior.

Pros:

- No external process or network dependency.
- Applies consistently to REST and DICOM ingest.
- Automatic decompression for incompatible DICOM protocol outputs is separately documented.
- Smallest operational surface for storage file compression.

Cons:

- The backend cannot verify the candidate before Orthanc stores it because transcoding occurs while/inside ingest.
- No clear pre-POST original SHA-256-to-candidate verification result or candidate temp file in Nest.
- Transcoding behavior and plugin availability differ by codec/build.
- Already-compressed inputs must be explicitly controlled with `IngestTranscodingOfCompressed`; otherwise an existing compressed JPEG-LS file could be reprocessed.
- Orthanc transcoding can be fail-open silently, conflicting with the exact audit and fallback semantics requested unless additional post-store verification is added.
- Native transcoding plus `StorageCompression` are orthogonal: one changes DICOM transfer syntax, while one is a transparent storage file layer.

Effort: low configuration effort; medium verification integration effort.

Risks: no pre-storage verification; hidden plugin/transcoder failures; risk of replacing a verified fallback policy with Orthanc's built-in behavior; unclear exact JPEG-LS and JPEG 2000 plugin support in the deployed 1.12.6/1.13.1 images.

**What could not be verified:** the exact codec/plugin matrix of the repository's deployed Docker images (`jodogne/orthanc-plugins:1.12.6` and `jodogne/orthanc-plugins:1.13.1`) was not executable in this design pass. I could not confirm that a specific image supports lossless JPEG 2000 encoding, JPEG-LS encoding, or both as production-ready encoders. Orthanc documentation also states that JPEG 2000 transcoding may require GDCM; no GDCM plugin is currently shown in either repo JSON. A scratch Docker test and `GET /plugins` plus a real CT/MR round trip are required before relying on this option.

### B. DCMTK or GDCM command-line tools from NestJS

NestJS would spawn a bounded, non-shell process such as `dcmconv`, `gdcmconv`, or equivalent, pass a temp input/output path, and parse/verify the result.

Pros:

- Mature DICOM libraries and efficient native codecs.
- Single orchestration boundary remains in NestJS.
- Separates candidate creation from Orthanc storage.
- Process isolation limits crashes in the API process.

Cons:

- Requires OS packages and architecture-specific Docker image changes.
- Command-line option compatibility differs across DCMTK/GDCM versions.
- Process spawning, timeout, concurrency, disk quotas, and signal handling add implementation complexity.
- Verification still requires a separate pydicom/DCMTK/GDCM decode step or integration library.
- Shell injection is not safe unless arguments are passed as a strict argv array.

Effort: medium; higher in Docker, deployment, and codecs.

Risks: no root cause of encoder failure should be hidden; lossy default flags must be prohibited by configuration/code; image format edge cases (1-bit, RGB/YBR, signed 16-bit, multi-frame) need explicit testing.

### C. Small Python service reusing the POC

The Nest ingest service calls an internal, network/IPC-isolated Python worker for:

1. decode/validate,
2. lossless encode,
3. metadata/pixel verification,
4. temp-file return.

Pros:

- Directly reuses the benchmarked codec stack and already-tested POC verification logic.
- Best control over JPEG 2000 Lossless/JPEG-LS Lossless/RLE selection and explicit rejection of lossy flags.
- Candidate is available to Nest for SHA-256 and Orthanc confirmation.
- Independent resource limits and failure fallback can be implemented around the worker.

Cons:

- Adds deployment, health checking, retries, authentication, and operational monitoring.
- pydicom/pylibjpeg dependencies and native codec wheels must be packaged for the host architecture.
- A 1-GiB instance can exceed ordinary HTTP worker and container memory limits.
- Pydicom verification is currently array-oriented and may be less efficient than native streaming for every frame.
- Cross-service transfer must use temp files or a bounded IPC protocol, not large JSON payloads.

Effort: medium to high initially; low to medium ongoing.

Risks: worker availability; memory pressure; codec package drift; cold start; unbounded decode memory. It requires the strongest resource and cleanup controls.

### Recommendation

Recommend **Option C, a small internal Python compression service**, for implementation after POC sign-off.

Reason: it provides the exact pre-storage verification and audit information requested by the client, while reusing the benchmark's lossless verification methodology. It can be fail-open and can preserve the original until Orthanc confirms the candidate. It is more controllable than Orthanc native ingest for this requirement because native transcoding would store inside Orthanc before the Nest audit/verification boundary.

Choose Option B instead only if team operations prohibit a Python runtime or if a DCMTK/GDCM build passes the full 8/16-bit, RGB/YBR, signed-pixel, and multi-frame test matrix. Option A remains a suitable second layer for DICOM-protocol viewing/decompression or as a separate POC, but it is not enough by itself for the specified verify-before-storage workflow.

## 3. Audit record

Write one structured audit event per instance. Suggested action names:

- `DICOM_COMPRESSION_VERIFIED`
- `DICOM_COMPRESSION_FALLBACK_ORIGINAL`
- `DICOM_COMPRESSION_FAILED`

Minimum fields:

| Field | Requirement |
|---|---|
| `studyInstanceUid` | Actual DICOM Study Instance UID |
| `seriesInstanceUid` | Actual DICOM Series Instance UID |
| `sopInstanceUid` | Actual DICOM SOP Instance UID |
| `orthancInstanceId` | Orthanc returned ID after successful storage |
| `orthancSeriesId` | Orthanc returned series ID after successful storage |
| `orthancStudyId` | Orthanc returned study ID after successful storage |
| `originalSha256` | SHA-256 of exact uploaded instance bytes |
| `compressedSha256` | SHA-256 of exact candidate bytes |
| `originalSizeBytes` | Exact uploaded file size |
| `compressedSizeBytes` | Exact candidate file size |
| `uncompressedSizeBytes` | Optional: byte size of the pre-compression Pixel Data or EVR-Little-Endian temp representation |
| `originalTransferSyntaxUid` | Input meta-header UID |
| `originalTransferSyntaxName` | Human-readable name |
| `targetTransferSyntaxUid` | Lossless target UID |
| `storedTransferSyntaxUid` | UID confirmed from the candidate or Orthanc resource |
| `verificationResult` | `VERIFIED`, `NOT_VERIFIED`, or `SKIPPED_ALREADY_COMPRESSED` |
| `pixelBitIdentical` | Boolean |
| `metadataPreserved` | Boolean |
| `outcome` | `STORED_COMPRESSED`, `STORED_ORIGINAL`, `SKIPPED_ALREADY_COMPRESSED`, or `FAILED` |
| `failureStage` | `ENCODE`, `DECODE`, `PIXEL_VERIFY`, `METADATA_VERIFY`, `ORTHANC_POST`, `HIERARCHY_VERIFY`, or null |
| `fallbackReason` | Bounded normalized reason; no raw pixel or patient data |
| `timestamp` | UTC ISO-8601 event time |
| `correlationId` | Existing request/correlation ID when available |

The metadata snapshot and pixel verification result must be included as booleans, counts, and a bounded mismatch summary. Do not place patient name or full tag values into audit metadata.

The current implementation writes these fields into the existing `AuditLog.metadata` JSON on `DICOM_IMPORTED`, `DICOM_IMPORT_FAILED`, and `DICOM_REINGEST` events; no Prisma schema change or migration is required. `compressionProvenance` contains per-instance source/target syntax, source compression class, prior-lossy flag, preserved lossy method/ratio, policy version, source/output canonical pixel SHA-256, and exact-verification result. The API also writes a correlated structured log on every worker failure.

## 4. Backup and retention impact

The current backup implementation hashes the WADO-RS-returned instance bytes. It does not hash the pre-compression upload in a manifest. Therefore:

- After compression, the backup will naturally contain the Orthanc-stored instance, whether compressed or original fallback.
- Backup per-instance SHA-256 values become hashes of the stored bytes, not of the source facility's original.
- This is not currently an original-to-stored hash comparison. The backup manifest and its archive-level checksum prove the backup's internal integrity, and restore verifies the manifest; they do not prove that the uploaded original and restored instance were byte-for-byte identical.
- Retention only requires an existing verified archive and a verified-archive status before deleting the Orthanc original. It does not compare the Orthanc instance with a prior original SHA-256.
- Backup restore sends every manifest instance back to Orthanc and verifies it against the manifest UIDs and per-instance SHA-256. Compressed bytes remain valid if the archive stores the actual compressed instance.

Required design changes:

- Add `originalSha256` and `storedSha256` to ingest/instance audit metadata or a dedicated instance integrity table. A backup manifest should add both when available.
- Decide whether the backup should store:
  - the lossless compressed instance as the retention archive, or
  - both original and compressed forms.
- The client requirement says the uncompressed original is discarded, so retention's normal archive should store the lossless instance currently in Orthanc. Restoring an uncompressed original would violate the current requirement unless separately retained by policy, so that is not the default.
- Backup restore must continue verifying per-instance and archive checksums. If an audit hash field is added, restore should verify against `storedSha256`, not `originalSha256`.
- Retention archive verification must remain lossless and must not upgrade an archive to a lossy transform.
- If a fallback original remains in Orthanc, the backup must mark the instance as original/fallback and preserve that transfer syntax in the manifest.
- `dicomBackupRetentionDays`, legal holds, and deletion guards remain unchanged unless the policy defines a minimum original-retention period, which conflicts with the requirement to discard the original only after storage confirmation.

## 5. OHIF and DICOMweb viewing

The web stack uses OHIF configured for WADO-RS (`wadors`) and routes it through `/api/dicom-web`. The API proxy forwards an allow-listed set of request headers and copies response `Content-Type` and `transfer-syntax` headers.

The radiologist-facing implementation should treat DICOM transfer syntax as an Orthanc viewer concern:

- Keep lossless-only target transfer syntaxes:
  - JPEG 2000 Lossless: `1.2.840.10008.1.2.4.90`
  - JPEG-LS Lossless: `1.2.840.10008.1.2.4.80`
- Orthanc can expose the stored compressed syntax over WADO-RS.
- OHIF/Cornerstone must have a matching decoder for the selected syntax. If OHIF is not capable of decoding JPEG-LS or JPEG 2000, Orthanc should be configured for transparent decompression on WADO-RS or the API/DICOMweb proxy should negotiate an accepted uncompressed syntax.
- DICOMweb request negotiation remains on demand: the viewer requests frames, Orthanc either returns the stored syntax or transcodes to an offered syntax, and the browser decoder decompresses for display.
- DICOMweb should never be allowed to substitute lossy output. The DICOM API should reject lossy transfer syntax targets and lossy response settings.
- The existing availability check remains a study/series/instance identity check, not a pixel or codec compatibility check. Add a codec compatibility check to deployment verification.

Orthanc options relevant to output:

- `IngestTranscoding` controls storage syntax only for received instances.
- `StorageCompression` transparently compresses heavyweight storage bytes but does not change DICOM pixel transfer syntax.
- `TranscodeDicomProtocol` and `AllowTranscoding` control DICOM protocol output, not DICOMweb necessarily. They must not be assumed to solve WADO-RS/JPEG-LS/2K browser compatibility.

## 6. Proposed file changes

Implementation would require:

- `apps/api/src/dicom/dicom-compression.service.ts`: new Nest service with timeout, temp-file lifecycle, worker invocation, and fallback.
- `apps/api/src/dicom/dicom-compression.types.ts`: compression request/result/audit types.
- `apps/api/src/dicom/dicom.service.ts`: insert compression/verification before `storeRawInstance()` for ingest and reingest.
- `apps/api/src/dicom/dicom.module.ts`: register/export the compression provider.
- `apps/api/src/dicom/dicom.constants.ts`: lossless target UIDs and limits/policy environment variables.
- `apps/api/src/dicom/dicom.controller.ts`: optionally expose no public compression controls and keep compression internal.
- `apps/api/src/backup/dicom-backup.ts`: add/or verify stored/original hashes in the backup manifest and restore validation.
- `apps/api/src/retention/retention-archive.service.ts`: ensure retention stores and verifies the same lossless/stored instance semantics.
- `apps/api/src/retention/retention-audit.service.ts`: accept or add compression/verification audit actions if an instance audit is exposed there.
- `apps/api/src/audit/*`: add the new compression action metadata shape if no generic audit shape already permits it.
- `tools/dicom-compression-poc/benchmark.py`: production adaptation or a service wrapper only after POC behavior is finalized.
- `tools/dicom-compression-poc/requirements.txt`: freeze and mirror POC production codec dependencies if Option C is selected.
- `apps/api/package.json` / lockfile: add no codec package if Option C is an external service; add a Node HTTP/client dependency only if it is not already available.
- `docker-compose.yml`, API Dockerfile/deployment manifests, and Orthanc deployment image/manifests: add worker service, worker resource limits, and/or codec validation. No file should be edited until implementation confirmation.
- `infra/orthanc/*.json`: only if native transcoding or explicit viewing/transcoding compatibility is selected. Leave unchanged for the initial Nest/Python design.

Option C may add a dedicated implementation folder under `tools/` or `apps/compression/`, subject to team lead decision. That is not implementation; it is a proposed future location.

## Test plan

### Unit tests

- Lossless target selection for CT, MR, X-ray, and unknown modality.
- Already-compressed JPEG-LS input is skipped or recomputed according to policy, never lossy.
- SHA-256 calculation for original and candidate.
- Pixel array bit equality for 8-bit, signed/unsigned 16-bit, RGB/YBR, and multi-frame data.
- Metadata preservation:
  - UIDs and all non-pixel tags,
  - Pixel Spacing/Rescale fields,
  - Rows/Columns, Bits Allocated/Stored/High Bit,
  - Samples per Pixel/Photometric Interpretation/Planar Configuration.
- Candidate transfer syntax UID is exactly `.90`, `.80`, or `.5`.
- Temp file cleanup after success and failure.
- Orthanc response success and hierarchy ID validation.
- Audit fallback and success fields.

### Failure test: verification fails, original kept

1. Compress a synthetic instance.
2. Force the verifier to alter one pixel or mismatch one metadata tag.
3. Assert no lossy candidate is posted.
4. Assert the original exact bytes are posted to Orthanc.
5. Assert Orthanc is confirmed before the original temp/staging file is removed.
6. Assert audit is `outcome=STORED_ORIGINAL`, `pixelBitIdentical=false` or `metadataPreserved=false`, and `failureStage=PIXEL_VERIFY|METADATA_VERIFY`.

### Already-compressed test

1. Submit a JPEG-LS Lossless X-ray.
2. Assert recompression is skipped when policy says skip.
3. Assert original SHA-256 and stored SHA-256 are equal.
4. Assert no lossy audit or transfer syntax.
5. If policy says reprocess JLS-to-J2K, run the full candidate verification and assert the original bytes are retained until Orthanc confirms storage.

### Integration tests

- ZIP and multi-file ingest through `ingestDicom()`.
- Reingest on an existing study.
- Orthanc rejects candidate; fallback posts original unchanged.
- Worker unavailable; original fallback works.
- Worker times out; original fallback works and is audited.
- Orthanc already stores the same SOP UID; `AlreadyStored` is handled as success.
- Backup archive hashes match the exact WADO-RS-returned stored instance.
- Restore is successful for compressed and fallback-original instances.
- OHIF can decode at least JPEG 2000 Lossless and JPEG-LS Lossless samples, or the deployment proves a working Orthanc/DICOMweb on-demand fallback.
- Verify `StorageCompression=true` with DICOM lossless transfer syntax and `/statistics` in scratch storage. `StorageCompression=true` is not evidence of DICOM pixel compression.

## 7. Open questions for the team lead

1. Which target syntax is preferred for production: JPEG 2000 Lossless or JPEG-LS Lossless? Is modality-specific policy allowed?
2. What is the minimum expected storage reduction before recompression should be attempted or retained?
3. Should already-lossless X-rays with under 1% expected gain be skipped unconditionally, or should JPEG-LS/JPEG 2000 be normalized?
4. Is the uncompressed original allowed to exist in staging only until Orthanc confirmation, or can a separate verified original archive exist temporarily for recovery?
5. Should the backup store only compressed instances, or should it retain both stored and original hashes/bytes in an explicit recovery format?
6. Which audit storage/table is authoritative for instance-level compression results, and what retention period applies to those audit records?
7. What maximum memory and per-instance concurrency limits apply to the compression worker and Nest ingest request?
8. Which JPEG 2000 and JPEG-LS codecs are guaranteed by the deployed Orthanc images and GPU/CPU runtime?
9. Does OHIF ship working JPEG 2000 and JPEG-LS decode plugins, and if not, which on-demand uncompressed DICOMweb syntax must Orthanc serve?
10. Must DICOM C-MOVE/C-STORE and peer routing also receive the lossless stored syntax, or should outgoing protocol connections auto-transcode to compatible lossless/uncompressed syntaxes?
11. Is the requirement to discard originals only for new uploads, or should a background migration recompress existing Orthanc studies?
12. What is the production RTO/RPO, and should fallback-original storage be included in backup immediately after upload?

## Orthanc documentation references

- [Orthanc transcoding FAQ](https://orthanc.uclouvain.be/book/faq/transcoding.html): ingest transcoding, compressed/uncompressed controls, GDCM/DCMTK behavior, and outgoing transcoding.
- [Orthanc 1.12.6 default configuration](https://orthanc.uclouvain.be/hg/orthanc/file/Orthanc-1.12.6/OrthancServer/Resources/Configuration.json): `StorageCompression`, `AcceptedTransferSyntaxes`, and the repository deployment baseline.
- [Orthanc 1.13.1 default configuration](https://orthanc.uclouvain.be/hg/orthanc/file/Orthanc-1.13.1/OrthancServer/Resources/Configuration.json): production configuration baseline.
- [Orthanc configuration guide](https://orthanc.uclouvain.be/book/users/configuration.html): configuration loading and environment-variable behavior.
