import dicomParser from 'dicom-parser';
import {
  isValidDicomUid,
  TRANSFER_SYNTAXES,
  describeTransferSyntax,
} from './dicom.constants.js';

export interface ParsedDicom {
  valid: boolean;
  error?: string;
  transferSyntaxUid?: string;
  transferSyntaxName?: string;
  studyInstanceUid?: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  sopClassUid?: string;
  patientId?: string;
  patientName?: string;
  patientSex?: string;
  patientDob?: string;
  modality?: string;
  studyDate?: string;
  studyTime?: string;
  accessionNumber?: string;
  studyDescription?: string;
  seriesNumber?: number;
  instanceNumber?: number;
  seriesDescription?: string;
  bodyPart?: string;
  numberOfFrames?: number;
}

interface MetaHeader {
  transferSyntaxUid?: string;
  mediaSopClassUid?: string;
  mediaSopInstanceUid?: string;
}

// Tag constants (group, element) for the fields we extract.
const TAGS = {
  sopClassUid: 0x00080016,
  sopInstanceUid: 0x00080018,
  studyDate: 0x00080020,
  studyTime: 0x00080030,
  accessionNumber: 0x00080050,
  modality: 0x00080060,
  studyDescription: 0x00081030,
  seriesDescription: 0x0008103e,
  patientName: 0x00100010,
  patientId: 0x00100020,
  patientDob: 0x00100030,
  patientSex: 0x00100040,
  bodyPart: 0x00180015,
  studyInstanceUid: 0x0020000d,
  seriesInstanceUid: 0x0020000e,
  seriesNumber: 0x00200011,
  instanceNumber: 0x00200013,
  numberOfFrames: 0x00280008,
} as const;

function tagKey(group: number, element: number): string {
  return `x${group.toString(16).padStart(4, '0')}${element.toString(16).padStart(4, '0')}`;
}

/**
 * Parses the Part-10 DICOM meta header (group 0002), which is always encoded
 * using explicit VR little endian.
 */
function readMetaHeader(buffer: Buffer): MetaHeader | undefined {
  if (buffer.length < 132) return undefined;
  const magic = buffer.subarray(128, 132).toString('latin1');
  if (magic !== 'DICM') return undefined;

  const meta: MetaHeader = {};
  let off = 132;
  const end = buffer.length;

  while (off + 8 <= end) {
    const group = buffer.readUInt16LE(off);
    const elem = buffer.readUInt16LE(off + 2);
    const vr = buffer.subarray(off + 4, off + 6).toString('latin1');
    off += 6;

    let len: number;
    if (vr === 'OB' || vr === 'OW' || vr === 'OF' || vr === 'SQ' || vr === 'UT' || vr === 'UN') {
      len = buffer.readUInt32LE(off + 2);
      off += 6;
    } else {
      len = buffer.readUInt16LE(off);
      off += 2;
    }

    if (off + len > end) break;
    const value = buffer.subarray(off, off + len).toString('latin1').replace(/\u0000+$/, '');

    if (group === 0x0002) {
      if (elem === 0x0010) meta.transferSyntaxUid = value;
      else if (elem === 0x0002) meta.mediaSopClassUid = value;
      else if (elem === 0x0003) meta.mediaSopInstanceUid = value;
    }

    off += len;
    if (group !== 0x0002) break;
  }

  return meta;
}

function readString(dataSet: dicomParser.DataSet, tag: number): string | undefined {
  const el = dataSet.elements[tagKey((tag >> 16) & 0xffff, tag & 0xffff)];
  if (!el) return undefined;
  if (el.length == null || el.dataOffset == null) return undefined;
  const bytes = dataSet.byteArray.subarray(el.dataOffset, el.dataOffset + el.length);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  const trimmed = s.replace(/\u0000+$/g, '');
  return trimmed.length ? trimmed : undefined;
}

function readNumber(dataSet: dicomParser.DataSet, tag: number): number | undefined {
  const el = dataSet.elements[tagKey((tag >> 16) & 0xffff, tag & 0xffff)];
  if (!el || el.dataOffset == null) return undefined;
  const vr = (el.vr || '').toUpperCase();
  try {
    if (vr === 'US' || vr === 'SS') return dataSet.byteArrayParser.readUint16(dataSet.byteArray, el.dataOffset);
    if (vr === 'UL' || vr === 'SL') return dataSet.byteArrayParser.readUint32(dataSet.byteArray, el.dataOffset);
  } catch {
    /* fall through */
  }
  const str = readString(dataSet, tag);
  if (str == null) return undefined;
  const parsed = Number.parseInt(str.trim(), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Attempts to parse a raw (non Part-10) DICOM dataset (no preamble / "DICM"
 * marker). Used as a fallback for unusual but real transfers.
 */
function parseRawDataset(buffer: Buffer): { dataSet: dicomParser.DataSet; explicit: boolean } | null {
  try {
    const stream = new dicomParser.ByteStream(dicomParser.littleEndianByteArrayParser, buffer, 0);
    const ds = dicomParser.parseDicomDataSetExplicit(stream, { untilTag: 'x7fe00010' });
    if (Object.keys(ds.elements || {}).length > 0) return { dataSet: ds, explicit: true };
  } catch {
    /* try implicit next */
  }
  try {
    const stream = new dicomParser.ByteStream(dicomParser.littleEndianByteArrayParser, buffer, 0);
    const ds = dicomParser.parseDicomDataSetImplicit(stream, { untilTag: 'x7fe00010' });
    if (Object.keys(ds.elements || {}).length > 0) return { dataSet: ds, explicit: false };
  } catch {
    /* give up */
  }
  return null;
}

function extract(dataSet: dicomParser.DataSet): Omit<ParsedDicom, 'valid' | 'error'> {
  return {
    studyInstanceUid: readString(dataSet, TAGS.studyInstanceUid),
    seriesInstanceUid: readString(dataSet, TAGS.seriesInstanceUid),
    sopInstanceUid: readString(dataSet, TAGS.sopInstanceUid),
    sopClassUid: readString(dataSet, TAGS.sopClassUid),
    patientId: readString(dataSet, TAGS.patientId),
    patientName: readString(dataSet, TAGS.patientName),
    patientSex: readString(dataSet, TAGS.patientSex),
    patientDob: readString(dataSet, TAGS.patientDob),
    modality: readString(dataSet, TAGS.modality),
    studyDate: readString(dataSet, TAGS.studyDate),
    studyTime: readString(dataSet, TAGS.studyTime),
    accessionNumber: readString(dataSet, TAGS.accessionNumber),
    studyDescription: readString(dataSet, TAGS.studyDescription),
    seriesDescription: readString(dataSet, TAGS.seriesDescription),
    bodyPart: readString(dataSet, TAGS.bodyPart),
    seriesNumber: readNumber(dataSet, TAGS.seriesNumber),
    instanceNumber: readNumber(dataSet, TAGS.instanceNumber),
    numberOfFrames: readNumber(dataSet, TAGS.numberOfFrames),
  };
}

function buildResult(base: ParsedDicom, fields: Omit<ParsedDicom, 'valid' | 'error'>): ParsedDicom {
  return {
    ...base,
    ...fields,
  };
}

/**
 * Parses and validates a single DICOM file (Part-10 or raw). Returns a
 * ParsedDicom result; when `valid` is false the `error` field describes the
 * failure so the caller can surface a clear failure state.
 */
export function parseDicomBuffer(buffer: Buffer): ParsedDicom {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    return { valid: false, error: 'File is too small to be a DICOM file' };
  }

  // Reject obvious non-DICOM executables and archives at the boundary.
  if (buffer.length >= 2) {
    const b2 = buffer[0] === 0x4d && buffer[1] === 0x5a; // 'MZ' (PE)
    const b4 = buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46; // ELF
    const zip = buffer[0] === 0x50 && buffer[1] === 0x4b; // PK
    if (b2 || b4 || zip) {
      return { valid: false, error: 'File is not a DICOM object (executable or archive detected)' };
    }
  }

  const meta = readMetaHeader(buffer);

  // Part-10 file with preamble.
  if (meta) {
    if (meta.transferSyntaxUid && !isValidDicomUid(meta.transferSyntaxUid)) {
      return { valid: false, error: 'Invalid DICOM Transfer Syntax UID in meta header' };
    }

    let dataSet: dicomParser.DataSet;
    try {
      dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
    } catch (err) {
      return {
        valid: false,
        error: `Failed to parse DICOM dataset: ${(err as Error).message}`,
      };
    }

    const fields = extract(dataSet);
    const base: ParsedDicom = {
      valid: true,
      transferSyntaxUid: meta.transferSyntaxUid,
      transferSyntaxName: meta.transferSyntaxUid
        ? describeTransferSyntax(meta.transferSyntaxUid)
        : undefined,
    };

    // If the meta-header transfer syntax is absent, fall back to the dataset
    // encoding detection already performed by parseDicom (nothing to do here).
    return buildResult(base, fields);
  }

  // Raw dataset without a Part-10 header.
  const raw = parseRawDataset(buffer);
  if (!raw) {
    return { valid: false, error: 'Not a valid DICOM file (no Part-10 header and dataset parse failed)' };
  }

  const transferSyntaxUid = raw.explicit ? '1.2.840.10008.1.2.1' : '1.2.840.10008.1.2';
  const fields = extract(raw.dataSet);
  return buildResult(
    {
      valid: true,
      transferSyntaxUid,
      transferSyntaxName: describeTransferSyntax(transferSyntaxUid),
    },
    fields,
  );
}

/**
 * Validates that an instance carries the required DICOM identifiers and a
 * supported/enumerable transfer syntax. `unknownSyntaxOk` allows an unknown
 * (but valid) transfer syntax UID to pass when we cannot name it.
 */
export function validateDicomIdentifiers(
  parsed: ParsedDicom,
  options: { unknownSyntaxOk?: boolean } = {},
): string | null {
  if (!parsed.valid) return parsed.error ?? 'Invalid DICOM file';

  if (!parsed.transferSyntaxUid || !isValidDicomUid(parsed.transferSyntaxUid)) {
    return 'DICOM instance is missing a valid Transfer Syntax UID';
  }
  if (!options.unknownSyntaxOk && !TRANSFER_SYNTAXES[parsed.transferSyntaxUid]) {
    return `Unsupported transfer syntax: ${parsed.transferSyntaxUid}`;
  }

  if (!isValidDicomUid(parsed.studyInstanceUid)) {
    return 'DICOM instance is missing a valid Study Instance UID';
  }
  if (!isValidDicomUid(parsed.seriesInstanceUid)) {
    return 'DICOM instance is missing a valid Series Instance UID';
  }
  if (!isValidDicomUid(parsed.sopInstanceUid)) {
    return 'DICOM instance is missing a valid SOP Instance UID';
  }
  if (!isValidDicomUid(parsed.sopClassUid)) {
    return 'DICOM instance is missing a valid SOP Class UID';
  }

  return null;
}

export { TRANSFER_SYNTAXES, describeTransferSyntax };
