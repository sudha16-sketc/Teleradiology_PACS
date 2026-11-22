import 'reflect-metadata';
import { PassThrough } from 'node:stream';
import type { NextFunction, Request, Response } from 'express';
import { PayloadTooLargeException } from '@nestjs/common';
import { limitUploadBody } from '../src/common/security/upload-size.middleware.js';

function invoke(
  request: PassThrough,
  headers: Record<string, string>,
): { next: jest.Mock } {
  Object.assign(request, { headers });
  const next = jest.fn();
  limitUploadBody(
    request as unknown as Request,
    {} as Response,
    next as unknown as NextFunction,
  );
  return { next };
}

describe('aggregate DICOM upload byte limit', () => {
  it('rejects an oversized Content-Length before parsing', () => {
    const request = new PassThrough();
    const { next } = invoke(request, {
      'content-length': String(2 * 1024 * 1024),
    });

    expect(next).toHaveBeenCalledWith(expect.any(PayloadTooLargeException));
    expect(request.destroyed).toBe(false);
  });

  it('rejects a chunked request after its byte counter exceeds the limit', () => {
    const request = new PassThrough();
    const { next } = invoke(request, {});

    request.write(Buffer.alloc(700 * 1024));
    request.write(Buffer.alloc(700 * 1024));

    expect(next).toHaveBeenCalledWith(expect.any(PayloadTooLargeException));
    expect(request.destroyed).toBe(true);
  });

  it('allows an in-limit chunked request', () => {
    const request = new PassThrough();
    const { next } = invoke(request, {});

    request.write(Buffer.alloc(512));
    request.end();

    expect(next).toHaveBeenCalledWith();
    expect(next).not.toHaveBeenCalledWith(expect.any(PayloadTooLargeException));
  });
});
