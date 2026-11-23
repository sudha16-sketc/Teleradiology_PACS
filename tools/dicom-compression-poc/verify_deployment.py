from __future__ import annotations

import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import tempfile

import numpy as np
from PIL import Image
import PIL
import pydicom
import jpeg_ls
import libjpeg
import openjpeg
import pylibjpeg
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.encaps import encapsulate
from pydicom.uid import (
    ExplicitVRLittleEndian,
    JPEGBaseline8Bit,
    JPEG2000Lossless,
    JPEGLSLossless,
    SecondaryCaptureImageStorage,
    generate_uid,
)

from benchmark import compress_verified_dicom, compress_verified_file

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
BASELINE_TARGET_SYNTAX = str(JPEG2000Lossless)


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


def write_synthetic_jpeg_baseline_dicom(path: Path, pixels: np.ndarray) -> np.ndarray:
    write_synthetic_dicom(path, pixels)
    dataset = pydicom.dcmread(path)
    encoded = BytesIO()
    Image.fromarray(pixels, mode="L").save(encoded, format="JPEG", quality=95)
    dataset.Rows = pixels.shape[0]
    dataset.Columns = pixels.shape[1]
    dataset.BitsAllocated = pixels.dtype.itemsize * 8
    dataset.BitsStored = pixels.dtype.itemsize * 8
    dataset.HighBit = pixels.dtype.itemsize * 8 - 1
    dataset.PixelRepresentation = 0
    dataset.file_meta.TransferSyntaxUID = JPEGBaseline8Bit
    dataset.PixelData = encapsulate([encoded.getvalue()])
    dataset["PixelData"].VR = "OB"
    dataset["PixelData"].is_undefined_length = True
    dataset.LossyImageCompression = "01"
    dataset.LossyImageCompressionMethod = "ISO_10918_1"
    dataset.LossyImageCompressionRatio = "4.0"
    dataset.save_as(path, enforce_file_format=True)
    return np.asarray(pydicom.dcmread(path).pixel_array).copy()


def write_synthetic_rgb_dicom(path: Path, pixels: np.ndarray) -> np.ndarray:
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
    dataset.SamplesPerPixel = 3
    dataset.PhotometricInterpretation = "RGB"
    dataset.PlanarConfiguration = 0
    dataset.BitsAllocated = 8
    dataset.BitsStored = 8
    dataset.HighBit = 7
    dataset.PixelRepresentation = 0
    dataset.PixelData = pixels.tobytes()
    dataset.save_as(path, enforce_file_format=True)
    return np.asarray(pydicom.dcmread(path).pixel_array).copy()


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
    baseline_pixels = np.arange(64 * 64, dtype=np.uint8).reshape((64, 64))
    rgb_pixels = np.arange(64 * 64 * 3, dtype=np.uint8).reshape((64, 64, 3))

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

        baseline_source = Path(work) / "baseline.dcm"
        baseline_output = Path(work) / "baseline-verified.dcm"
        source_pixels = write_synthetic_jpeg_baseline_dicom(baseline_source, baseline_pixels)
        source_pixel_hash = hashlib.sha256(source_pixels.tobytes(order="C")).hexdigest()
        baseline = compress_verified_dicom(
            baseline_source,
            baseline_output,
            BASELINE_TARGET_SYNTAX,
        )
        baseline_result = pydicom.dcmread(baseline_output)
        baseline_decoded = np.asarray(baseline_result.pixel_array)
        baseline_verified = (
            baseline.pixel_hash == source_pixel_hash
            and str(baseline_result.file_meta.TransferSyntaxUID) == BASELINE_TARGET_SYNTAX
            and baseline_decoded.dtype == source_pixels.dtype
            and baseline_decoded.shape == source_pixels.shape
            and np.array_equal(baseline_decoded, source_pixels)
            and str(baseline_result.LossyImageCompression) == "01"
            and str(baseline_result.LossyImageCompressionMethod) == "ISO_10918_1"
            and baseline.provenance.get("source_transfer_syntax") == str(JPEGBaseline8Bit)
            and baseline.provenance.get("target_transfer_syntax") == BASELINE_TARGET_SYNTAX
            and baseline.provenance.get("prior_lossy_compression") is True
            and baseline.provenance.get("pixel_verified") is True
        )

        rgb_source = Path(work) / "rgb-source.dcm"
        rgb_output = Path(work) / "rgb-verified.dcm"
        write_synthetic_rgb_dicom(rgb_source, rgb_pixels)
        rgb_pixel_hash = compress_verified_file(
            rgb_source,
            rgb_output,
            str(JPEG2000Lossless),
        )
        rgb_result = pydicom.dcmread(rgb_output)
        rgb_decoded = np.asarray(rgb_result.pixel_array)
        rgb_verified = (
            rgb_pixel_hash
            == hashlib.sha256(rgb_pixels.tobytes(order="C")).hexdigest()
            and str(rgb_result.file_meta.TransferSyntaxUID)
            == str(JPEG2000Lossless)
            and int(rgb_result.SamplesPerPixel) == 3
            and str(rgb_result.PhotometricInterpretation) == "RGB"
            and int(rgb_result.PlanarConfiguration) == 0
            and rgb_decoded.shape == rgb_pixels.shape
            and np.array_equal(rgb_decoded, rgb_pixels)
        )

    ok = verified and baseline_verified and rgb_verified
    payload = {
        "ok": ok,
        "stage": "synthetic_encode_decode",
        "python_executable": sys.executable,
        "python_version": sys.version.split()[0],
        "target_transfer_syntax": TARGET_SYNTAX,
        "verified": verified,
        "baseline_verified": baseline_verified,
        "rgb_verified": rgb_verified,
        "baseline_target_transfer_syntax": BASELINE_TARGET_SYNTAX,
        "baseline_source_pixel_sha256": source_pixel_hash,
        "baseline_output_pixel_sha256": baseline.pixel_hash,
        "packages": versions,
        "pixel_shape": list(pixels.shape),
        "pixel_dtype": str(pixels.dtype),
        "pixel_hash": pixel_hash,
    }
    print(json.dumps(payload, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
