#!/usr/bin/env python3
"""Compress and verify one DICOM instance for the production ingest path."""

from __future__ import annotations

import argparse
from pathlib import Path
import json
import re
import sys

DIAGNOSTIC_PREFIX = "AXIS_DICOM_DIAGNOSTIC="
RESULT_PREFIX = "AXIS_DICOM_RESULT="
SAFE_METADATA_KEYS = frozenset(
    {
        "source_transfer_syntax",
        "target_transfer_syntax",
        "rows",
        "columns",
        "samples_per_pixel",
        "bits_allocated",
        "bits_stored",
        "high_bit",
        "pixel_representation",
        "photometric_interpretation",
        "number_of_frames",
        "source_compression_type",
        "prior_lossy_compression",
        "lossy_image_compression",
        "lossy_method",
        "lossy_ratio",
        "lossy_history_normalized",
        "lossy_history_normalization_reason",
        "reencode_policy_version",
        "source_pixel_sha256",
        "output_pixel_sha256",
        "pixel_verified",
    }
)


def safe_message(message: str) -> str:
    redacted = re.sub(r"(?:/[^\s:]+|[A-Za-z]:\\[^\s:]+)", "<path>", message)
    return redacted[:500]


def emit_diagnostic(
    stage: str,
    exc: BaseException | None = None,
    metadata: dict[str, object] | None = None,
    message: str | None = None,
    error_type: str | None = None,
) -> None:
    safe_metadata: dict[str, object] = {}
    for key, value in (metadata or {}).items():
        if key not in SAFE_METADATA_KEYS:
            continue
        if value is None or isinstance(value, (int, float, bool)):
            safe_metadata[key] = value
        elif isinstance(value, str):
            safe_metadata[key] = value[:100]

    detail = getattr(exc, "diagnostic_message", None) if exc is not None else None
    if detail is None:
        detail = f"Worker raised {type(exc).__name__}" if exc is not None else ""
    payload = {
        "stage": stage,
        "error_type": error_type or (type(exc).__name__ if exc is not None else None),
        "message": safe_message(message if message is not None else detail),
        "metadata": safe_metadata,
    }
    print(DIAGNOSTIC_PREFIX + json.dumps(payload, sort_keys=True), file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--transfer-syntax", required=True)
    args = parser.parse_args()

    try:
        from benchmark import compress_verified_dicom
    except SystemExit as exc:
        emit_diagnostic(
            "runtime_dependency",
            exc,
            message="Required Python packages are unavailable",
            error_type="MissingDependency",
        )
        return 2
    except Exception as exc:
        emit_diagnostic("python_import", exc)
        return 2

    try:
        verified = compress_verified_dicom(
            args.input,
            args.output,
            args.transfer_syntax,
        )
    except Exception as exc:
        emit_diagnostic(
            getattr(exc, "stage", "compression"),
            exc,
            getattr(exc, "metadata", None),
        )
        print(
            f"Compression or verification failed: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 1
    payload = {
        "pixel_hash": verified.pixel_hash,
        "provenance": verified.provenance,
    }
    print(RESULT_PREFIX + json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
