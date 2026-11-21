# DICOM Compression POC

This isolated benchmark compares lossless DICOM compression with optional lossy experiments. It reads files from `samples/`, writes derived DICOM files and `report.csv` to `output/`, and never writes to or deletes source files. Keep only de-identified test data on disk.

## Windows setup and run

Use Python 3.12 (64-bit) for the broadest availability of codec wheels. From the repository root, run PowerShell:

```powershell
cd tools\dicom-compression-poc
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Place de-identified `.dcm` files in `samples\` (subfolders are searched too), then run:

```powershell
python .\benchmark.py
```

The default run produces JPEG 2000 Lossless (`1.2.840.10008.1.2.4.90`), JPEG-LS Lossless (`1.2.840.10008.1.2.4.80`), and RLE Lossless (`1.2.840.10008.1.2.5`) variants for every input.

Lossy tests are opt-in. Supply exactly two or three values for each experiment:

```powershell
python .\benchmark.py --jpeg2000-lossy-ratios 10,20,30 --jpeg-baseline-qualities 60,80,95
```

JPEG 2000 ratios are codec compression-ratio targets; JPEG Baseline quality values are 1-100. Lossy output is marked with Lossy Image Compression (`0028,2110`) = `01`, a measured pixel-data byte ratio (`0028,2112`), and the corresponding method (`0028,2114`). Existing lossy history is retained and the new operation is appended.

`output\report.csv` has one row per input/transfer-syntax variant, including original and compressed file sizes, percentage reduction, encode/decode timings, verification result, and lossy PSNR/max absolute error. Lossless verification requires a bit-identical decoded pixel array. Every original non-pixel metadata tag (including nested sequence metadata) must still be present and unchanged; transfer syntax, pixel-module tags and lossy-compression history are handled separately. A failed encode or verification is recorded as `verified=no` with an error; the process exits non-zero if any row fails.

The JPEG-LS encoder is supplied by `pyjpegls`; `pylibjpeg-openjpeg` encodes JPEG 2000, with Pillow used for images smaller than OpenJPEG's minimum resolution configuration. `pylibjpeg-libjpeg` decodes JPEG-family transfer syntaxes. Pillow supplies the JPEG Baseline encoder because `pylibjpeg-libjpeg` does not register a pydicom Baseline encoder. JPEG Baseline requires unsigned 8-bit pixels; the POC does not silently rescale higher bit-depth images. RLE encoding uses pydicom's built-in encoder. Codec support can depend on pixel format and platform; unsupported input/codec combinations are reported as failed rows rather than silently skipped.

The `samples\`, `output\`, and `orthanc-scratch\` folders ignore their contents in Git to avoid committing patient data, generated images, or copied configs/statistics. The POC also ignores its virtual environment and Python bytecode. Keep the `.gitignore` files.

## Orthanc scratch test: IngestTranscoding and StorageCompression

Do not edit `infra\orthanc\orthanc.json` or `orthanc.prod.json`. Create scratch copies and a compose overlay, so this test gets its own Orthanc instance and storage volume. Run these commands from the repository root:

```powershell
$Scratch = "tools\dicom-compression-poc\orthanc-scratch"
New-Item -ItemType Directory -Force "$Scratch\config" | Out-Null
Copy-Item "infra\orthanc\orthanc.json" "$Scratch\config\orthanc.json"
Copy-Item "infra\orthanc\orthanc.json" "$Scratch\config\orthanc-baseline.json"
```

Edit only `orthanc-scratch\config\orthanc.json` and add these top-level settings to the copied JSON:

```json
"IngestTranscoding": "1.2.840.10008.1.2.4.90",
"IngestTranscodingOfUncompressed": true,
"StorageCompression": true
```

`IngestTranscoding` requests JPEG 2000 Lossless storage transfer syntax. `IngestTranscodingOfUncompressed` also applies it to uncompressed inputs. `StorageCompression` enables Orthanc's storage-file compression; it is separate from DICOM transfer-syntax transcoding.

Create `orthanc-scratch\docker-compose.yml` with this overlay. The first service uses the unmodified scratch baseline; the second uses the settings above. Both use separate ports and data volumes:

```yaml
services:
  orthanc-poc-baseline:
    image: jodogne/orthanc-plugins:1.12.6
    ports:
      - "18042:8042"
      - "14242:4242"
    volumes:
      - ./tools/dicom-compression-poc/orthanc-scratch/config/orthanc-baseline.json:/etc/orthanc/orthanc.json:ro
      - orthanc-poc-baseline-data:/var/lib/orthanc/db
  orthanc-poc-compressed:
    image: jodogne/orthanc-plugins:1.12.6
    ports:
      - "18043:8042"
      - "14243:4242"
    volumes:
      - ./tools/dicom-compression-poc/orthanc-scratch/config/orthanc.json:/etc/orthanc/orthanc.json:ro
      - orthanc-poc-compressed-data:/var/lib/orthanc/db

volumes:
  orthanc-poc-baseline-data:
  orthanc-poc-compressed-data:
```

Start the two scratch services with the repository compose file and overlay:

```powershell
docker compose -f docker-compose.yml -f tools\dicom-compression-poc\orthanc-scratch\docker-compose.yml up -d orthanc-poc-baseline orthanc-poc-compressed
```

Upload the same DICOM file to each fresh instance (replace the example path):

```powershell
curl.exe -X POST "http://localhost:18042/instances" -H "Content-Type: application/dicom" --data-binary "@tools\dicom-compression-poc\samples\sample.dcm"
curl.exe -X POST "http://localhost:18043/instances" -H "Content-Type: application/dicom" --data-binary "@tools\dicom-compression-poc\samples\sample.dcm"
```

Capture each instance's `/statistics` response:

```powershell
curl.exe -s "http://localhost:18042/statistics" | Set-Content "tools\dicom-compression-poc\orthanc-scratch\baseline-statistics.json"
curl.exe -s "http://localhost:18043/statistics" | Set-Content "tools\dicom-compression-poc\orthanc-scratch\compressed-statistics.json"
```

Compare `TotalDiskSize`, `TotalDiskSizeMB`, and the instance/study counts. Use identical input studies and fresh, isolated volumes for a fair comparison; compare one study at a time or ensure both instances contain the same set. `/statistics` reports Orthanc-wide totals, not per-instance sizes. Check the Orthanc logs and `/plugins` endpoint for available codec plugins and successful transcoding. If the image lacks a JPEG 2000 encoder, use a separately tested Orthanc build with the required codec rather than interpreting a rejected ingest as a compression result.

Stop only the POC services when finished:

```powershell
docker compose -f docker-compose.yml -f tools\dicom-compression-poc\orthanc-scratch\docker-compose.yml stop orthanc-poc-baseline orthanc-poc-compressed
```

The real Orthanc configuration and normal Orthanc storage volume are not mounted by this overlay.
