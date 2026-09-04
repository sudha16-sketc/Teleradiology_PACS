function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DICOM_LIMITS = {
  // Maximum size of the uploaded archive (bytes).
  MAX_UPLOAD_BYTES: envInt('AXIS_DICOM_MAX_UPLOAD_BYTES', 200 * 1024 * 1024),
  // Maximum number of entries allowed in a ZIP archive.
  MAX_ENTRY_COUNT: envInt('AXIS_DICOM_MAX_ENTRY_COUNT', 4000),
  // Maximum total (uncompressed) extracted size across all DICOM entries (bytes).
  MAX_EXTRACTED_BYTES: envInt('AXIS_DICOM_MAX_EXTRACTED_BYTES', 200 * 1024 * 1024),
  // Maximum size of a single DICOM instance (bytes).
  MAX_FILE_BYTES: envInt('AXIS_DICOM_MAX_FILE_BYTES', 200 * 1024 * 1024),
  // Maximum number of DICOM instances per upload.
  MAX_INSTANCES: envInt('AXIS_DICOM_MAX_INSTANCES', 4000),
} as const;

// DICOM UID format: numeric components of 1-64 digits separated by dots,
// first component 1-2 digits (per DICOM PS3.5). The first component must
// be non-zero.
const UID_REGEX = /^[0-9]+(\.[0-9]+)+$/;

export function isValidDicomUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  const trimmed = uid.trim();
  if (trimmed.length < 1 || trimmed.length > 64) return false;
  if (!UID_REGEX.test(trimmed)) return false;
  const first = trimmed.split('.')[0];
  if (first === '0') return false;
  // Per standard, the first component should be at least one digit; many
  // vendors use roots like "1.2.840..." so require numeric components.
  return true;
}

// Well-known DICOM Transfer Syntax UIDs (DICOM PS3.5 Table A-1).
// `kind` describes the encoding so the parser can handle it correctly.
export const TRANSFER_SYNTAXES: Record<string, { name: string; implicit: boolean; bigEndian: boolean }> = {
  '1.2.840.10008.1.2': { name: 'Implicit VR Little Endian', implicit: true, bigEndian: false },
  '1.2.840.10008.1.2.1': { name: 'Explicit VR Little Endian', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.1.99': { name: 'Deflated Explicit VR Little Endian', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.2': { name: 'Explicit VR Big Endian', implicit: false, bigEndian: true },
  '1.2.840.10008.1.2.4.50': { name: 'JPEG Baseline (Process 1)', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.51': { name: 'JPEG Extended (Process 2 & 4)', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.53': { name: 'JPEG Spectral Selection (Process 6 & 8)', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.55': { name: 'JPEG Full Progression (Process 10 & 12)', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.57': { name: 'JPEG Lossless (Process 14)', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.70': { name: 'JPEG Lossless (Process 14, SV1)', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.80': { name: 'JPEG-LS Lossless', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.81': { name: 'JPEG-LS Lossy (Near-Lossless)', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.90': { name: 'JPEG 2000 Lossless Only', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.91': { name: 'JPEG 2000', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.92': { name: 'JPEG 2000 Part 2 Multi-component Lossless', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.93': { name: 'JPEG 2000 Part 2 Multi-component', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.100': { name: 'MPEG2 Main Profile / Main Level', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.101': { name: 'MPEG2 Main Profile / High Level', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.102': { name: 'MPEG-4 AVC/H.264 High Profile / Level 4.1', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.103': { name: 'MPEG-4 AVC/H.264 BD-compatible High Profile / Level 4.1', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.201': { name: 'HEVC/H.265 Main Profile / Level 5.1', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.4.202': { name: 'HEVC/H.265 Main 10 Profile / Level 5.1', implicit: false, bigEndian: false },
  '1.2.840.10008.1.2.5': { name: 'RLE Lossless', implicit: false, bigEndian: false },
};

export function describeTransferSyntax(uid: string): string {
  return TRANSFER_SYNTAXES[uid]?.name ?? 'Unknown/private';
}

// File magic bytes used to detect nests / executables.
export const MAGIC = {
  ZIP: Buffer.from([0x50, 0x4b]),
  PE: Buffer.from([0x4d, 0x5a]), // 'MZ'
  ELF: Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
};
