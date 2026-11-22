from __future__ import annotations

import hashlib
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.encaps import encapsulate
from pydicom.errors import InvalidDicomError
from pydicom.uid import (
    ExplicitVRLittleEndian,
    JPEGBaseline8Bit,
    JPEGLSLossless,
    JPEG2000Lossless,
    SecondaryCaptureImageStorage,
    generate_uid,
)

from benchmark import LosslessCompressionError, compress_verified_file


def write_test_dicom(path: Path) -> np.ndarray:
    pixels = np.random.default_rng(42).integers(
        0,
        256,
        size=(64, 64),
        dtype=np.uint8,
    )
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    dataset = FileDataset(str(path), {}, file_meta=file_meta, preamble=b"\0" * 128)
    dataset.SOPClassUID = file_meta.MediaStorageSOPClassUID
    dataset.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    dataset.StudyInstanceUID = generate_uid()
    dataset.SeriesInstanceUID = generate_uid()
    dataset.Rows = pixels.shape[0]
    dataset.Columns = pixels.shape[1]
    dataset.SamplesPerPixel = 1
    dataset.PhotometricInterpretation = "MONOCHROME2"
    dataset.BitsAllocated = 8
    dataset.BitsStored = 8
    dataset.HighBit = 7
    dataset.PixelRepresentation = 0
    dataset.PixelData = pixels.tobytes()
    dataset.save_as(path, enforce_file_format=True)
    return pixels


class CompressForIngestTests(unittest.TestCase):
    def test_cxr004_lossless_jpeg_ls_passes_through_unchanged(self) -> None:
        source = Path(__file__).with_name("samples") / "cxr004.dcm"
        if not source.is_file():
            self.skipTest("samples/cxr004.dcm is not present")

        with tempfile.TemporaryDirectory() as work:
            output = Path(work) / "verified.dcm"
            input_dataset = pydicom.dcmread(source)
            input_pixels = np.asarray(input_dataset.pixel_array)
            input_hash = hashlib.sha256(input_pixels.tobytes(order="C")).hexdigest()
            input_syntax = str(input_dataset.file_meta.TransferSyntaxUID)

            pixel_hash = compress_verified_file(
                source,
                output,
                str(JPEG2000Lossless),
            )
            result = pydicom.dcmread(output)
            output_pixels = np.asarray(result.pixel_array)

            self.assertEqual(pixel_hash, input_hash)
            self.assertEqual(
                hashlib.sha256(output_pixels.tobytes(order="C")).hexdigest(),
                input_hash,
            )
            self.assertEqual(
                str(result.file_meta.TransferSyntaxUID),
                input_syntax,
            )
            self.assertEqual(output.read_bytes(), source.read_bytes())

    def test_lossy_syntax_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "lossy.dcm"
            output = Path(work) / "verified.dcm"
            write_test_dicom(source)
            dataset = pydicom.dcmread(source)
            dataset.file_meta.TransferSyntaxUID = JPEGBaseline8Bit
            dataset.PixelData = encapsulate([dataset.PixelData])
            dataset["PixelData"].VR = "OB"
            dataset["PixelData"].is_undefined_length = True
            dataset.save_as(source, enforce_file_format=True)

            with self.assertRaisesRegex(
                ValueError,
                r"Source syntax 1\.2\.840\.10008\.1\.2\.4\.50.*lossy",
            ):
                compress_verified_file(source, output, str(JPEG2000Lossless))

            self.assertFalse(output.exists())

    def test_lossless_encoders_preserve_pixels_and_select_requested_syntax(self) -> None:
        for syntax in (JPEG2000Lossless, JPEGLSLossless):
            with self.subTest(transfer_syntax=str(syntax)), tempfile.TemporaryDirectory() as work:
                source = Path(work) / "source.dcm"
                output = Path(work) / "verified.dcm"
                expected_pixels = write_test_dicom(source)

                pixel_hash = compress_verified_file(source, output, str(syntax))
                result = pydicom.dcmread(output)

                self.assertEqual(
                    pixel_hash,
                    hashlib.sha256(expected_pixels.tobytes(order="C")).hexdigest(),
                )
                self.assertEqual(str(result.file_meta.TransferSyntaxUID), str(syntax))
                np.testing.assert_array_equal(result.pixel_array, expected_pixels)
                self.assertTrue(source.exists())

    def test_rejects_unsupported_syntax_without_creating_output(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "source.dcm"
            output = Path(work) / "verified.dcm"
            write_test_dicom(source)

            with self.assertRaisesRegex(ValueError, "Unsupported lossless transfer syntax"):
                compress_verified_file(source, output, "1.2.840.10008.1.2.5")

            self.assertFalse(output.exists())
            self.assertTrue(source.exists())

    def test_verification_failure_removes_compressed_output(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "not-dicom.dcm"
            output = Path(work) / "verified.dcm"
            source.write_bytes(b"not a DICOM instance")

            with self.assertRaises(InvalidDicomError):
                compress_verified_file(source, output, str(JPEG2000Lossless))

            self.assertFalse(output.exists())

    def test_ingest_cli_emits_hash_and_verified_instance(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "source.dcm"
            output = Path(work) / "verified.dcm"
            expected_pixels = write_test_dicom(source)
            script = Path(__file__).with_name("compress_for_ingest.py")

            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--input",
                    str(source),
                    "--output",
                    str(output),
                    "--transfer-syntax",
                    str(JPEG2000Lossless),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            self.assertEqual(
                result.stdout.strip(),
                hashlib.sha256(expected_pixels.tobytes(order="C")).hexdigest(),
            )
            self.assertEqual(
                str(pydicom.dcmread(output).file_meta.TransferSyntaxUID),
                str(JPEG2000Lossless),
            )

    def test_missing_pixel_data_reports_stage_and_safe_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "source.dcm"
            output = Path(work) / "verified.dcm"
            write_test_dicom(source)
            dataset = pydicom.dcmread(source)
            dataset.PatientName = "Sensitive^Name"
            dataset.PatientID = "SENSITIVE-ID"
            del dataset["PixelData"]
            dataset.save_as(source, enforce_file_format=True)

            with self.assertRaises(LosslessCompressionError) as context:
                compress_verified_file(source, output, str(JPEG2000Lossless))

            self.assertEqual(context.exception.stage, "validate_source")
            metadata = context.exception.metadata
            self.assertEqual(
                metadata["source_transfer_syntax"],
                str(ExplicitVRLittleEndian),
            )
            self.assertEqual(metadata["rows"], 64)
            self.assertEqual(metadata["columns"], 64)
            self.assertFalse(any("patient" in key.lower() for key in metadata))
            self.assertNotIn("Sensitive", str(metadata))
            self.assertFalse(output.exists())

    def test_cli_emits_structured_diagnostic_without_patient_information(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "source.dcm"
            output = Path(work) / "verified.dcm"
            write_test_dicom(source)
            dataset = pydicom.dcmread(source)
            dataset.PatientName = "Sensitive^Name"
            dataset.PatientID = "SENSITIVE-ID"
            del dataset["PixelData"]
            dataset.save_as(source, enforce_file_format=True)
            script = Path(__file__).with_name("compress_for_ingest.py")

            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--input",
                    str(source),
                    "--output",
                    str(output),
                    "--transfer-syntax",
                    str(JPEG2000Lossless),
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 1)
            diagnostic_lines = [
                line
                for line in result.stderr.splitlines()
                if line.startswith("AXIS_DICOM_DIAGNOSTIC=")
            ]
            self.assertEqual(len(diagnostic_lines), 1)
            payload = json.loads(diagnostic_lines[0].split("=", 1)[1])
            self.assertEqual(payload["stage"], "validate_source")
            self.assertEqual(payload["metadata"]["rows"], 64)
            self.assertNotIn("Sensitive", result.stderr)
            self.assertNotIn("SENSITIVE-ID", result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
