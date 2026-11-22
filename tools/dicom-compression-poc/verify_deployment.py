from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

import numpy as np
import PIL
import pydicom
import jpeg_ls
import libjpeg
import openjpeg
import pylibjpeg
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import (
    ExplicitVRLittleEndian,
    JPEG2000Lossless,
    JPEGLSLossless,
    SecondaryCaptureImageStorage,
    generate_uid,
)

from benchmark import compress_verified_file

REQUIRED_PACKAGES = {
    "numpy": np,
    "pydicom": pydicom,
    "Pillow": PIL,
    "pylibjpeg": pylibjpeg,
    "pylibjpeg_openjpeg": openjpeg,
    "pylibjpeg_libjpeg": libjpeg,
    "pyjpegls": jpeg_ls,
}
TARGET_SYNTAX = os.environ.get(
    "AXIS_DICOM_LOSSLESS_TRANSFER_SYNTAX",
    str(JPEG2000Lossless),
)
SUPPORTED_SYNTAXES = {str(JPEG2000Lossless), str(JPEGLSLossless)}


def write_synthetic_dicom(path: Path, pixels: np.ndarray) -> None:
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    dataset = FileDataset(str(path), {}, file_meta=file_meta, preamble=b"\0" * 128)
    dataset.SOPClassUID = file_meta.MediaStorageSOPClassUID
    dataset.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    dataset.StudyInstanceUID = generate_uid()
    dataset.SeriesInstanceUID = generate_uid()
    dataset.Modality = "OT"
    dataset.Rows = pixels.shape[0]
    dataset.Columns = pixels.shape[1]
    dataset.SamplesPerPixel = 1
    dataset.PhotometricInterpretation = "MONOCHROME2"
    dataset.BitsAllocated = 16
    dataset.BitsStored = 16
    dataset.HighBit = 15
    dataset.PixelRepresentation = 0
    dataset.RescaleIntercept = 0
    dataset.RescaleSlope = 1
    dataset.PixelData = pixels.tobytes()
    dataset.save_as(path, enforce_file_format=True)


def main() -> int:
    if TARGET_SYNTAX not in SUPPORTED_SYNTAXES:
        print(
            json.dumps(
                {
                    "ok": False,
                    "stage": "validate_target_syntax",
                    "error": f"Unsupported target transfer syntax: {TARGET_SYNTAX}",
                },
                sort_keys=True,
            )
        )
        return 1

    versions = {
        name: getattr(module, "__version__", "installed")
        for name, module in REQUIRED_PACKAGES.items()
    }
    pixels = np.arange(64 * 64, dtype=np.uint16).reshape((64, 64))
    expected_hash = hashlib.sha256(pixels.tobytes(order="C")).hexdigest()

    with tempfile.TemporaryDirectory(prefix="axis-dicom-verify-") as work:
        source = Path(work) / "source.dcm"
        output = Path(work) / "verified.dcm"
        write_synthetic_dicom(source, pixels)
        pixel_hash = compress_verified_file(source, output, TARGET_SYNTAX)
        result = pydicom.dcmread(output)
        decoded = np.asarray(result.pixel_array)
        output_syntax = str(result.file_meta.TransferSyntaxUID)
        verified = (
            pixel_hash == expected_hash
            and output_syntax == TARGET_SYNTAX
            and decoded.dtype == pixels.dtype
            and decoded.shape == pixels.shape
            and np.array_equal(decoded, pixels)
        )

    payload = {
        "ok": verified,
        "stage": "synthetic_encode_decode",
        "python_executable": sys.executable,
        "python_version": sys.version.split()[0],
        "target_transfer_syntax": TARGET_SYNTAX,
        "verified": verified,
        "packages": versions,
        "pixel_shape": list(pixels.shape),
        "pixel_dtype": str(pixels.dtype),
        "pixel_hash": pixel_hash,
    }
    print(json.dumps(payload, sort_keys=True))
    return 0 if verified else 1


if __name__ == "__main__":
    raise SystemExit(main())
