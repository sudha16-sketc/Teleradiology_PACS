import 'reflect-metadata';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  compressDicomBuffer,
  dicomCompressionEnabled,
} from '../src/dicom/dicom-compression.js';
import { DicomService } from '../src/dicom/dicom.service.js';

describe('DICOM compression feature flag', () => {
  const originalFlag = process.env.AXIS_DICOM_COMPRESSION_ENABLED;
  const originalPython = process.env.AXIS_DICOM_PYTHON;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AXIS_DICOM_COMPRESSION_ENABLED;
    else process.env.AXIS_DICOM_COMPRESSION_ENABLED = originalFlag;
    if (originalPython === undefined) delete process.env.AXIS_DICOM_PYTHON;
    else process.env.AXIS_DICOM_PYTHON = originalPython;
  });

  it('defaults to enabled', () => {
    delete process.env.AXIS_DICOM_COMPRESSION_ENABLED;
    expect(dicomCompressionEnabled()).toBe(true);
  });

  it('accepts false values and pass-throughs the original buffer unchanged', async () => {
    process.env.AXIS_DICOM_COMPRESSION_ENABLED = 'false';
    const input = Buffer.from('synthetic-dicom');
    const output = await compressDicomBuffer(input);
    expect(output).toBe(input);
  });

  it('runs compression when enabled', async () => {
    process.env.AXIS_DICOM_COMPRESSION_ENABLED = 'true';
    process.env.AXIS_DICOM_PYTHON =
      'C:\\Users\\Admin\\AppData\\Local\\Python\\pythoncore-3.12-64\\missing-python.exe';

    await expect(
      compressDicomBuffer(Buffer.from('synthetic-dicom')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('logs once at startup when compression is disabled', () => {
    process.env.AXIS_DICOM_COMPRESSION_ENABLED = 'false';
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const service = new DicomService({} as never, {} as never, {} as never);

    service.onModuleInit();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('DICOM lossless compression is disabled'),
    );
    log.mockRestore();
  });
});
