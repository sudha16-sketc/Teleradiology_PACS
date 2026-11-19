import 'reflect-metadata';
import { parseDicomBuffer, validateDicomIdentifiers } from '../src/dicom/dicom.parser.js';

function padEvenSpace(value: string): Buffer {
  const bytes = Buffer.from(value, 'latin1');
  if (bytes.length % 2 === 0) return bytes;
  return Buffer.concat([bytes, Buffer.from(' ')]);
}

function element(group: number, tag: number, vr: string, value: string): Buffer {
  const bytes = padEvenSpace(value);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(tag, 2);
  header.write(vr, 4, 2, 'latin1');
  header.writeUInt16LE(bytes.length, 6);
  return Buffer.concat([header, bytes]);
}

function paddedFixture(): Buffer {
  const transferSyntax = element(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
  const groupLength = Buffer.alloc(4);
  groupLength.writeUInt32LE(transferSyntax.length, 0);
  const groupLengthHeader = Buffer.alloc(8);
  groupLengthHeader.writeUInt16LE(0x0002, 0);
  groupLengthHeader.writeUInt16LE(0x0000, 2);
  groupLengthHeader.write('UL', 4, 2, 'latin1');
  groupLengthHeader.writeUInt16LE(4, 6);

  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM', 'latin1'),
    groupLengthHeader,
    groupLength,
    transferSyntax,
    element(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
    element(0x0008, 0x0018, 'UI', '1.2.3.4.5'),
    element(0x0008, 0x0020, 'DA', '20260101'),
    element(0x0008, 0x0030, 'TM', '120000'),
    element(0x0008, 0x0060, 'CS', 'CT'),
    element(0x0010, 0x0010, 'PN', 'Padded^Patient'),
    element(0x0010, 0x0020, 'LO', 'P-PADDED'),
    element(0x0020, 0x000d, 'UI', '1.2.3'),
    element(0x0020, 0x000e, 'UI', '1.2.3.4'),
    element(0x0020, 0x0011, 'IS', '1'),
    element(0x0020, 0x0013, 'IS', '1'),
  ]);
}

describe('DICOM UID parsing', () => {
  it('removes DICOM UI space padding from parsed identifiers', () => {
    const parsed = parseDicomBuffer(paddedFixture());

    expect(parsed.valid).toBe(true);
    expect(parsed.studyInstanceUid).toBe('1.2.3');
    expect(parsed.seriesInstanceUid).toBe('1.2.3.4');
    expect(parsed.sopInstanceUid).toBe('1.2.3.4.5');
    expect(parsed.sopClassUid).toBe('1.2.840.10008.5.1.4.1.1.2');
    expect(validateDicomIdentifiers(parsed, { unknownSyntaxOk: true })).toBeNull();
  });
});
