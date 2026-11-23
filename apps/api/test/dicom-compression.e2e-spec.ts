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

  it('warns on every ingest invocation when compression is disabled', () => {
    process.env.AXIS_DICOM_COMPRESSION_ENABLED = 'false';
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const service = new DicomService({} as never, {} as never, {} as never);

    service['warnCompressionDisabledOnIngest']();
    service['warnCompressionDisabledOnIngest']();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      'DICOM lossless compression is disabled for this non-production ingest',
    );
    warn.mockRestore();
  });
});

describe('Orthanc instance store timeout', () => {
  const environmentKeys = [
    'AXIS_ORTHANC_TIMEOUT_MS',
    'AXIS_ORTHANC_STORE_TIMEOUT_MS',
    'AXIS_DICOM_COMPRESSION_ENABLED',
    'ORTHANC_URL',
  ] as const;
  const originalEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of environmentKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it('allows a delayed /instances response beyond the general Orthanc timeout and logs its duration', async () => {
    process.env.AXIS_ORTHANC_TIMEOUT_MS = '5';
    process.env.AXIS_ORTHANC_STORE_TIMEOUT_MS = '1000';
    process.env.AXIS_DICOM_COMPRESSION_ENABLED = 'false';
    process.env.ORTHANC_URL = 'http://orthanc.test';

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        (_input, init) =>
          new Promise<Response>((resolve, reject) => {
            const signal = init?.signal;
            const timer = setTimeout(() => {
              signal?.removeEventListener('abort', onAbort);
              resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  Status: 'Success',
                  ID: 'orthanc-instance',
                  ParentSeries: 'orthanc-series',
                  ParentStudy: 'orthanc-study',
                  ParentPatient: 'orthanc-patient',
                }),
              } as Response);
            }, 25);
            const onAbort = () => {
              clearTimeout(timer);
              const error = new Error('Mock Orthanc response aborted');
              error.name = 'AbortError';
              reject(error);
            };
            signal?.addEventListener('abort', onAbort, { once: true });
          }),
      );
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const service = new DicomService({} as never, {} as never, {} as never);

    const stored = await service['storeRawInstance'](
      Buffer.from('synthetic-dicom'),
      {} as never,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://orthanc.test/instances',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(stored.orthancInstanceId).toBe('orthanc-instance');

    const timingCall = consoleLog.mock.calls.find(([line]) =>
      String(line).includes('"msg":"orthanc_instance_store"'),
    );
    expect(timingCall).toBeDefined();
    const timing = JSON.parse(String(timingCall?.[0])) as Record<string, unknown>;
    expect(timing).toMatchObject({
      route: '/instances',
      method: 'POST',
      timeoutMs: 1000,
      status: 200,
      outcome: 'response',
    });
    expect(timing.durationMs).toEqual(expect.any(Number));
    expect(timing.durationMs as number).toBeGreaterThanOrEqual(20);
  });
});
