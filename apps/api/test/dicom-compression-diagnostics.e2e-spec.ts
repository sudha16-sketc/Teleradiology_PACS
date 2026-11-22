import {
  inferCompressionFailureStage,
  parseCompressionDiagnostic,
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
        'Lossless DICOM compression verification failed',
      ),
    ).toBe('pixel_verification');
  });

  it('redacts temporary paths from diagnostic text', () => {
    const redacted = redactDiagnosticText(
      'failed reading /tmp/axis-dicom-compress-abc123/source.dcm',
    );

    expect(redacted).toContain('<path>');
    expect(redacted).not.toContain('/tmp/axis-dicom-compress-abc123/source.dcm');
  });
});
