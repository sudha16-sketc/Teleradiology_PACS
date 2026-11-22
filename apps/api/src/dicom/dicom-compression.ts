import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { logger } from '../common/observability/structured-logger.js';

const execFileAsync = promisify(execFile);
const COMPRESSION_DIRECTORY = resolve(
  __dirname,
  '../../../../tools/dicom-compression-poc',
);
const COMPRESSION_SCRIPT = resolve(
  COMPRESSION_DIRECTORY,
  'compress_for_ingest.py',
);
const RUNTIME_SITE_PACKAGES = resolve(
  COMPRESSION_DIRECTORY,
  'runtime',
  'site-packages',
);
const DIAGNOSTIC_PREFIX = 'AXIS_DICOM_DIAGNOSTIC=';
const RESULT_PREFIX = 'AXIS_DICOM_RESULT=';
const SAFE_METADATA_KEYS = new Set([
  'source_transfer_syntax',
  'target_transfer_syntax',
  'rows',
  'columns',
  'samples_per_pixel',
  'bits_allocated',
  'bits_stored',
  'high_bit',
  'pixel_representation',
  'photometric_interpretation',
  'number_of_frames',
  'source_compression_type',
  'prior_lossy_compression',
  'lossy_image_compression',
  'lossy_method',
  'lossy_ratio',
  'lossy_history_normalized',
  'lossy_history_normalization_reason',
  'reencode_policy_version',
  'source_pixel_sha256',
  'output_pixel_sha256',
  'pixel_verified',
]);
const LOSSLESS_TRANSFER_SYNTAXES = new Set([
  '1.2.840.10008.1.2.4.90',
  '1.2.840.10008.1.2.4.80',
]);

type ExecFileFailure = Error & {
  code?: string | number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stderr?: string | Buffer;
};

export type CompressionDiagnostic = {
  stage?: string;
  errorType?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type DicomCompressionProvenance = {
  instanceKey?: string;
  sourceTransferSyntax?: string;
  targetTransferSyntax?: string;
  sourceCompressionType?: string;
  priorLossyCompression?: boolean;
  lossyImageCompression?: string;
  lossyMethod?: string;
  lossyRatio?: string;
  lossyHistoryNormalized?: boolean;
  lossyHistoryNormalizationReason?: string;
  reencodePolicyVersion?: string;
  sourcePixelSha256?: string;
  outputPixelSha256?: string;
  pixelVerified?: boolean;
};

export type DicomCompressionResult = {
  buffer: Buffer;
  pixelHash: string;
  provenance: DicomCompressionProvenance;
};

export class DicomCompressionError extends ServiceUnavailableException {
  constructor(
    message: string,
    readonly diagnostic?: CompressionDiagnostic,
    readonly failureStage = 'unknown',
  ) {
    super(message);
    this.name = 'DicomCompressionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

export function redactDiagnosticText(value: string): string {
  return value.replace(/(?:\/[^\s:]+|[A-Za-z]:\\[^\s:]+)/g, '<path>').slice(0, 800);
}

function safeDiagnosticMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (entry === null || typeof entry === 'number' || typeof entry === 'boolean') {
      result[key] = entry;
    } else if (typeof entry === 'string') {
      result[key] = entry.slice(0, 100);
    }
  }
  return result;
}

export function parseCompressionDiagnostic(stderr: string): CompressionDiagnostic | undefined {
  const lines = stderr.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith(DIAGNOSTIC_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(DIAGNOSTIC_PREFIX.length));
      if (!isRecord(parsed)) continue;
      return {
        stage: typeof parsed.stage === 'string' ? parsed.stage : undefined,
        errorType: typeof parsed.errorType === 'string' ? parsed.errorType : undefined,
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
        metadata: safeDiagnosticMetadata(parsed.metadata),
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

type StringProvenanceKey =
  | 'sourceTransferSyntax'
  | 'targetTransferSyntax'
  | 'sourceCompressionType'
  | 'lossyImageCompression'
  | 'lossyMethod'
  | 'lossyRatio'
  | 'lossyHistoryNormalizationReason'
  | 'reencodePolicyVersion'
  | 'sourcePixelSha256'
  | 'outputPixelSha256';

function safeProvenance(value: unknown): DicomCompressionProvenance {
  if (!isRecord(value)) return {};
  const provenance: DicomCompressionProvenance = {};
  const strings: Array<[StringProvenanceKey, string]> = [
    ['sourceTransferSyntax', 'source_transfer_syntax'],
    ['targetTransferSyntax', 'target_transfer_syntax'],
    ['sourceCompressionType', 'source_compression_type'],
    ['lossyImageCompression', 'lossy_image_compression'],
    ['lossyMethod', 'lossy_method'],
    ['lossyRatio', 'lossy_ratio'],
    ['lossyHistoryNormalizationReason', 'lossy_history_normalization_reason'],
    ['reencodePolicyVersion', 'reencode_policy_version'],
    ['sourcePixelSha256', 'source_pixel_sha256'],
    ['outputPixelSha256', 'output_pixel_sha256'],
  ];
  for (const [target, source] of strings) {
    const entry = value[source];
    if (typeof entry === 'string') {
      Object.assign(provenance, { [target]: entry.slice(0, 100) });
    }
  }
  for (const [target, source] of [
    ['priorLossyCompression', 'prior_lossy_compression'],
    ['lossyHistoryNormalized', 'lossy_history_normalized'],
    ['pixelVerified', 'pixel_verified'],
  ] as const) {
    const entry = value[source];
    if (typeof entry === 'boolean') {
      Object.assign(provenance, { [target]: entry });
    }
  }
  return provenance;
}

export function parseCompressionResult(stdout: string): Omit<DicomCompressionResult, 'buffer'> | undefined {
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line.startsWith(RESULT_PREFIX)) {
      try {
        const parsed: unknown = JSON.parse(line.slice(RESULT_PREFIX.length));
        if (!isRecord(parsed) || typeof parsed.pixel_hash !== 'string') continue;
        if (!/^[a-f0-9]{64}$/i.test(parsed.pixel_hash)) continue;
        return {
          pixelHash: parsed.pixel_hash,
          provenance: safeProvenance(parsed.provenance),
        };
      } catch {
        continue;
      }
    }
    if (/^[a-f0-9]{64}$/i.test(line)) {
      return { pixelHash: line.toLowerCase(), provenance: {} };
    }
  }
  return undefined;
}

export function inferCompressionFailureStage(error: unknown, stderr: string): string {
  const failure = error as ExecFileFailure;
  const message = `${failure?.message ?? ''} ${stderr}`;

  if (failure?.code === 'ENOENT') return 'python_executable_missing';
  if (failure?.code === 'EACCES' || failure?.code === 'EPERM') return 'file_access';
  if (message.includes('Missing dependency') || message.includes('Required Python packages')) {
    return 'runtime_dependency';
  }
  if (message.includes('plugins are missing dependencies') || message.includes('pixel data encoder')) {
    return 'codec_unavailable';
  }
  if (message.includes('no Pixel Data') || message.includes('Pixel Data (7FE0,0010) is empty')) {
    return 'source_pixel_data';
  }
  if (message.includes('LossyImageCompression') || message.includes('lossy method')) {
    return 'validate_lossy_history';
  }
  if (message.includes('JPEG Baseline requires') || message.includes('pixel metadata')) {
    return 'validate_source_pixels';
  }
  if (message.includes('Uncompressed intermediate')) return 'build_uncompressed_intermediate';
  if (message.includes('could not be decoded')) return 'decode_source_pixels';
  if (message.includes('pixels are not exactly equal')) return 'verify_pixel_integrity';
  if (message.includes('configured DICOM transfer syntax')) return 'configured_transfer_syntax';
  if (message.includes('transfer syntax')) return 'source_transfer_syntax';
  if (message.includes('verification failed')) return 'pixel_verification';
  return 'unknown';
}

function pythonExecutable(): string {
  if (process.env.AXIS_DICOM_PYTHON) return process.env.AXIS_DICOM_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function pythonExecutableSource(): 'env' | 'system' {
  return process.env.AXIS_DICOM_PYTHON ? 'env' : 'system';
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

export async function compressDicomBufferDetailed(input: Buffer): Promise<DicomCompressionResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'axis-dicom-compress-'));
  const inputPath = join(workDir, 'source.dcm');
  const outputPath = join(workDir, 'verified.dcm');
  let stage = 'initialization';
  let configuredTransferSyntax = '';

  try {
    stage = 'validate_worker';
    if (!existsSync(COMPRESSION_SCRIPT)) {
      throw new Error('DICOM compression worker script is missing');
    }
    stage = 'input_write';
    await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
    stage = 'validate_configuration';
    configuredTransferSyntax = transferSyntax();
    stage = 'python_worker';
    const { stdout } = await execFileAsync(
      pythonExecutable(),
      [
        COMPRESSION_SCRIPT,
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--transfer-syntax',
        configuredTransferSyntax,
      ],
      {
        timeout: 10 * 60 * 1000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: pythonEnvironment(),
      },
    );
    stage = 'parse_worker_result';
    const parsed = parseCompressionResult(outputText(stdout));
    if (!parsed) {
      throw new Error('DICOM compression worker did not return a valid result');
    }
    stage = 'read_output';
    const buffer = await readFile(outputPath);
    return { buffer, ...parsed };
  } catch (error: unknown) {
    const failure = error as ExecFileFailure;
    const stderr = outputText(failure?.stderr);
    const diagnostic = parseCompressionDiagnostic(stderr);
    const resolvedStage =
      diagnostic?.stage ??
      (stage === 'python_worker' ? inferCompressionFailureStage(error, stderr) : stage);

    logger.error('dicom_lossless_compression_failed', {
      stage: resolvedStage,
      errorType:
        diagnostic?.errorType ??
        (typeof failure?.code === 'string' ? failure.code : undefined) ??
        (error instanceof Error ? error.name : 'UnknownError'),
      message: redactDiagnosticText(
        diagnostic?.message ?? `Worker failed in stage ${resolvedStage}`,
      ),
      exitCode: typeof failure?.code === 'number' ? failure.code : undefined,
      errorCode: typeof failure?.code === 'string' ? failure.code : undefined,
      signal: failure?.signal ?? undefined,
      killed: failure?.killed ?? undefined,
      timedOut: failure?.killed === true && failure?.code == null ? true : undefined,
      python: pythonExecutableSource(),
      pythonPackages: existsSync(RUNTIME_SITE_PACKAGES) ? 'build' : 'missing',
      configuredTransferSyntax,
      inputBytes: input.length,
      metadata: diagnostic?.metadata ?? {},
    });

    const compressionError = new DicomCompressionError(
      'Lossless DICOM compression or pixel verification failed',
      diagnostic,
      resolvedStage,
    );
    (compressionError as Error & { cause?: unknown }).cause = error;
    throw compressionError;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function compressDicomBuffer(input: Buffer): Promise<Buffer> {
  return (await compressDicomBufferDetailed(input)).buffer;
}
