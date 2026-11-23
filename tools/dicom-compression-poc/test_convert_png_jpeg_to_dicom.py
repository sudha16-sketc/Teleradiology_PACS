from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

from PIL import Image
from pydicom import dcmread


SCRIPT = Path(__file__).with_name("convert_png_jpeg_to_dicom.py")


class ConvertPngJpegToDicomTests(unittest.TestCase):
    def run_conversion(self, images):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            manifest = []
            for name, mode, size, pixel in images:
                path = root / name
                image = Image.new(mode, size, pixel)
                image.save(path)
                manifest.append({"name": name, "path": str(path)})

            manifest_path = root / "manifest.json"
            metadata_path = root / "metadata.json"
            output_dir = root / "output"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            metadata_path.write_text(
                json.dumps(
                    {
                        "patientName": "Test Patient",
                        "patientAge": 42,
                        "gender": "F",
                        "referringPhysician": "Test Doctor",
                        "studyDescription": "Imported image",
                        "patientId": "TEST-PATIENT",
                        "maxFileBytes": 25 * 1024 * 1024,
                        "maxDimension": 20000,
                        "maxImages": 100,
                        "maxTotalBytes": 100 * 1024 * 1024,
                    }
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--manifest",
                    str(manifest_path),
                    "--output-dir",
                    str(output_dir),
                    "--metadata",
                    str(metadata_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            datasets = [dcmread(path) for path in sorted(output_dir.glob("*.dcm"))]
            return datasets

    def test_png_rgb_shared_study_series_and_unique_sop(self):
        ds = self.run_conversion(
            [
                ("one.png", "RGB", (3, 2), (10, 20, 30)),
                ("two.png", "RGB", (4, 3), (40, 50, 60)),
            ]
        )
        self.assertEqual(len(ds), 2)
        self.assertEqual(ds[0].StudyInstanceUID, ds[1].StudyInstanceUID)
        self.assertEqual(ds[0].SeriesInstanceUID, ds[1].SeriesInstanceUID)
        self.assertNotEqual(ds[0].SOPInstanceUID, ds[1].SOPInstanceUID)
        self.assertEqual(str(ds[0].SOPClassUID), "1.2.840.10008.5.1.4.1.1.7")
        self.assertEqual(ds[0].Rows, 2)
        self.assertEqual(ds[0].Columns, 3)
        self.assertEqual(ds[0].SamplesPerPixel, 3)
        self.assertEqual(ds[0].PhotometricInterpretation, "RGB")

    def test_png_grayscale_pixel_values(self):
        ds = self.run_conversion([("gray.png", "L", (3, 2), 123)])
        self.assertEqual(ds[0].Rows, 2)
        self.assertEqual(ds[0].Columns, 3)
        self.assertEqual(ds[0].SamplesPerPixel, 1)
        self.assertEqual(ds[0].PhotometricInterpretation, "MONOCHROME2")
        self.assertTrue((ds[0].PixelData == bytes([123]) * 6).all() if hasattr(ds[0].PixelData, "all") else ds[0].PixelData == bytes([123]) * 6)

    def test_jpeg_rgb_dimensions(self):
        ds = self.run_conversion([("photo.jpg", "RGB", (5, 4), (100, 110, 120))])
        self.assertEqual(ds[0].Rows, 4)
        self.assertEqual(ds[0].Columns, 5)
        self.assertEqual(ds[0].SamplesPerPixel, 3)

    def test_corrupt_file_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bad = root / "bad.png"
            bad.write_bytes(b"not an image")
            manifest_path = root / "manifest.json"
            metadata_path = root / "metadata.json"
            manifest_path.write_text(json.dumps([{"name": "bad.png", "path": str(bad)}]))
            metadata_path.write_text(json.dumps({"maxFileBytes": 1000, "maxDimension": 100, "maxImages": 10, "maxTotalBytes": 10000}))
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--manifest",
                    str(manifest_path),
                    "--output-dir",
                    str(root / "output"),
                    "--metadata",
                    str(metadata_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("AXIS_IMAGE_CONVERSION_ERROR=", result.stderr)


if __name__ == "__main__":
    unittest.main()
