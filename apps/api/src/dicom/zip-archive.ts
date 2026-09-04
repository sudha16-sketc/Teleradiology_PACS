import { BadRequestException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DICOM_LIMITS, MAGIC } from './dicom.constants.js';

export interface ExtractedArchive {
  /** Temporary directory holding the extracted (numbered) files. */
  dir: string;
  /** Absolute paths of every extracted entry (regular files). */
  files: string[];
  /** Number of extracted regular files. */
  count: number;
  /** Total uncompressed size of all extracted files (bytes). */
  totalBytes: number;
  /** Removes the temporary directory. Must always be called. */
  cleanup(): Promise<void>;
}

function hasMagic(buffer: Buffer, magic: Buffer): boolean {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Normalises an archive entry path and rejects path-traversal ("Zip Slip")
 * attempts. Returns the relative entry name or throws.
 */
function validateEntryName(entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((p) => p.length > 0 && p !== '.');
  if (parts.some((p) => p === '..')) {
    throw new BadRequestException('Archive contains an unsafe path (Zip Slip attempt)');
  }
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/')) {
    throw new BadRequestException('Archive contains an absolute path (Zip Slip attempt)');
  }
  return parts.join('/');
}

function isDirectoryEntry(entry: AdmZip.IZipEntry): boolean {
  return !!entry.isDirectory || /\/$/.test(entry.entryName);
}

/**
 * Validates and safely extracts a ZIP archive of DICOM instances.
 *
 * Security protections applied:
 *  - Zip Slip / path-traversal rejection
 *  - maximum entry count
 *  - maximum per-file size
 *  - maximum total extracted size
 *  - nested-archive rejection
 *  - executable-file rejection
 *  - safe temporary extraction to a per-request directory (never the caller
 *    supplied entry path) with guaranteed cleanup
 */
export async function extractDicomArchive(uploadBuffer: Buffer): Promise<ExtractedArchive> {
  if (uploadBuffer.length < 4 || !hasMagic(uploadBuffer, MAGIC.ZIP)) {
    throw new BadRequestException('Uploaded file is not a valid ZIP archive');
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(uploadBuffer);
  } catch {
    throw new BadRequestException('Uploaded file is not a valid ZIP archive');
  }

  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new BadRequestException('Archive is empty');
  }
  if (entries.length > DICOM_LIMITS.MAX_ENTRY_COUNT) {
    throw new BadRequestException(
      `Archive contains too many entries (max ${DICOM_LIMITS.MAX_ENTRY_COUNT})`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'axis-dicom-'));
  const files: string[] = [];
  let totalBytes = 0;
  let fileIndex = 0;

  try {
    for (const entry of entries) {
      validateEntryName(entry.entryName);

      if (isDirectoryEntry(entry)) continue;

      let data: Buffer;
      try {
        data = entry.getData();
      } catch {
        throw new BadRequestException(
          `Archive entry could not be decompressed: ${entry.entryName}`,
        );
      }

      if (entry.header && typeof entry.header.size === 'number' && entry.header.size > DICOM_LIMITS.MAX_FILE_BYTES) {
        throw new BadRequestException(
          `Archive entry exceeds the per-file size limit: ${entry.entryName}`,
        );
      }
      if (data.length > DICOM_LIMITS.MAX_FILE_BYTES) {
        throw new BadRequestException(
          `Archive entry exceeds the per-file size limit: ${entry.entryName}`,
        );
      }

      if (data.length >= 2) {
        if (hasMagic(data, MAGIC.ZIP)) {
          throw new BadRequestException(
            'Nested archives are not supported',
          );
        }
        if (hasMagic(data, MAGIC.PE) || hasMagic(data, MAGIC.ELF)) {
          throw new BadRequestException(
            'Archive contains an executable file, which is not allowed',
          );
        }
      }

      totalBytes += data.length;
      if (totalBytes > DICOM_LIMITS.MAX_EXTRACTED_BYTES) {
        throw new BadRequestException(
          'Extracted DICOM archive exceeds the maximum allowed size',
        );
      }

      // Write under a generated, order-preserving name. Never reuse the
      // caller-supplied entry path, which prevents traversal on disk too.
      fileIndex += 1;
      const target = join(dir, `entry_${String(fileIndex).padStart(6, '0')}.bin`);
      await writeFile(target, data);
      files.push(target);
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  if (files.length === 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw new BadRequestException('No files found inside the archive');
  }

  return {
    dir,
    files,
    count: files.length,
    totalBytes,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
