export const REAL_DICOM_FIXTURE = {
  studyInstanceUid: '1.2.826.0.1.3680043.2.1143.3365540476747857567072393009509418480',
  seriesInstanceUid: '1.2.826.0.1.3680043.2.1143.3712364435022872412969836992152438492',
  sopInstanceUid: '1.2.826.0.1.3680043.2.1143.6455556726214900995651753669640998622',
} as const;

function element(group: number, elem: number, vr: string, value: string): Buffer {
  const v = Buffer.from(value.length % 2 ? `${value}\u0000` : value, 'latin1');
  const head = Buffer.from([
    group & 255,
    (group >> 8) & 255,
    elem & 255,
    (elem >> 8) & 255,
  ]);
  const vrBytes = Buffer.from(vr, 'ascii');
  let tail: Buffer;
  if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(v.length, 0);
    tail = Buffer.concat([vrBytes, Buffer.alloc(2), len]);
  } else {
    const len = Buffer.alloc(2);
    len.writeUInt16LE(v.length, 0);
    tail = Buffer.concat([vrBytes, len]);
  }
  return Buffer.concat([head, tail, v]);
}

export function buildP10Dicom(
  opts: {
    study?: boolean;
    series?: boolean;
    sop?: boolean;
    sopClass?: boolean;
    studyUid?: string;
    seriesUid?: string;
    sopUid?: string;
    modality?: string;
  } = {},
): Buffer {
  const all = { study: true, series: true, sop: true, sopClass: true, ...opts };
  const studyUid = opts.studyUid ?? REAL_DICOM_FIXTURE.studyInstanceUid;
  const seriesUid = opts.seriesUid ?? REAL_DICOM_FIXTURE.seriesInstanceUid;
  const sopUid = opts.sopUid ?? REAL_DICOM_FIXTURE.sopInstanceUid;
  const parts: Buffer[] = [Buffer.alloc(128), Buffer.from('DICM')];
  const meta: Array<[number, number, string, string]> = [
    [0x0002, 0x0001, 'OB', '\u0000\u0001'],
    [0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'],
    [0x0002, 0x0003, 'UI', sopUid],
    [0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'],
  ];
  for (const m of meta) {
    parts.push(element(m[0], m[1], m[2], m[3]));
  }
  if (all.sopClass) {
    parts.push(element(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'));
  }
  if (all.sop) parts.push(element(0x0008, 0x0018, 'UI', sopUid));
  parts.push(element(0x0008, 0x0060, 'CS', opts.modality ?? 'MR'));
  if (all.study) parts.push(element(0x0020, 0x000d, 'UI', studyUid));
  if (all.series) parts.push(element(0x0020, 0x000e, 'UI', seriesUid));
  parts.push(element(0x0028, 0x0002, 'US', '\u0001\u0000'));
  parts.push(element(0x0028, 0x0004, 'CS', 'MONOCHROME2'));
  parts.push(element(0x0028, 0x0010, 'US', '\u0008\u0000'));
  parts.push(element(0x0028, 0x0011, 'US', '\u0008\u0000'));
  parts.push(element(0x0028, 0x0100, 'US', '\u0008\u0000'));
  parts.push(element(0x0028, 0x0101, 'US', '\u0008\u0000'));
  parts.push(element(0x0028, 0x0102, 'US', '\u0007\u0000'));
  parts.push(element(0x0028, 0x0103, 'US', '\u0000\u0000'));
  parts.push(element(0x7fe0, 0x0010, 'OW', '\u0000'.repeat(64)));
  return Buffer.concat(parts);
}

export function realDicomFixture(): Buffer {
  return buildP10Dicom();
}
