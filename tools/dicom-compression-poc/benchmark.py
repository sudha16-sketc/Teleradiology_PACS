#!/usr/bin/env python3
"""Benchmark lossless and opt-in lossy DICOM transfer syntaxes."""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
from io import BytesIO
import math
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import numpy as np
    import pydicom
    from PIL import Image
    from pydicom.dataset import Dataset
    from pydicom.encaps import encapsulate, generate_frames
    from pydicom.uid import (
        ExplicitVRLittleEndian,
        ImplicitVRLittleEndian,
        JPEG2000,
        JPEG2000Lossless,
        JPEGBaseline8Bit,
        JPEGLSLossless,
        RLELossless,
        UID,
    )
except ImportError as exc:
    print(
        f"Missing dependency: {exc}. Install the packages from requirements.txt.",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


TRANSFER_SYNTAX_TAG = 0x00020010
FILE_META_GROUP_LENGTH_TAG = 0x00020000
PIXEL_GROUPS = {0x0028, 0x7FE0}
LOSSY_TAGS = {0x00282110, 0x00282112, 0x00282114}
LOSSLESS_TRANSFER_SYNTAXES = {
    "1.2.840.10008.1.2.4.80",   # JPEG-LS Lossless
    "1.2.840.10008.1.2.4.90",   # JPEG 2000 Lossless
    "1.2.840.10008.1.2.4.201",  # HTJ2K Lossless
    "1.2.840.10008.1.2.5",      # RLE Lossless
}
UNCOMPRESSED_TRANSFER_SYNTAXES = {
    str(ExplicitVRLittleEndian),
    str(ImplicitVRLittleEndian),
}
CSV_FIELDS = [
    "file",
    "modality",
    "input_transfer_syntax",
    "input_size_bytes",
    "uncompressed_size_bytes",
    "transfer_syntax",
    "original_size_bytes",
    "compressed_size_bytes",
    "reduction_percent",
    "compress_time_seconds",
    "decompress_time_seconds",
    "verified",
    "psnr_db",
    "max_absolute_error",
    "error",
]


@dataclass(frozen=True)
class Variant:
    name: str
    uid: str
    plugin: str
    lossless: bool
    lossy_method: str | None = None
    options: dict[str, Any] | None = None


def parse_levels(value: str | None, label: str, minimum: float, maximum: float) -> list[float]:
    if value is None:
        return []
    try:
        levels = [float(item.strip()) for item in value.split(",")]
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{label} must be comma-separated numbers") from exc
    if len(levels) not in (2, 3):
        raise argparse.ArgumentTypeError(f"{label} requires exactly 2 or 3 values")
    if any(not math.isfinite(item) or item < minimum or item > maximum for item in levels):
        raise argparse.ArgumentTypeError(
            f"{label} values must be between {minimum:g} and {maximum:g}"
        )
    return levels


def variants_for(args: argparse.Namespace) -> list[Variant]:
    variants = [
        Variant("jpeg2000-lossless", str(JPEG2000Lossless), "pylibjpeg", True),
        Variant("jpeg-ls-lossless", str(JPEGLSLossless), "pyjpegls", True),
        Variant("rle-lossless", str(RLELossless), "pydicom", True),
    ]
    if args.decompress_first:
        return variants
    for ratio in args.jpeg2000_lossy_ratios:
        variants.append(
            Variant(
                f"jpeg2000-lossy-cr-{ratio:g}",
                str(JPEG2000),
                "pylibjpeg",
                False,
                "ISO_15444_1",
                {"j2k_cr": [ratio]},
            )
        )
    for quality in args.jpeg_baseline_qualities:
        variants.append(
            Variant(
                f"jpeg-baseline-q-{quality:g}",
                str(JPEGBaseline8Bit),
                    "pillow",
                False,
                "ISO_10918_1",
                {"quality": int(quality)},
            )
        )
    return variants


def _value_token(value: Any) -> str:
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_value_token(item) for item in value) + "]"
    if hasattr(value, "tolist"):
        return _value_token(value.tolist())
    return repr(value)


def metadata_snapshot(ds: Dataset) -> dict[str, str]:
    """Capture non-pixel dataset metadata, including nested sequence items."""
    snapshot: dict[str, str] = {}

    def visit(dataset: Dataset, prefix: str) -> None:
        for element in dataset:
            tag = int(element.tag)
            group = tag >> 16
            if (
                group in PIXEL_GROUPS
                or tag in LOSSY_TAGS
                or tag in {TRANSFER_SYNTAX_TAG, FILE_META_GROUP_LENGTH_TAG}
            ):
                continue
            key = f"{prefix}{tag:08X}"
            if element.VR == "SQ":
                snapshot[key] = "SQ"
                for index, item in enumerate(element.value):
                    visit(item, f"{key}[{index}]/")
            else:
                snapshot[key] = f"{element.VR}:{_value_token(element.value)}"

    visit(ds, "")
    if ds.file_meta:
        visit(ds.file_meta, "FILEMETA/")
    return snapshot


def metadata_preserved(before: Dataset, after: Dataset) -> bool:
    original = metadata_snapshot(before)
    compressed = metadata_snapshot(after)
    return all(compressed.get(tag) == value for tag, value in original.items())


def pixel_data_payload_size(ds: Dataset) -> int:
    transfer_syntax = UID(ds.file_meta.TransferSyntaxUID)
    if not transfer_syntax.is_compressed:
        return len(ds.PixelData)
    frame_count = int(getattr(ds, "NumberOfFrames", 1))
    return sum(
        len(frame)
        for frame in generate_frames(ds.PixelData, number_of_frames=frame_count)
    )


def set_lossy_attributes(ds: Dataset, original_pixel_bytes: int, method: str) -> None:
    compressed_pixel_bytes = pixel_data_payload_size(ds)
    if compressed_pixel_bytes <= 0 or original_pixel_bytes <= 0:
        raise ValueError("Cannot calculate a valid lossy compression ratio")
    ratio = original_pixel_bytes / compressed_pixel_bytes
    previous_ratios = _as_values(getattr(ds, "LossyImageCompressionRatio", None))
    previous_methods = _as_values(getattr(ds, "LossyImageCompressionMethod", None))
    ds.LossyImageCompression = "01"
    ds.LossyImageCompressionRatio = [*previous_ratios, f"{ratio:.6f}"]
    ds.LossyImageCompressionMethod = [*previous_methods, method]


def encode_jpeg_baseline(ds: Dataset, quality: int) -> None:
    if (
        int(getattr(ds, "BitsAllocated", 0)) != 8
        or int(getattr(ds, "BitsStored", 0)) > 8
        or int(getattr(ds, "PixelRepresentation", 0)) != 0
    ):
        raise ValueError("JPEG Baseline requires unsigned 8-bit pixel samples")

    pixels = np.asarray(ds.pixel_array)
    samples_per_pixel = int(getattr(ds, "SamplesPerPixel", 1))
    frame_count = int(getattr(ds, "NumberOfFrames", 1))
    if samples_per_pixel == 1:
        frames = [pixels] if frame_count == 1 else list(pixels)
        if any(frame.ndim != 2 for frame in frames):
            raise ValueError("JPEG Baseline expected monochrome frames")
    elif samples_per_pixel == 3:
        frames = [pixels] if frame_count == 1 else list(pixels)
        if any(frame.ndim != 3 or frame.shape[-1] != 3 for frame in frames):
            raise ValueError("JPEG Baseline expected RGB frames")
        ds.PhotometricInterpretation = "YBR_FULL_422"
        ds.PlanarConfiguration = 0
    else:
        raise ValueError("JPEG Baseline supports one or three samples per pixel")
    if not frames or any(frame.dtype != np.uint8 for frame in frames):
        raise ValueError("JPEG Baseline requires decoded unsigned 8-bit frames")

    encoded_frames: list[bytes] = []
    for frame in frames:
        image = Image.fromarray(frame)
        buffer = BytesIO()
        image.save(
            buffer,
            format="JPEG",
            quality=quality,
            progressive=False,
            optimize=False,
            subsampling=1 if samples_per_pixel == 3 else 0,
        )
        encoded_frames.append(buffer.getvalue())

    set_encapsulated_pixel_data(ds, encoded_frames, str(JPEGBaseline8Bit))


def encode_small_jpeg2000(ds: Dataset, variant: Variant) -> None:
    pixels = np.asarray(ds.pixel_array)
    samples_per_pixel = int(getattr(ds, "SamplesPerPixel", 1))
    frame_count = int(getattr(ds, "NumberOfFrames", 1))
    frames = [pixels] if frame_count == 1 else list(pixels)
    if samples_per_pixel not in (1, 3) or not frames:
        raise ValueError("Small-image JPEG 2000 fallback supports one or three samples per pixel")
    if any(frame.ndim != (2 if samples_per_pixel == 1 else 3) for frame in frames):
        raise ValueError("Small-image JPEG 2000 fallback received an unexpected frame shape")
    if samples_per_pixel == 3 and any(frame.shape[-1] != 3 for frame in frames):
        raise ValueError("Small-image JPEG 2000 fallback expected RGB frames")
    if any(frame.dtype not in (np.uint8, np.uint16) for frame in frames):
        raise ValueError("Small-image JPEG 2000 fallback requires unsigned 8-bit or 16-bit pixels")
    if samples_per_pixel == 3 and any(frame.dtype != np.uint8 for frame in frames):
        raise ValueError("Small-image JPEG 2000 fallback requires 8-bit RGB pixels")

    min_dimension = min(int(ds.Rows), int(ds.Columns))
    options: dict[str, Any] = {
        "no_jp2": True,
        "num_resolutions": max(1, min(6, int(math.log2(min_dimension)) + 1)),
        "mct": False,
    }
    if variant.lossless:
        options["irreversible"] = False
    else:
        options.update(
            {
                "irreversible": True,
                "quality_mode": "rates",
                "quality_layers": (variant.options or {})["j2k_cr"],
            }
        )

    encoded_frames: list[bytes] = []
    for frame in frames:
        buffer = BytesIO()
        Image.fromarray(frame).save(buffer, format="JPEG2000", **options)
        encoded_frames.append(buffer.getvalue())

    set_encapsulated_pixel_data(ds, encoded_frames, variant.uid)


def _as_values(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (str, bytes)) or not hasattr(value, "__iter__"):
        return [value]
    return list(value)


def lossy_attributes_valid(
    ds: Dataset,
    original_pixel_bytes: int,
    expected_method: str,
) -> bool:
    if str(getattr(ds, "LossyImageCompression", "")) != "01":
        return False
    ratios = _as_values(getattr(ds, "LossyImageCompressionRatio", None))
    methods = _as_values(getattr(ds, "LossyImageCompressionMethod", None))
    if not ratios or not methods or str(methods[-1]) != expected_method:
        return False
    try:
        last_ratio = float(ratios[-1])
        expected = original_pixel_bytes / pixel_data_payload_size(ds)
    except (TypeError, ValueError, ZeroDivisionError, AttributeError):
        return False
    return math.isfinite(last_ratio) and math.isclose(last_ratio, expected, rel_tol=1e-5)


def image_metrics(reference: np.ndarray, decoded: np.ndarray, bits_stored: int) -> tuple[float, float]:
    if reference.shape != decoded.shape:
        raise ValueError(
            f"Decoded pixel shape changed: {reference.shape} -> {decoded.shape}"
        )
    difference = reference.astype(np.float64) - decoded.astype(np.float64)
    max_error = float(np.max(np.abs(difference))) if difference.size else 0.0
    mse = float(np.mean(np.square(difference))) if difference.size else 0.0
    peak = float((1 << bits_stored) - 1) if bits_stored > 0 else float(
        max(np.max(reference), np.max(decoded), 1)
    )
    psnr = math.inf if mse == 0 else 20.0 * math.log10(peak) - 10.0 * math.log10(mse)
    return psnr, max_error


def output_path_for(output_dir: Path, source: Path, samples_dir: Path, variant: Variant) -> Path:
    relative = source.relative_to(samples_dir)
    return output_dir / relative.parent / f"{relative.stem}__{variant.name}.dcm"


def set_encapsulated_pixel_data(ds: Dataset, frames: list[bytes], transfer_syntax: str) -> None:
    ds.PixelData = encapsulate(frames)
    ds["PixelData"].VR = "OB"
    ds["PixelData"].is_undefined_length = True
    for tag in (0x7FE00001, 0x7FE00002):
        if tag in ds:
            del ds[tag]
    ds.file_meta.TransferSyntaxUID = transfer_syntax


def explicit_vr_little_endian(ds: Dataset, pixels: np.ndarray) -> tuple[Dataset, bytes]:
    """Copy a decoded dataset and reserialize it as native Explicit VR Little Endian."""
    converted = copy.deepcopy(ds)
    samples_per_pixel = int(getattr(converted, "SamplesPerPixel", 1))
    bits_allocated = int(getattr(converted, "BitsAllocated", 0))
    pixel_representation = int(getattr(converted, "PixelRepresentation", 0))

    if bits_allocated == 1:
        pixel_bytes = np.packbits(pixels.astype(np.bool_), bitorder="little").tobytes(order="C")
    elif bits_allocated == 8:
        if pixels.dtype != np.uint8:
            pixel_bytes = pixels.astype(np.uint8).tobytes(order="C")
        else:
            pixel_bytes = pixels.tobytes(order="C")
    elif bits_allocated == 16:
        dtype = np.dtype("<i2" if pixel_representation else "<u2")
        pixel_bytes = pixels.astype(dtype, copy=False).tobytes(order="C")
    elif bits_allocated == 32:
        dtype = np.dtype("<i4" if pixel_representation else "<u4")
        pixel_bytes = pixels.astype(dtype, copy=False).tobytes(order="C")
    else:
        raise ValueError(
            f"Unsupported BitsAllocated={bits_allocated} for Explicit VR Little Endian conversion"
        )

    if samples_per_pixel == 3:
        converted.PlanarConfiguration = 0

    if len(pixel_bytes) % 2:
        pixel_bytes += b"\0"
    converted.PixelData = pixel_bytes
    converted["PixelData"].VR = "OB" if bits_allocated == 8 else "OW"
    converted["PixelData"].is_undefined_length = False
    for tag in (0x7FE00001, 0x7FE00002):
        if tag in converted:
            del converted[tag]
    converted.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    converted.is_little_endian = True
    converted.is_implicit_VR = False
    converted.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    if not hasattr(converted, "PixelData"):
        raise ValueError("Failed to install uncompressed pixel data")

    buffer = BytesIO()
    converted.save_as(buffer, enforce_file_format=True)
    return converted, buffer.getvalue()


def failure_row(
    source: Path,
    samples_dir: Path,
    variant: Variant,
    modality: str,
    original_size: int,
    error: Exception,
    input_transfer_syntax: str = "",
    uncompressed_size: int | str = "",
) -> dict[str, Any]:
    return {
        "file": source.relative_to(samples_dir).as_posix(),
        "modality": modality,
        "input_transfer_syntax": input_transfer_syntax,
        "input_size_bytes": original_size,
        "uncompressed_size_bytes": uncompressed_size,
        "transfer_syntax": variant.uid,
        "original_size_bytes": original_size,
        "compressed_size_bytes": "",
        "reduction_percent": "",
        "compress_time_seconds": "",
        "decompress_time_seconds": "",
        "verified": "no",
        "psnr_db": "",
        "max_absolute_error": "",
        "error": f"{type(error).__name__}: {error}",
    }


def benchmark_variant(
    source: Path,
    samples_dir: Path,
    output_dir: Path,
    variant: Variant,
    original: Dataset,
    original_pixels: np.ndarray,
    original_pixel_bytes: int,
    original_size: int,
    input_transfer_syntax: str = "",
    uncompressed_size: int | str = "",
) -> dict[str, Any]:
    modality = str(getattr(original, "Modality", ""))
    compression_time: float | str = ""
    decompression_time: float | str = ""
    destination = output_path_for(output_dir, source, samples_dir, variant)

    try:
        encoded = copy.deepcopy(original)
        start = time.perf_counter()
        if variant.plugin == "pillow":
            encode_jpeg_baseline(encoded, int((variant.options or {})["quality"]))
        elif (
            variant.uid in {str(JPEG2000Lossless), str(JPEG2000)}
            and min(int(encoded.Rows), int(encoded.Columns)) < 32
        ):
            encode_small_jpeg2000(encoded, variant)
        else:
            encoded.compress(
                variant.uid,
                encoding_plugin=variant.plugin,
                generate_instance_uid=False,
                **(variant.options or {}),
            )
        compression_time = time.perf_counter() - start

        if not variant.lossless:
            set_lossy_attributes(encoded, original_pixel_bytes, variant.lossy_method or "")

        destination.parent.mkdir(parents=True, exist_ok=True)
        encoded.save_as(destination, enforce_file_format=True)

        result = pydicom.dcmread(destination)
        start = time.perf_counter()
        decoded_pixels = np.asarray(result.pixel_array)
        decompression_time = time.perf_counter() - start

        preserved = metadata_preserved(original, result)
        syntax_verified = (
            str(result.file_meta.TransferSyntaxUID) == variant.uid
            if result.file_meta and "TransferSyntaxUID" in result.file_meta
            else False
        )
        psnr: float | str = ""
        max_error: float | str = ""
        if variant.lossless:
            pixels_verified = (
                original_pixels.dtype == decoded_pixels.dtype
                and original_pixels.shape == decoded_pixels.shape
                and original_pixels.tobytes(order="C") == decoded_pixels.tobytes(order="C")
            )
            compression_tags_verified = True
        else:
            psnr, max_error = image_metrics(
                original_pixels,
                decoded_pixels,
                int(getattr(original, "BitsStored", 0)),
            )
            pixels_verified = True
            compression_tags_verified = lossy_attributes_valid(
                result,
                original_pixel_bytes,
                variant.lossy_method or "",
            )

        verified = (
            preserved
            and syntax_verified
            and pixels_verified
            and compression_tags_verified
        )
        if not verified:
            print(
                f"{source.name} [{variant.name}]: verification failed "
                f"(metadata={preserved}, transfer_syntax={syntax_verified}, "
                f"pixels={pixels_verified}, lossy_tags={compression_tags_verified})",
                file=sys.stderr,
            )
        compressed_size = destination.stat().st_size
        return {
            "file": source.relative_to(samples_dir).as_posix(),
            "modality": modality,
            "input_transfer_syntax": input_transfer_syntax,
            "input_size_bytes": original_size,
            "uncompressed_size_bytes": uncompressed_size,
            "transfer_syntax": variant.uid,
            "original_size_bytes": original_size,
            "compressed_size_bytes": compressed_size,
            "reduction_percent": round(
                (original_size - compressed_size) * 100.0 / original_size, 3
            )
            if original_size
            else "",
            "compress_time_seconds": round(float(compression_time), 6),
            "decompress_time_seconds": round(float(decompression_time), 6),
            "verified": "yes" if verified else "no",
            "psnr_db": "inf" if psnr == math.inf else (
                round(float(psnr), 6) if psnr != "" else ""
            ),
            "max_absolute_error": round(float(max_error), 6) if max_error != "" else "",
            "error": "" if verified else (
                "Verification failed: "
                f"metadata_preserved={preserved}, "
                f"transfer_syntax_verified={syntax_verified}, "
                f"pixels_verified={pixels_verified}, "
                f"lossy_tags_verified={compression_tags_verified}"
            ),
        }
    except Exception as exc:
        row = failure_row(
            source,
            samples_dir,
            variant,
            modality,
            original_size,
            exc,
            input_transfer_syntax,
            uncompressed_size,
        )
        row["compress_time_seconds"] = (
            round(float(compression_time), 6) if compression_time != "" else ""
        )
        row["decompress_time_seconds"] = (
            round(float(decompression_time), 6) if decompression_time != "" else ""
        )
        print(f"{source.name} [{variant.name}]: {row['error']}", file=sys.stderr)
        return row


def compress_verified_file(
    source: Path,
    destination: Path,
    transfer_syntax: str,
) -> str:
    """Compress uncompressed DICOM or pass through a valid lossless instance."""
    variants = {
        str(JPEG2000Lossless): Variant(
            "jpeg2000-lossless", str(JPEG2000Lossless), "pylibjpeg", True
        ),
        str(JPEGLSLossless): Variant(
            "jpeg-ls-lossless", str(JPEGLSLossless), "pyjpegls", True
        ),
    }
    variant = variants.get(transfer_syntax)
    if variant is None:
        raise ValueError(f"Unsupported lossless transfer syntax: {transfer_syntax}")

    source = source.resolve()
    destination = destination.resolve()
    if source == destination:
        raise ValueError("Compressed output must not overwrite the source DICOM")
    if destination.exists():
        raise FileExistsError(f"Compressed output already exists: {destination.name}")

    original = pydicom.dcmread(source)
    source_syntax = str(getattr(original.file_meta, "TransferSyntaxUID", "") or "")
    source_syntax_label = source_syntax or "<missing>"

    if "PixelData" not in original:
        raise ValueError(
            f"Source syntax {source_syntax_label}: file has no Pixel Data (7FE0,0010)"
        )
    if not original.PixelData:
        raise ValueError(
            f"Source syntax {source_syntax_label}: Pixel Data (7FE0,0010) is empty"
        )

    if source_syntax in LOSSLESS_TRANSFER_SYNTAXES:
        try:
            original_pixels = np.asarray(original.pixel_array).copy()
        except Exception as exc:
            raise ValueError(
                f"Source syntax {source_syntax}: lossless Pixel Data could not be decoded "
                f"({type(exc).__name__}: {exc})"
            ) from exc
        if original_pixels.size == 0:
            raise ValueError(
                f"Source syntax {source_syntax}: decoded Pixel Data is empty"
            )
        original_pixel_hash = hashlib.sha256(
            original_pixels.tobytes(order="C")
        ).hexdigest()

        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copyfile(source, destination)
            copied = pydicom.dcmread(destination)
            copied_pixels = np.asarray(copied.pixel_array)
            copied_pixel_hash = hashlib.sha256(
                copied_pixels.tobytes(order="C")
            ).hexdigest()
            if (
                original_pixels.dtype != copied_pixels.dtype
                or original_pixels.shape != copied_pixels.shape
                or original_pixel_hash != copied_pixel_hash
                or str(getattr(copied.file_meta, "TransferSyntaxUID", "")) != source_syntax
            ):
                raise ValueError(
                    f"Source syntax {source_syntax}: lossless pass-through pixel "
                    "verification failed"
                )
            return original_pixel_hash
        except Exception:
            destination.unlink(missing_ok=True)
            raise

    if source_syntax not in UNCOMPRESSED_TRANSFER_SYNTAXES:
        uid = UID(source_syntax) if source_syntax else UID("")
        if source_syntax and uid.is_compressed:
            raise ValueError(
                f"Source syntax {source_syntax}: lossy or unknown-compression transfer syntax "
                "is not accepted for lossless ingest"
            )
        raise ValueError(
            f"Source syntax {source_syntax_label}: unknown or unsupported transfer syntax"
        )

    original_pixels = np.asarray(original.pixel_array).copy()
    original_pixel_hash = hashlib.sha256(
        original_pixels.tobytes(order="C")
    ).hexdigest()

    encoded = copy.deepcopy(original)
    if (
        variant.uid == str(JPEG2000Lossless)
        and min(int(encoded.Rows), int(encoded.Columns)) < 32
    ):
        encode_small_jpeg2000(encoded, variant)
    else:
        encoded.compress(
            variant.uid,
            encoding_plugin=variant.plugin,
            generate_instance_uid=False,
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        encoded.save_as(destination, enforce_file_format=True)
        result = pydicom.dcmread(destination)
        decoded_pixels = np.asarray(result.pixel_array)
        decoded_pixel_hash = hashlib.sha256(
            decoded_pixels.tobytes(order="C")
        ).hexdigest()
        if (
            original_pixels.dtype != decoded_pixels.dtype
            or original_pixels.shape != decoded_pixels.shape
            or original_pixel_hash != decoded_pixel_hash
            or not metadata_preserved(original, result)
            or not result.file_meta
            or str(result.file_meta.TransferSyntaxUID) != variant.uid
        ):
            raise ValueError("Lossless DICOM compression verification failed")
        return original_pixel_hash
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark DICOM lossless compression and optional lossy experiments."
    )
    base_dir = Path(__file__).resolve().parent
    parser.add_argument("--samples", type=Path, default=base_dir / "samples")
    parser.add_argument("--output", type=Path, default=base_dir / "output")
    parser.add_argument(
        "--jpeg2000-lossy-ratios",
        metavar="R1,R2[,R3]",
        help="Opt in to JPEG 2000 lossy; specify 2 or 3 compression ratios greater than 1.",
    )
    parser.add_argument(
        "--jpeg-baseline-qualities",
        metavar="Q1,Q2[,Q3]",
        help="Opt in to JPEG Baseline lossy; specify 2 or 3 qualities from 1 to 100.",
    )
    parser.add_argument(
        "--decompress-first",
        action="store_true",
        help="Decode already-compressed inputs to Explicit VR Little Endian before lossless recompression.",
    )
    args = parser.parse_args()
    try:
        args.jpeg2000_lossy_ratios = parse_levels(
            args.jpeg2000_lossy_ratios, "JPEG 2000 ratios", 1.000001, 1000
        )
        args.jpeg_baseline_qualities = parse_levels(
            args.jpeg_baseline_qualities, "JPEG Baseline qualities", 1, 100
        )
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))
    if any(not quality.is_integer() for quality in args.jpeg_baseline_qualities):
        parser.error("JPEG Baseline qualities must be integers")
    return args


def paths_overlap(first: Path, second: Path) -> bool:
    return (
        first == second
        or first.is_relative_to(second)
        or second.is_relative_to(first)
    )


def main() -> int:
    args = parse_args()
    samples_dir = args.samples.resolve()
    output_dir = args.output.resolve()
    if not samples_dir.is_dir():
        print(f"Samples directory does not exist: {samples_dir}", file=sys.stderr)
        return 2
    if paths_overlap(samples_dir, output_dir):
        print(
            "Samples and output directories must be separate, non-overlapping paths.",
            file=sys.stderr,
        )
        return 2
    sources = sorted(
        (path for path in samples_dir.rglob("*") if path.is_file() and path.suffix.lower() == ".dcm"),
        key=lambda path: path.as_posix().lower(),
    )
    if not sources:
        print(f"No .dcm files found under {samples_dir}", file=sys.stderr)
        return 2

    output_dir.mkdir(parents=True, exist_ok=True)
    variants = variants_for(args)
    rows: list[dict[str, Any]] = []
    for source in sources:
        original_size = source.stat().st_size
        try:
            original = pydicom.dcmread(source)
            original_pixels = np.asarray(original.pixel_array).copy()
        except Exception as exc:
            print(
                f"{source.name}: skipped because it is not a readable DICOM file "
                f"({type(exc).__name__}: {exc})",
                file=sys.stderr,
            )
            continue

        input_transfer_syntax = str(
            getattr(original.file_meta, "TransferSyntaxUID", "")
        )
        uncompressed_size: int | str = ""

        if args.decompress_first:
            try:
                original, uncompressed = explicit_vr_little_endian(
                    original,
                    original_pixels,
                )
                uncompressed_size = len(uncompressed)
                original_pixels = np.asarray(original.pixel_array).copy()
            except Exception as exc:
                print(
                    f"{source.name}: skipped because it could not be converted "
                    f"to Explicit VR Little Endian ({type(exc).__name__}: {exc})",
                    file=sys.stderr,
                )
                continue

        original_pixel_bytes = pixel_data_payload_size(original)

        for variant in variants:
            rows.append(
                benchmark_variant(
                    source,
                    samples_dir,
                    output_dir,
                    variant,
                    original,
                    original_pixels,
                    original_pixel_bytes,
                    original_size,
                    input_transfer_syntax,
                    uncompressed_size,
                )
            )

    report = output_dir / "report.csv"
    with report.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    failed = sum(row["verified"] != "yes" for row in rows)
    print(f"Wrote {len(rows)} benchmark rows to {report}")
    print(f"Verified: {len(rows) - failed}; failed or unverified: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
