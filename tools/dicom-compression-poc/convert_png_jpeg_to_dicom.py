#!/usr/bin/env python3
"""Convert PNG/JPEG files into validated DICOM Secondary Capture instances."""

from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

import numpy as np
from PIL import Image, ImageOps
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage, generate_uid
from pydicom import dcmread


def fail(message: str, stage: str = "conversion") -> int:
    print(
        "AXIS_IMAGE_CONVERSION_ERROR="
        + json.dumps(
            {"stage": stage, "message": message[:500]},
            sort_keys=True,
            separators=(",", ":"),
        ),
        file=sys.stderr,
    )
    return 1


def valid_signature(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    return None


def dcm_person_name(value: str) -> str:
    cleaned = " ".join(value.strip().split())
    return cleaned[:64] if cleaned else "Unknown Patient"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    args = parser.parse_args()

    try:
        manifest = json.loads(args.manifest.read_text("utf-8"))
        metadata = json.loads(args.metadata.read_text("utf-8"))
        if not isinstance(manifest, list) or not manifest:
            return fail("No image files supplied", "manifest")

        max_file = int(metadata.get("maxFileBytes", 25 * 1024 * 1024))
        max_dim = int(metadata.get("maxDimension", 20000))
        max_images = int(metadata.get("maxImages", 100))
        max_total = int(metadata.get("maxTotalBytes", 100 * 1024 * 1024))
        if len(manifest) > max_images:
            return fail("Too many images in the upload", "limits")

        total = 0
        normalized: list[tuple[str, Path]] = []
        for entry in manifest:
            if not isinstance(entry, dict):
                return fail("Malformed image manifest", "manifest")
            name = str(entry.get("name", ""))
            path = Path(str(entry.get("path", "")))
            if not path.is_file():
                return fail("Image file could not be opened", "source")
            size = path.stat().st_size
            total += size
            if size <= 0:
                return fail(f"Empty image: {name}", "validation")
            if size > max_file:
                return fail(f"Image exceeds the file size limit: {name}", "limits")
            normalized.append((name, path))
        if total > max_total:
            return fail("Combined image upload size exceeds the limit", "limits")

        args.output_dir.mkdir(parents=True, exist_ok=True)
        study_uid = str(metadata.get("studyUid") or generate_uid())
        series_uid = str(metadata.get("seriesUid") or generate_uid())
        patient_id = str(metadata.get("patientId") or "AXS-IMAGE")
        patient_name = dcm_person_name(str(metadata.get("patientName") or "Unknown Patient"))
        patient_age = metadata.get("patientAge")
        patient_sex = str(metadata.get("gender") or "U")
        study_description = str(metadata.get("studyDescription") or "Secondary Capture")
        referring_physician = str(metadata.get("referringPhysician") or "")
        now = datetime.now()

        output_files: list[str] = []
        pixel_hashes: list[str] = []

        for index, (name, path) in enumerate(normalized, start=1):
            data = path.read_bytes()
            signature = valid_signature(data)
            if signature is None:
                return fail(f"Unsupported or malformed image: {name}", "validation")

            try:
                with Image.open(path) as probe:
                    probe.verify()
                with Image.open(path) as image:
                    image.load()
                    if getattr(image, "n_frames", 1) != 1:
                        return fail(
                            f"Animated or multipage images are unsupported: {name}",
                            "validation",
                        )
                    width, height = image.size
                    if width < 1 or height < 1:
                        return fail(f"Invalid image dimensions: {name}", "validation")
                    if width > max_dim or height > max_dim:
                        return fail(
                            f"Image dimensions exceed the limit: {name}",
                            "limits",
                        )
                    if width * height > 160_000_000:
                        return fail(
                            f"Image pixel count exceeds the limit: {name}",
                            "limits",
                        )

                    image = ImageOps.exif_transpose(image)
                    mode = image.mode
                    if signature == "PNG" and mode not in ("L", "RGB"):
                        if mode == "RGBA":
                            return fail(
                                f"PNG alpha/transparency is unsupported: {name}",
                                "validation",
                            )
                        if mode == "P":
                            return fail(
                                f"Palette PNG is unsupported; convert to RGB or grayscale: {name}",
                                "validation",
                            )
                        return fail(
                            f"Unsupported PNG pixel mode {mode}: {name}",
                            "validation",
                        )
                    if signature == "JPEG" and mode not in ("L", "RGB", "CMYK"):
                        return fail(
                            f"Unsupported JPEG pixel mode {mode}: {name}",
                            "validation",
                        )

                    if mode == "CMYK":
                        image = image.convert("RGB")
                    elif mode == "L":
                        pass
                    elif mode == "RGB":
                        pass
                    else:
                        return fail(
                            f"Unsupported decoded pixel mode {mode}: {name}",
                            "validation",
                        )

                    arr = np.asarray(image)
                    if mode == "L" or arr.ndim == 2:
                        if arr.dtype != np.uint8:
                            arr = arr.astype(np.uint8)
                        rows, columns = arr.shape
                        samples = 1
                        photometric = "MONOCHROME2"
                        pixel_bytes = arr.tobytes(order="C")
                    else:
                        if arr.ndim != 3 or arr.shape[2] != 3:
                            return fail(f"Invalid decoded RGB pixels: {name}", "validation")
                        if arr.dtype != np.uint8:
                            arr = arr.astype(np.uint8)
                        rows, columns, _ = arr.shape
                        samples = 3
                        photometric = "RGB"
                        pixel_bytes = arr.tobytes(order="C")
            except Exception as exc:
                return fail(f"Could not decode image {name}: {type(exc).__name__}", "decode")

            sop_uid = generate_uid()
            file_meta = Dataset()
            file_meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
            file_meta.MediaStorageSOPInstanceUID = sop_uid
            file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
            file_meta.ImplementationClassUID = generate_uid(prefix="1.2.826.0.1.3680043.10.543.")

            ds = FileDataset(
                str(args.output_dir / f"{index:06d}.dcm"),
                {},
                file_meta=file_meta,
                preamble=b"\0" * 128,
            )
            ds.SOPClassUID = SecondaryCaptureImageStorage
            ds.SOPInstanceUID = sop_uid
            ds.StudyInstanceUID = study_uid
            ds.SeriesInstanceUID = series_uid
            ds.Modality = "OT"
            ds.ConversionType = "SI"
            ds.SeriesDescription = "Secondary Capture - PNG/JPEG"
            ds.StudyDescription = study_description[:64]
            ds.InstanceNumber = index
            ds.PatientName = patient_name
            ds.PatientID = patient_id[:64]
            ds.PatientSex = patient_sex if patient_sex in ("M", "F", "O", "U") else "U"
            ds.StudyDate = now.strftime("%Y%m%d")
            ds.StudyTime = now.strftime("%H%M%S")
            ds.SeriesNumber = 1
            ds.ReferringPhysicianName = referring_physician[:64] if referring_physician else ""
            ds.Rows = rows
            ds.Columns = columns
            ds.SamplesPerPixel = samples
            ds.PhotometricInterpretation = photometric
            ds.PlanarConfiguration = 0 if samples == 3 else None
            ds.BitsAllocated = 8
            ds.BitsStored = 8
            ds.HighBit = 7
            ds.PixelRepresentation = 0
            ds.PixelData = pixel_bytes

            if ds.PlanarConfiguration is None:
                del ds.PlanarConfiguration

            output_path = args.output_dir / f"{index:06d}.dcm"
            ds.save_as(output_path, enforce_file_format=True)

            reopened = dcmread(output_path, force=False)
            if reopened.SOPClassUID != SecondaryCaptureImageStorage:
                return fail("Generated SOP Class UID validation failed", "validate")
            if reopened.StudyInstanceUID != study_uid or reopened.SeriesInstanceUID != series_uid:
                return fail("Generated study or series UID validation failed", "validate")
            if reopened.SOPInstanceUID != sop_uid:
                return fail("Generated SOP Instance UID validation failed", "validate")
            if int(reopened.Rows) != rows or int(reopened.Columns) != columns:
                return fail("Generated pixel dimensions validation failed", "validate")
            reopened_pixels = reopened.PixelData
            if isinstance(reopened_pixels, np.ndarray):
                reopened_pixels = reopened_pixels.tobytes(order="C")
            if reopened_pixels != pixel_bytes:
                return fail("Generated pixel data validation failed", "validate")

            output_files.append(str(output_path))
            pixel_hashes.append(hashlib.sha256(pixel_bytes).hexdigest())

        print(
            "AXIS_IMAGE_CONVERSION_RESULT="
            + json.dumps(
                {
                    "studyUid": study_uid,
                    "seriesUid": series_uid,
                    "instanceCount": len(output_files),
                    "pixelHashes": pixel_hashes,
                },
                sort_keys=True,
                separators=(",", ":"),
            )
        )
        return 0
    except Exception as exc:
        return fail(
            f"Unexpected conversion failure: {type(exc).__name__}: {exc}",
            "internal",
        )


if __name__ == "__main__":
    raise SystemExit(main())
