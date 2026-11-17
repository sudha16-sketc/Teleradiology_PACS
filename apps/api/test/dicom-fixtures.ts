/**
 * Deterministic Part-10 DICOM fixture shared by the e2e suites.
 *
 * The suites must not depend on a sample instance that is not in the
 * repository, so a valid Part-10 file is generated instead. A real
 * de-identified instance is used when one happens to be present, but its
 * absence is never a test failure.
 */
import { existsSync, readFileSync } from 'fs';

export const FIXTURE_STUDY_UID = '1.2.826.0.1.3680043.2.1143.3365540476747857567072393009509418480';
export const FIXTURE_SERIES_UID = '1.2.826.0.1.3680043.2.1143.3712364435022872412969836992152438492';
export const FIXTURE_SOP_UID = '1.2.826.0.1.3680043.2.1143.6455556726214900995651753669640998622';

const REAL_DICOM = '/tmp/opencode/emri_small.dcm';

function el(group: number, elem: number, vr: string, value: string): Buffer {
  const v = Buffer.from(value.length % 2 ? `${value}\u0000` : value, 'latin1');
  const head = Buffer.from([group & 255, (group >> 8) & 255, elem & 255, (elem >> 8) & 255]);
  const vrB = Buffer.from(vr, 'ascii');
  let tail: Buffer;
  if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(v.length, 0);
    tail = Buffer.concat([vrB, Buffer.alloc(2), len]);
  } else {
    const len = Buffer.alloc(2);
    len.writeUInt16LE(v.length, 0);
    tail = Buffer.concat([vrB, len]);
  }
  return Buffer.concat([head, tail, v]);
}

/** A complete Part-10 instance carrying the fixture UIDs. */
function buildFixture(): Buffer {
  const parts: Buffer[] = [Buffer.alloc(128), Buffer.from('DICM')];
  const meta: Array<[number, number, string, string]> = [
    [0x0002, 0x0001, 'OB', '\x00\x01'],
    [0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'],
    [0x0002, 0x0003, 'UI', FIXTURE_SOP_UID],
    [0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'],
  ];
  for (const m of meta) parts.push(el(m[0], m[1], m[2], m[3]));
  parts.push(el(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'));
  parts.push(el(0x0008, 0x0018, 'UI', FIXTURE_SOP_UID));
  parts.push(el(0x0008, 0x0020, 'DA', '20240101'));
  parts.push(el(0x0008, 0x0030, 'TM', '101500'));
  parts.push(el(0x0008, 0x0060, 'CS', 'MR'));
  parts.push(el(0x0008, 0x1030, 'LO', 'BRAIN MRI'));
  parts.push(el(0x0008, 0x103e, 'LO', 'AX T2 FLAIR'));
  parts.push(el(0x0010, 0x0010, 'PN', 'E2E^EMRI'));
  parts.push(el(0x0010, 0x0020, 'LO', 'E2E-EMRI-0001'));
  parts.push(el(0x0010, 0x0040, 'CS', 'O'));
  parts.push(el(0x0018, 0x0015, 'CS', 'BRAIN'));
  parts.push(el(0x0020, 0x000d, 'UI', FIXTURE_STUDY_UID));
  parts.push(el(0x0020, 0x000e, 'UI', FIXTURE_SERIES_UID));
  parts.push(el(0x0020, 0x0011, 'US', '1'));
  parts.push(el(0x0020, 0x0013, 'IS', '1'));
  parts.push(el(0x0028, 0x0008, 'IS', '1'));
  return Buffer.concat(parts);
}

/**
 * Returns a DICOM instance for the full ingest path: the real de-identified
 * file when available, otherwise the generated fixture with the same UIDs.
 */
export function loadIngestFixture(): { buffer: Buffer; source: 'real' | 'generated' } {
  try {
    if (existsSync(REAL_DICOM)) {
      return { buffer: readFileSync(REAL_DICOM), source: 'real' };
    }
  } catch {
    /* fall through to the generated fixture */
  }
  return { buffer: buildFixture(), source: 'generated' };
}
