import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  Param,
  Req,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import { DicomService, type IngestUser } from './dicom.service.js';
import { DICOM_LIMITS } from './dicom.constants.js';
import type { Request } from 'express';

type UploadRequest = Request & { axisUploadDir?: string };

export async function cleanupUploadDirectory(
  request: UploadRequest,
  removeDirectory: typeof rm = rm,
  logger: Pick<Logger, 'warn'> = new Logger(DicomController.name),
): Promise<void> {
  const uploadDir = request.axisUploadDir;
  if (!uploadDir) return;
  request.axisUploadDir = undefined;
  try {
    await removeDirectory(uploadDir, { recursive: true, force: true });
  } catch {
    logger.warn('DICOM upload staging directory cleanup failed');
  }
}

/**
 * Writes each multipart file to a fresh per-request temp directory instead of
 * buffering it in RAM (multer memoryStorage). This is what makes large studies
 * (up to the 1 GiB per-file limit) uploadable without holding the entire
 * request in heap: the bytes stream to disk and the service reads files back
 * one at a time from `file.path`. The temp directory is created lazily and is
 * always removed by `ingest()` in finally, including on Multer/validation
 * errors (a request-level safety net sweeps it even if the handler never runs).
 */
function uploadDiskStorage(): multer.StorageEngine {
  return multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const request = req as UploadRequest;
        if (!request.axisUploadDir) {
          request.axisUploadDir = await mkdtemp(join(tmpdir(), 'axis-upload-'));
          // Safety net: if multer aborts mid-stream the handler's `finally`
          // never runs, so sweep the staging dir once the response completes.
          // Request 'close' fires when the body has been read, which can delete
          // files before ingestDicom has finished reading them.
          const cleanup = () => {
            const dir = request.axisUploadDir;
            if (!dir) return;
            request.axisUploadDir = undefined;
            void rm(dir, { recursive: true, force: true }).catch((err: unknown) => {
              console.error('Failed to remove DICOM upload staging directory', err);
            });
          };
          request.res?.once('finish', cleanup);
          request.res?.once('close', cleanup);
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
      await cleanupUploadDirectory(request);
    }
  }

  @Post('reingest/:studyUid')
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
  async reingest(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: IngestUser,
    @Req() req: Request,
  ): Promise<{ data: unknown }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No DICOM files uploaded for recovery');
    }
    const request = req as UploadRequest;
    try {
      return {
        data: await this.dicomService.reingestDicom(files, studyUid, user),
      };
    } finally {
      await cleanupUploadDirectory(request);
    }
  }
}
