import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import {
  DicomController,
  cleanupUploadDirectory,
} from '../src/dicom/dicom.controller.js';

type CleanupRequest = Request & { axisUploadDir?: string };

describe('DICOM upload directory cleanup', () => {
  it('cleanup failure is logged and does not replace an ingest success', async () => {
    const request = {
      axisUploadDir: 'C:\\temp\\axis-upload-synthetic',
    } as CleanupRequest;
    const warn = jest.fn();
    const removeDirectory = jest.fn().mockRejectedValue(new Error('synthetic cleanup failure'));

    await expect(
      cleanupUploadDirectory(request, removeDirectory as never, {
        warn,
      }),
    ).resolves.toBeUndefined();

    expect(request.axisUploadDir).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'DICOM upload staging directory cleanup failed',
    );
    warn.mockRestore();
  });

  it('cleanup failure does not replace the original ingest error', async () => {
    const originalError = new Error('original ingest failure');
    const dicomService = {
      ingestDicom: jest.fn().mockRejectedValue(originalError),
    };
    const controller = new DicomController(dicomService as never);
    const request = {
      axisUploadDir: 'C:\\temp\\axis-upload-synthetic',
    } as CleanupRequest;
    const file = {
      originalname: 'synthetic.dcm',
    } as Express.Multer.File;
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const removal = jest
      .spyOn(require('fs/promises'), 'rm')
      .mockRejectedValue(new Error('synthetic cleanup failure'));

    await expect(
      controller.ingest([file], { id: 'synthetic', role: 'HOSPITAL' } as never, request),
    ).rejects.toBe(originalError);

    expect(warn).toHaveBeenCalled();
    removal.mockRestore();
    warn.mockRestore();
  });

  it('reingest cleanup is also best-effort', async () => {
    const dicomService = {
      reingestDicom: jest.fn().mockResolvedValue({ storedCount: 0 }),
    };
    const controller = new DicomController(dicomService as never);
    const request = {
      axisUploadDir: 'C:\\temp\\axis-upload-synthetic',
    } as CleanupRequest;
    const file = {
      originalname: 'synthetic.dcm',
    } as Express.Multer.File;
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const removal = jest
      .spyOn(require('fs/promises'), 'rm')
      .mockRejectedValue(new Error('synthetic cleanup failure'));

    await expect(
      controller.reingest(
        [file],
        '1.2.3',
        { id: 'synthetic', role: 'HOSPITAL' } as never,
        request,
      ),
    ).resolves.toEqual({ data: { storedCount: 0 } });

    expect(warn).toHaveBeenCalled();
    removal.mockRestore();
    warn.mockRestore();
  });
});
