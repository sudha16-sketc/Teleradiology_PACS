from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image
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

from benchmark import (
    LosslessCompressionError,
    canonical_pixel_hash,
    compress_verified_dicom,
    compress_verified_file,
    validate_decoded_pixel_shape,
)


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


def write_jpeg_baseline_dicom(
    path: Path,
    pixels: np.ndarray,
    *,
    include_history: bool = True,
) -> np.ndarray:
    write_test_dicom(path)
    dataset = pydicom.dcmread(path)
    encoded = BytesIO()
    Image.fromarray(pixels, mode="L").save(encoded, format="JPEG", quality=95)
    dataset.Rows = pixels.shape[0]
    dataset.Columns = pixels.shape[1]
    dataset.file_meta.TransferSyntaxUID = JPEGBaseline8Bit
    dataset.PixelData = encapsulate([encoded.getvalue()])
    dataset["PixelData"].VR = "OB"
    dataset["PixelData"].is_undefined_length = True
    if include_history:
        dataset.LossyImageCompression = "01"
        dataset.LossyImageCompressionMethod = "ISO_10918_1"
        dataset.LossyImageCompressionRatio = "4.0"
    dataset.save_as(path, enforce_file_format=True)
    return np.asarray(pydicom.dcmread(path).pixel_array).copy()


def write_multiframe_jpeg_baseline_dicom(
    path: Path,
    frames: np.ndarray,
    *,
    include_history: bool = True,
) -> np.ndarray:
    frames = np.asarray(frames, dtype=np.uint8)
    if frames.ndim != 3 or frames.shape[0] < 2:
        raise ValueError("Multi-frame fixtures require a (frames, rows, columns) array")

    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = JPEGBaseline8Bit
    dataset = FileDataset(str(path), {}, file_meta=file_meta, preamble=b"\0" * 128)
    dataset.SOPClassUID = file_meta.MediaStorageSOPClassUID
    dataset.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    dataset.StudyInstanceUID = generate_uid()
    dataset.SeriesInstanceUID = generate_uid()
    dataset.Rows = frames.shape[1]
    dataset.Columns = frames.shape[2]
    dataset.NumberOfFrames = frames.shape[0]
    dataset.SamplesPerPixel = 1
    dataset.PhotometricInterpretation = "MONOCHROME2"
    dataset.BitsAllocated = 8
    dataset.BitsStored = 8
    dataset.HighBit = 7
    dataset.PixelRepresentation = 0

    encoded_frames: list[bytes] = []
    for frame in frames:
        encoded = BytesIO()
        Image.fromarray(frame, mode="L").save(encoded, format="JPEG", quality=95)
        encoded_frames.append(encoded.getvalue())
    dataset.PixelData = encapsulate(encoded_frames)
    dataset["PixelData"].VR = "OB"
    dataset["PixelData"].is_undefined_length = True
    if include_history:
        dataset.LossyImageCompression = "01"
        dataset.LossyImageCompressionMethod = "ISO_10918_1"
        dataset.LossyImageCompressionRatio = "4.0"
    dataset.save_as(path, enforce_file_format=True)
    return np.asarray(pydicom.dcmread(path).pixel_array).copy()


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

    def test_jpeg_baseline_is_reencoded_losslessly_and_history_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "baseline.dcm"
            output = Path(work) / "verified.dcm"
            original_pixels = np.random.default_rng(7).integers(
                0, 256, size=(96, 96), dtype=np.uint8
            )
            source_pixels = write_jpeg_baseline_dicom(source, original_pixels)

            verified = compress_verified_dicom(source, output, str(JPEG2000Lossless))
            result = pydicom.dcmread(output)
            output_pixels = np.asarray(result.pixel_array)

            self.assertEqual(
                str(result.file_meta.TransferSyntaxUID),
                str(JPEG2000Lossless),
            )
            np.testing.assert_array_equal(output_pixels, source_pixels)
            self.assertEqual(
                str(result.LossyImageCompression),
                "01",
            )
            self.assertEqual(
                str(result.LossyImageCompressionMethod),
                "ISO_10918_1",
            )
            self.assertEqual(
                str(result.LossyImageCompressionRatio),
                "4.0",
            )
            provenance = verified.provenance
            self.assertEqual(
                provenance["source_transfer_syntax"],
                str(JPEGBaseline8Bit),
            )
            self.assertEqual(
                provenance["target_transfer_syntax"],
                str(JPEG2000Lossless),
            )
            self.assertTrue(provenance["prior_lossy_compression"])
            self.assertFalse(provenance["lossy_history_normalized"])
            self.assertEqual(
                provenance["reencode_policy_version"],
                "jpeg-baseline-lossless-v1",
            )
            self.assertTrue(provenance["pixel_verified"])
            self.assertEqual(
                provenance["source_pixel_sha256"],
                provenance["output_pixel_sha256"],
            )
            self.assertEqual(
                verified.pixel_hash,
                provenance["source_pixel_sha256"],
            )
            self.assertTrue(source.exists())

    def test_jpeg_baseline_missing_history_is_normalized_without_ratio(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "baseline-missing-history.dcm"
            output = Path(work) / "verified.dcm"
            source_pixels = write_jpeg_baseline_dicom(
                source,
                np.random.default_rng(17).integers(
                    0, 256, size=(64, 64), dtype=np.uint8
                ),
                include_history=False,
            )
            source_bytes = source.read_bytes()

            verified = compress_verified_dicom(source, output, str(JPEG2000Lossless))
            result = pydicom.dcmread(output)

            self.assertEqual(
                str(result.file_meta.TransferSyntaxUID),
                str(JPEG2000Lossless),
            )
            self.assertEqual(str(result.LossyImageCompression), "01")
            self.assertEqual(
                str(result.LossyImageCompressionMethod),
                "ISO_10918_1",
            )
            self.assertNotIn("LossyImageCompressionRatio", result)
            np.testing.assert_array_equal(np.asarray(result.pixel_array), source_pixels)
            self.assertEqual(source.read_bytes(), source_bytes)
            self.assertTrue(verified.provenance["pixel_verified"])
            self.assertTrue(verified.provenance["lossy_history_normalized"])
            self.assertEqual(
                verified.provenance["lossy_history_normalization_reason"],
                "jpeg-baseline-transfer-syntax",
            )

    def test_jpeg_baseline_preserves_method_without_inventing_ratio(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "baseline-no-ratio.dcm"
            output = Path(work) / "verified.dcm"
            write_jpeg_baseline_dicom(
                source,
                np.arange(64 * 64, dtype=np.uint8).reshape((64, 64)),
                include_history=False,
            )
            dataset = pydicom.dcmread(source)
            dataset.LossyImageCompression = "01"
            dataset.LossyImageCompressionMethod = "ISO_10918_1"
            dataset.save_as(source, enforce_file_format=True)

            compress_verified_file(source, output, str(JPEG2000Lossless))
            result = pydicom.dcmread(output)

            self.assertEqual(str(result.LossyImageCompression), "01")
            self.assertEqual(
                str(result.LossyImageCompressionMethod),
                "ISO_10918_1",
            )
            self.assertNotIn("LossyImageCompressionRatio", result)

    def test_multiframe_jpeg_baseline_without_history_is_reencoded_frame_by_frame(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "multiframe-baseline.dcm"
            output = Path(work) / "verified.dcm"
            frames = np.random.default_rng(11).integers(
                0,
                256,
                size=(3, 48, 64),
                dtype=np.uint8,
            )
            source_pixels = write_multiframe_jpeg_baseline_dicom(
                source,
                frames,
                include_history=False,
            )

            verified = compress_verified_dicom(source, output, str(JPEG2000Lossless))
            result = pydicom.dcmread(output)
            output_pixels = np.asarray(result.pixel_array).copy()

            self.assertEqual(source_pixels.shape, (3, 48, 64))
            self.assertEqual(int(result.NumberOfFrames), 3)
            np.testing.assert_array_equal(output_pixels, source_pixels)
            self.assertEqual(
                str(result.file_meta.TransferSyntaxUID),
                str(JPEG2000Lossless),
            )
            self.assertEqual(str(result.LossyImageCompression), "01")
            self.assertNotIn("LossyImageCompressionRatio", result)
            self.assertEqual(verified.pixel_hash, canonical_pixel_hash(source_pixels))
            self.assertTrue(verified.provenance["pixel_verified"])
            self.assertTrue(verified.provenance["lossy_history_normalized"])
            self.assertEqual(
                verified.provenance["source_pixel_sha256"],
                verified.provenance["output_pixel_sha256"],
            )
            self.assertEqual(
                str(result.LossyImageCompressionMethod),
                "ISO_10918_1",
            )

    def test_multiframe_decoded_array_requires_the_frame_axis(self) -> None:
        metadata = {"rows": 48, "columns": 64, "number_of_frames": 3}

        with self.assertRaises(LosslessCompressionError) as context:
            validate_decoded_pixel_shape(
                np.zeros((48, 64), dtype=np.uint8),
                metadata,
                "decode_source_pixels",
                "Source syntax",
                {},
            )

        self.assertEqual(context.exception.stage, "decode_source_pixels")

    def test_inconsistent_multiframe_pixel_data_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "inconsistent.dcm"
            output = Path(work) / "verified.dcm"
            frames = np.random.default_rng(13).integers(
                0,
                256,
                size=(3, 48, 64),
                dtype=np.uint8,
            )
            write_multiframe_jpeg_baseline_dicom(source, frames)
            dataset = pydicom.dcmread(source)
            encoded = BytesIO()
            Image.fromarray(frames[0], mode="L").save(encoded, format="JPEG", quality=95)
            dataset.PixelData = encapsulate([encoded.getvalue()])
            dataset["PixelData"].VR = "OB"
            dataset["PixelData"].is_undefined_length = True
            dataset.save_as(source, enforce_file_format=True)

            with self.assertRaises(LosslessCompressionError) as context:
                compress_verified_file(source, output, str(JPEG2000Lossless))

            self.assertEqual(context.exception.stage, "decode_source_pixels")
            self.assertFalse(output.exists())

    def test_jpeg_baseline_rejects_inconsistent_lossy_history(self) -> None:
        invalid_values = (
            ("LossyImageCompression", "00"),
            ("LossyImageCompressionMethod", "UNSUPPORTED"),
            ("LossyImageCompressionRatio", "0"),
        )
        for keyword, value in invalid_values:
            with self.subTest(keyword=keyword), tempfile.TemporaryDirectory() as work:
                source = Path(work) / "baseline.dcm"
                output = Path(work) / "verified.dcm"
                write_jpeg_baseline_dicom(
                    source,
                    np.arange(64 * 64, dtype=np.uint8).reshape((64, 64)),
                    include_history=False,
                )
                dataset = pydicom.dcmread(source)
                dataset.LossyImageCompression = "01"
                dataset.LossyImageCompressionMethod = "ISO_10918_1"
                dataset.LossyImageCompressionRatio = "4.0"
                setattr(dataset, keyword, value)
                dataset.save_as(source, enforce_file_format=True)

                with self.assertRaises(LosslessCompressionError) as context:
                    compress_verified_file(source, output, str(JPEG2000Lossless))

                self.assertEqual(context.exception.stage, "validate_lossy_history")
                self.assertFalse(output.exists())

    def test_jpeg_baseline_rejects_non_jpeg2000_target(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "baseline.dcm"
            output = Path(work) / "verified.dcm"
            write_jpeg_baseline_dicom(
                source,
                np.arange(64 * 64, dtype=np.uint8).reshape((64, 64)),
            )

            with self.assertRaises(LosslessCompressionError) as context:
                compress_verified_file(source, output, str(JPEGLSLossless))

            self.assertEqual(context.exception.stage, "validate_target_syntax")
            self.assertFalse(output.exists())

    def test_other_lossy_syntaxes_are_still_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / "lossy.dcm"
            output = Path(work) / "verified.dcm"
            write_test_dicom(source)
            dataset = pydicom.dcmread(source)
            dataset.file_meta.TransferSyntaxUID = "1.2.840.10008.1.2.4.51"
            dataset.PixelData = encapsulate([dataset.PixelData])
            dataset["PixelData"].VR = "OB"
            dataset["PixelData"].is_undefined_length = True
            dataset.save_as(source, enforce_file_format=True)

            with self.assertRaises(LosslessCompressionError) as context:
                compress_verified_file(source, output, str(JPEG2000Lossless))

            self.assertEqual(context.exception.stage, "validate_source_syntax")
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

            result_lines = [
                line
                for line in result.stdout.splitlines()
                if line.startswith("AXIS_DICOM_RESULT=")
            ]
            self.assertEqual(len(result_lines), 1)
            payload = json.loads(result_lines[0].split("=", 1)[1])
            self.assertEqual(
                payload["pixel_hash"],
                hashlib.sha256(expected_pixels.tobytes(order="C")).hexdigest(),
            )
            provenance = payload["provenance"]
            self.assertEqual(
                provenance["target_transfer_syntax"],
                str(JPEG2000Lossless),
            )
            self.assertTrue(provenance["pixel_verified"])
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
