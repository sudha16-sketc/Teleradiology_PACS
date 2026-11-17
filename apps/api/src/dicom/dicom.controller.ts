import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  PayloadTooLargeException,
  Req,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { Transform } from 'node:stream';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import { DicomService, type IngestUser } from './dicom.service.js';
import { DICOM_LIMITS } from './dicom.constants.js';
import type { Request } from 'express';

type UploadRequest = Request & { axisUploadDir?: string };

/**
 * Writes each multipart file to a fresh per-request temp directory instead of
 * buffering it in RAM (multer memoryStorage). This is what makes large studies
 * (up to the 1 GiB per-file limit) uploadable without holding the entire
 * request in heap: the bytes stream to disk and the service reads files back
 * one at a time from `file.path`. The temp directory is created lazily and is
 * always removed by `ingest()` in finally, including on Multer/validation
 * errors (a request-level safety net sweeps it even if the handler never runs).
 */
type CountingUploadRequest = UploadRequest & { axisUploadBytes?: number };

/**
 * Wraps a multer storage engine so the aggregate upload cap is enforced against
 * the bytes actually received.
 *
 * multer's `limits` are per-file and per-count only, and `Content-Length` is
 * absent on a chunked request, so a Content-Length check alone lets a caller
 * stream an unbounded body. Every file stream is replaced by a counting
 * transform that tallies bytes across the whole request; the first byte past
 * `DICOM_LIMITS.MAX_UPLOAD_BYTES` fails the stream, which multer surfaces as
 * the error for the request.
 */
function aggregateLimitedStorage(inner: multer.StorageEngine): multer.StorageEngine {
  // Reuse multer's own parameter types so the wrapper stays assignable to
  // StorageEngine without restating the Express request shape.
  type HandleFile = Parameters<multer.StorageEngine['_handleFile']>;
  type RemoveFile = Parameters<multer.StorageEngine['_removeFile']>;

  return {
    _handleFile(...args: HandleFile) {
      const [req, file, cb] = args;
      const request = req as CountingUploadRequest;
      const original = file.stream;

      const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          const received = (request.axisUploadBytes ?? 0) + chunk.length;
          request.axisUploadBytes = received;
          if (received > DICOM_LIMITS.MAX_UPLOAD_BYTES) {
            done(
              new PayloadTooLargeException(
                'Upload exceeds the maximum allowed size',
              ),
            );
            return;
          }
          done(null, chunk);
        },
      });

      original.on('error', (err) => counter.destroy(err as Error));
      original.pipe(counter);

      // multer reads the file body from `file.stream`, so the guarded stream is
      // what the storage engine must write to disk.
      Object.defineProperty(file, 'stream', {
        configurable: true,
        enumerable: false,
        value: counter,
      });

      inner._handleFile(req, file, (err, info) => {
        if (err) {
          // multer will not run the controller's `finally` for an error raised
          // here, so drop the staging directory immediately rather than relying
          // only on the request `close` safety net.
          if (request.axisUploadDir) {
            void rm(request.axisUploadDir, {
              recursive: true,
              force: true,
            }).catch(() => undefined);
          }
          counter.destroy();
        }
        cb(err, info);
      });
    },
    _removeFile(...args: RemoveFile) {
      return inner._removeFile(...(args as Parameters<typeof inner._removeFile>));
    },
  };
}

function uploadDiskStorage(): multer.StorageEngine {
  const inner = multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const request = req as UploadRequest;
        if (!request.axisUploadDir) {
          request.axisUploadDir = await mkdtemp(join(tmpdir(), 'axis-upload-'));
          // Safety net: if multer aborts mid-stream (per-file size limit,
          // connection drop) our handler's `finally` never runs, so sweep the
          // staging dir when the request stream closes. Idempotent with the
          // controller finally (which also removes it after success).
          request.on('close', () => {
            if (request.axisUploadDir) {
              void rm(request.axisUploadDir, {
                recursive: true,
                force: true,
              }).catch(() => undefined);
            }
          });
        }
        cb(null, request.axisUploadDir);
      } catch (err) {
        cb(err as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      const base = (file.originalname || 'dicom').split(/[\\/]/).pop() || 'dicom';
      cb(null, `${randomBytes(6).toString('hex')}_${base}`);
    },
  });

  return aggregateLimitedStorage(inner);
}

@Controller('dicom')
export class DicomController {
  constructor(private readonly dicomService: DicomService) {}

  /**
   * Accepts one or more uploaded files under the `file`/`files` field:
   *   - a single ZIP archive (as before), or
   *   - one or more raw DICOM instances (e.g. the expanded contents of a PACS
   *     export folder, or a folder drag-and-drop from the web UI).
   *
   * When multiple raw files are supplied, the service bundles them into a
   * single ZIP so the existing hardened extraction/validation pipeline is
   * reused; a single non-archive file is validated and ingested directly.
   * Hospital ownership is always derived from the authenticated user, never
   * from the payload.
   */
  @Post('ingest')
  @Roles('HOSPITAL', 'ADMIN', 'MANAGER')
  @UseInterceptors(
    FilesInterceptor('file', DICOM_LIMITS.MAX_INSTANCES, {
      storage: uploadDiskStorage(),
      limits: {
        fileSize: DICOM_LIMITS.MAX_FILE_BYTES,
        files: DICOM_LIMITS.MAX_INSTANCES,
      },
    }),
  )
  async ingest(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: IngestUser,
    @Req() req: Request,
  ): Promise<{ data: any }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No file uploaded');
    }

    const request = req as UploadRequest;

    try {
      // A single uploaded archive (ZIP) with more than one entry must be
      // delivered as-is (already an archive); the service re-extracts it.
      const result = await this.dicomService.ingestDicom(
        files,
        files[0].originalname || 'study.zip',
        user,
      );

      return { data: result };
    } finally {
      // Remove the per-request upload staging directory (and any files within
      // it) regardless of outcome. `files` may be empty if Multer aborted, so
      // always attempt the directory removal.
      if (request.axisUploadDir) {
        await rm(request.axisUploadDir, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    }
  }
}
