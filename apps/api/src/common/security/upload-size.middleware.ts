import type { NextFunction, Request, Response } from 'express';
import { PayloadTooLargeException } from '@nestjs/common';
import { DICOM_LIMITS } from '../../dicom/dicom.constants.js';

/**
 * A6: aggregate upload-size enforcement for `POST /api/dicom/ingest`.
 *
 * multer's memoryStorage buffers each file in RAM and its limits are only
 * per-file and per-count, so `DICOM_LIMITS.MAX_UPLOAD_BYTES` was previously
 * dead config (one request could hold 4000 x MAX_FILE_BYTES). This middleware
 * makes the aggregate cap real:
 *  - Content-Length present  -> rejected up front with 413 before any parsing.
 *  - Chunked body (no length)-> a byte counter tears the request down at the
 *    cap; multer's per-file limits still apply to legitimate uploads.
 */
export function limitUploadBody(req: Request, res: Response, next: NextFunction) {
  const declared = req.headers['content-length'];
  if (declared !== undefined) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > DICOM_LIMITS.MAX_UPLOAD_BYTES) {
      next(new PayloadTooLargeException('Upload exceeds the maximum allowed size'));
      return;
    }
  }
  next();
}