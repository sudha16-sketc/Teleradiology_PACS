import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';

const execFileAsync = promisify(execFile);
const COMPRESSION_DIRECTORY = resolve(
  __dirname,
  '../../../../tools/dicom-compression-poc',
);
const COMPRESSION_SCRIPT = resolve(
  COMPRESSION_DIRECTORY,
  'compress_for_ingest.py',
);
const LOSSLESS_TRANSFER_SYNTAXES = new Set([
  '1.2.840.10008.1.2.4.90',
  '1.2.840.10008.1.2.4.80',
]);

export function dicomCompressionEnabled(): boolean {
  const configured = process.env.AXIS_DICOM_COMPRESSION_ENABLED;
  if (configured === undefined) return true;
  return !['0', 'false', 'no', 'off'].includes(configured.trim().toLowerCase());
}

function pythonExecutable(): string {
  if (process.env.AXIS_DICOM_PYTHON) return process.env.AXIS_DICOM_PYTHON;
  const venvExecutable = join(
    COMPRESSION_DIRECTORY,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  if (existsSync(venvExecutable)) return venvExecutable;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function transferSyntax(): string {
  const configured =
    process.env.AXIS_DICOM_LOSSLESS_TRANSFER_SYNTAX || '1.2.840.10008.1.2.4.90';
  if (!LOSSLESS_TRANSFER_SYNTAXES.has(configured)) {
    throw new ServiceUnavailableException(
      'The configured DICOM transfer syntax is not an allowed lossless format',
    );
  }
  return configured;
}

export async function compressDicomBuffer(input: Buffer): Promise<Buffer> {
  if (!dicomCompressionEnabled()) return input;

  const workDir = await mkdtemp(join(tmpdir(), 'axis-dicom-compress-'));
  const inputPath = join(workDir, 'source.dcm');
  const outputPath = join(workDir, 'verified.dcm');

  try {
    await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
    await execFileAsync(
      pythonExecutable(),
      [
        COMPRESSION_SCRIPT,
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--transfer-syntax',
        transferSyntax(),
      ],
      { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    return await readFile(outputPath);
  } catch (error: unknown) {
    throw new ServiceUnavailableException(
      'Lossless DICOM compression or pixel verification failed',
      { cause: error },
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
