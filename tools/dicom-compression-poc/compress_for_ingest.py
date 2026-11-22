#!/usr/bin/env python3
"""Compress and verify one DICOM instance for the production ingest path."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from benchmark import compress_verified_file


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--transfer-syntax", required=True)
    args = parser.parse_args()
    try:
        pixel_hash = compress_verified_file(
            args.input,
            args.output,
            args.transfer_syntax,
        )
    except Exception as exc:
        print(
            f"Compression or verification failed: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 1
    print(pixel_hash)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
