import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { StudyHistoryForm } from './dto/dicom-history.dto.js';

const execFileAsync = promisify(execFile);
const CONVERSION_DIRECTORY = resolve(__dirname, '../../../../tools/dicom-compression-poc');
const CONVERSION_SCRIPT = resolve(CONVERSION_DIRECTORY, 'convert_png_jpeg_to_dicom.py');
const RUNTIME_SITE_PACKAGES = resolve(CONVERSION_DIRECTORY, 'runtime', 'site-packages');
const ERROR_PREFIX = 'AXIS_IMAGE_CONVERSION_ERROR=';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const IMAGE_CONVERSION_LIMITS = {
  MAX_FILE_BYTES: envInt('AXIS_IMAGE_MAX_FILE_BYTES', 25 * 1024 * 1024),
  MAX_TOTAL_BYTES: envInt('AXIS_IMAGE_MAX_TOTAL_BYTES', 100 * 1024 * 1024),
  MAX_IMAGES: envInt('AXIS_IMAGE_MAX_IMAGES', 100),
  MAX_DIMENSION: envInt('AXIS_IMAGE_MAX_DIMENSION', 20000),
} as const;

function pythonExecutable(): string {
  if (process.env.AXIS_DICOM_PYTHON) return process.env.AXIS_DICOM_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function pythonEnvironment(): NodeJS.ProcessEnv {
  const existing = process.env.PYTHONPATH;
  const separator = process.platform === 'win32' ? ';' : ':';
  return {
    ...process.env,
    PYTHONPATH: existing
      ? `${RUNTIME_SITE_PACKAGES}${separator}${existing}`
      : RUNTIME_SITE_PACKAGES,
  };
}

function parseWorkerError(stderr: string): string {
  for (const line of stderr.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(ERROR_PREFIX)) continue;
    try {
      const parsed = JSON.parse(trimmed.slice(ERROR_PREFIX.length)) as { message?: unknown };
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      return 'The image could not be converted';
    }
  }
  return 'The image could not be converted';
}

export function hasImageSignature(buffer: Buffer): boolean {
  return (
    (buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
  );
}

export function hasImageExtension(name: string): boolean {
  return /\.(png|jpe?g)$/i.test(name);
}

export async function convertPngJpegFiles(
  files: Express.Multer.File[],
  hospitalId: string,
  history?: StudyHistoryForm,
): Promise<Buffer[]> {
  if (files.length > IMAGE_CONVERSION_LIMITS.MAX_IMAGES) {
    throw new BadRequestException('Too many images in the upload');
  }

  const workDir = await mkdtemp(join(tmpdir(), 'axis-image-dicom-'));
  const manifestPath = join(workDir, 'manifest.json');
  const metadataPath = join(workDir, 'metadata.json');
  const outputDir = join(workDir, 'output');
  try {
    if (!existsSync(CONVERSION_SCRIPT)) {
      throw new ServiceUnavailableException('The image conversion worker is unavailable');
    }

    const manifest: Array<{ name: string; path: string }> = [];
    let total = 0;
    for (const file of files) {
      if (!file.path) throw new BadRequestException('The image file could not be accessed');
      if (!hasImageExtension(file.originalname || file.filename || '')) {
        throw new BadRequestException('Unsupported image format');
      }
      if (file.size <= 0) throw new BadRequestException('The image file is empty');
      if (file.size > IMAGE_CONVERSION_LIMITS.MAX_FILE_BYTES) {
        throw new BadRequestException('An image exceeds the maximum file size');
      }
      total += file.size;
      if (total > IMAGE_CONVERSION_LIMITS.MAX_TOTAL_BYTES) {
        throw new BadRequestException('The combined image upload size exceeds the limit');
      }
      const buffer = await readFile(file.path);
      if (!hasImageSignature(buffer)) {
        throw new BadRequestException('The file signature does not match a PNG or JPEG image');
      }
      manifest.push({ name: file.originalname || file.filename || 'image', path: file.path });
    }

    await writeFile(
      manifestPath,
      JSON.stringify(manifest),
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      metadataPath,
      JSON.stringify({
        patientId: `AXS-IMAGE-${hospitalId}-${Date.now()}`,
        patientName: history?.patientName || 'Unknown Patient',
        patientAge: history?.patientAge,
        gender: history?.gender || 'U',
        referringPhysician: history?.referringPhysician || '',
        studyDescription: 'Secondary Capture',
        maxFileBytes: IMAGE_CONVERSION_LIMITS.MAX_FILE_BYTES,
        maxDimension: IMAGE_CONVERSION_LIMITS.MAX_DIMENSION,
        maxImages: IMAGE_CONVERSION_LIMITS.MAX_IMAGES,
        maxTotalBytes: IMAGE_CONVERSION_LIMITS.MAX_TOTAL_BYTES,
      }),
      { flag: 'wx', mode: 0o600 },
    );

    const { stdout } = await execFileAsync(
      pythonExecutable(),
      [
        CONVERSION_SCRIPT,
        '--manifest',
        manifestPath,
        '--output-dir',
        outputDir,
        '--metadata',
        metadataPath,
      ],
      {
        timeout: 10 * 60 * 1000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: pythonEnvironment(),
      },
    );

    if (!stdout.includes('AXIS_IMAGE_CONVERSION_RESULT=')) {
      throw new BadRequestException('The image conversion worker did not return a valid result');
    }
    const entries = await import('node:fs/promises').then((fs) => fs.readdir(outputDir));
    const buffers: Buffer[] = [];
    for (const entry of entries.sort()) {
      if (!entry.toLowerCase().endsWith('.dcm')) continue;
      buffers.push(await readFile(join(outputDir, entry)));
    }
    if (buffers.length !== files.length) {
      throw new BadRequestException('One or more images could not be converted');
    }
    return buffers;
  } catch (error: unknown) {
    if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
      throw error;
    }
    const execError = error as Error & { stderr?: string | Buffer };
    const stderr = typeof execError.stderr === 'string'
      ? execError.stderr
      : Buffer.isBuffer(execError.stderr)
        ? execError.stderr.toString('utf8')
        : '';
    throw new BadRequestException(parseWorkerError(stderr));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
