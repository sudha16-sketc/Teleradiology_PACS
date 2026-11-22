import { classifySourceCompression } from '../src/dicom/dicom.constants.js';
import {
  DicomCompressionError,
  inferCompressionFailureStage,
  parseCompressionDiagnostic,
  parseCompressionResult,
  redactDiagnosticText,
} from '../src/dicom/dicom-compression.js';

describe('DICOM compression diagnostics', () => {
  it('parses only allowlisted diagnostic metadata', () => {
    const diagnostic = parseCompressionDiagnostic(
      [
        'Compression or verification failed: RuntimeError: codec unavailable',
        'AXIS_DICOM_DIAGNOSTIC={"stage":"encode_pixels","errorType":"RuntimeError","message":"codec unavailable","metadata":{"source_transfer_syntax":"1.2.840.10008.1.2.1","rows":64,"PatientName":"Sensitive^Name","PixelData":"00"}}',
      ].join('\n'),
    );

    expect(diagnostic?.stage).toBe('encode_pixels');
    expect(diagnostic?.errorType).toBe('RuntimeError');
    expect(diagnostic?.metadata).toEqual({
      source_transfer_syntax: '1.2.840.10008.1.2.1',
      rows: 64,
    });
  });

  it('parses structured provenance without accepting arbitrary metadata', () => {
    const result = parseCompressionResult(
      'AXIS_DICOM_RESULT={"pixel_hash":"' + 'a'.repeat(64) + '","provenance":{' +
        '"source_transfer_syntax":"1.2.840.10008.1.2.4.50",' +
        '"target_transfer_syntax":"1.2.840.10008.1.2.4.90",' +
        '"source_compression_type":"jpeg-baseline",' +
        '"prior_lossy_compression":true,' +
        '"lossy_image_compression":"01",' +
        '"lossy_method":"ISO_10918_1",' +
        '"lossy_ratio":"4.0",' +
        '"lossy_history_normalized":true,' +
        '"lossy_history_normalization_reason":"jpeg-baseline-transfer-syntax",' +
        '"reencode_policy_version":"jpeg-baseline-lossless-v1",' +
        '"source_pixel_sha256":"' + 'b'.repeat(64) + '",' +
        '"output_pixel_sha256":"' + 'b'.repeat(64) + '",' +
        '"pixel_verified":true,' +
        '"PatientName":"Sensitive^Name"}}',
    );

    expect(result?.pixelHash).toBe('a'.repeat(64));
    expect(result?.provenance).toEqual({
      sourceTransferSyntax: '1.2.840.10008.1.2.4.50',
      targetTransferSyntax: '1.2.840.10008.1.2.4.90',
      sourceCompressionType: 'jpeg-baseline',
      priorLossyCompression: true,
      lossyImageCompression: '01',
      lossyMethod: 'ISO_10918_1',
      lossyRatio: '4.0',
      lossyHistoryNormalized: true,
      lossyHistoryNormalizationReason: 'jpeg-baseline-transfer-syntax',
      reencodePolicyVersion: 'jpeg-baseline-lossless-v1',
      sourcePixelSha256: 'b'.repeat(64),
      outputPixelSha256: 'b'.repeat(64),
      pixelVerified: true,
    });
  });

  it('still accepts a legacy plain hash result line', () => {
    expect(parseCompressionResult('c'.repeat(64))?.pixelHash).toBe('c'.repeat(64));
  });

  it('classifies JPEG Baseline as the only supported lossy source', () => {
    expect(classifySourceCompression('1.2.840.10008.1.2.4.50')).toBe('jpeg-baseline');
    expect(classifySourceCompression('1.2.840.10008.1.2.4.51')).toBe('unsupported');
    expect(classifySourceCompression('1.2.840.10008.1.2.4.90')).toBe('lossless');
    expect(classifySourceCompression(undefined)).toBe('unsupported');
  });

  it('infers failing stages from worker errors', () => {
    expect(
      inferCompressionFailureStage(
        Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' }),
        '',
      ),
    ).toBe('python_executable_missing');
    expect(
      inferCompressionFailureStage(
        new Error('Command failed'),
        "Missing dependency: No module named 'numpy'",
      ),
    ).toBe('runtime_dependency');
    expect(
      inferCompressionFailureStage(
        new Error('Command failed'),
        'pixel data encoder is unavailable because all of its plugins are missing dependencies',
      ),
    ).toBe('codec_unavailable');
    expect(
      inferCompressionFailureStage(
        new Error('Command failed'),
        'Source syntax 1.2.840.10008.1.2.4.50: lossy or unknown-compression transfer syntax',
      ),
    ).toBe('source_transfer_syntax');
    expect(
      inferCompressionFailureStage(
        new Error('Command failed'),
        "LossyImageCompression must be '01'",
      ),
    ).toBe('validate_lossy_history');
    expect(
      inferCompressionFailureStage(
        new Error('Command failed'),
        'Uncompressed intermediate pixel verification failed',
      ),
    ).toBe('build_uncompressed_intermediate');
    expect(
      inferCompressionFailureStage(
        new Error('Command failed'),
        'Decoded output pixels are not exactly equal to decoded source pixels',
      ),
    ).toBe('verify_pixel_integrity');
    expect(
      inferCompressionFailureStage(
        new Error('Command failed'),
        'Lossless DICOM compression verification failed',
      ),
    ).toBe('pixel_verification');
  });

  it('uses an explicit unknown stage when no failure signal is available', () => {
    expect(inferCompressionFailureStage(new Error('opaque failure'), '')).toBe('unknown');
  });

  it('carries the resolved failure stage on compression errors', () => {
    const diagnostic = {
      stage: 'verify_pixel_integrity',
      errorType: 'LosslessCompressionError',
      metadata: {
        source_transfer_syntax: '1.2.840.10008.1.2.4.50',
        target_transfer_syntax: '1.2.840.10008.1.2.4.90',
      },
    };
    const error = new DicomCompressionError('pixel mismatch', diagnostic, diagnostic.stage);

    expect(error.failureStage).toBe('verify_pixel_integrity');
    expect(error.diagnostic?.metadata).toEqual(diagnostic.metadata);
    expect(new DicomCompressionError('opaque').failureStage).toBe('unknown');
  });

  it('redacts temporary paths from diagnostic text', () => {
    const redacted = redactDiagnosticText(
      'failed reading /tmp/axis-dicom-compress-abc123/source.dcm',
    );

    expect(redacted).toContain('<path>');
    expect(redacted).not.toContain('/tmp/axis-dicom-compress-abc123/source.dcm');
  });
});
