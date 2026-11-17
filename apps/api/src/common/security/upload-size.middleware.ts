import type { NextFunction, Request, Response } from 'express';
import { PayloadTooLargeException } from '@nestjs/common';
import { DICOM_LIMITS } from '../../dicom/dicom.constants.js';

/**
 * A6: aggregate upload-size enforcement for `POST /api/dicom/ingest`.
 *
 * multer's limits are only per-file and per-count, so `MAX_UPLOAD_BYTES` would
 * otherwise be dead config (a single request could still hold
 * MAX_INSTANCES x MAX_FILE_BYTES). Enforcement is deliberately split in two:
 *
 *  - Here: a cheap up-front rejection when the transport declares a
 *    Content-Length over the cap, before a single body byte is parsed.
 *  - In `uploadDiskStorage()` (dicom.controller.ts): the authoritative check
 *    against *actually received* bytes, so a chunked request — or one whose
 *    Content-Length is absent or understates the body — cannot bypass the cap.
 *
 * The Content-Length check alone is an optimization, never the guarantee.
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
