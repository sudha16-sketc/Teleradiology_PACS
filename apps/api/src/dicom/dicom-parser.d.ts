// Ambient type declarations for the `dicom-parser` library (no bundled types).
// Only the surface used by the Axis DICOM ingestion path is declared.
declare module 'dicom-parser' {
  export interface DICOMElement {
    tag: string;
    vr: string;
    length: number;
    dataOffset?: number;
    items?: unknown[];
  }

  export interface DataSet {
    elements: Record<string, DICOMElement>;
    byteArray: Uint8Array;
    byteArrayParser: ByteArrayParser;
  }

  export interface ByteArrayParser {
    readUint16(byteArray: Uint8Array, position: number): number;
    readInt16(byteArray: Uint8Array, position: number): number;
    readUint32(byteArray: Uint8Array, position: number): number;
    readFixedString(byteArray: Uint8Array, position: number, length: number): string;
  }

  export interface ByteStream {
    position: number;
    byteArray: Uint8Array;
    byteArrayParser: ByteArrayParser;
    readUint16(): number;
    readUint32(): number;
    readFixedString(length: number): string;
  }

  export const littleEndianByteArrayParser: ByteArrayParser;
  export const bigEndianByteArrayParser: ByteArrayParser;

  export function parseDicom(dataByteArray: Uint8Array, options?: object): DataSet;
  export function parseDicomDataSetExplicit(byteStream: ByteStream, options?: object): DataSet;
  export function parseDicomDataSetImplicit(byteStream: ByteStream, options?: object): DataSet;

  export function explicitElementToString(dataSet: DataSet, tag: number): string;

  export class ByteStream {
    constructor(byteArrayParser: ByteArrayParser, byteArray: Uint8Array, position?: number);
  }
}
