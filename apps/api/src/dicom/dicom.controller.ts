import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import { DicomService, type IngestUser } from './dicom.service.js';
import { DICOM_LIMITS } from './dicom.constants.js';

@Controller('dicom')
export class DicomController {
  constructor(private readonly dicomService: DicomService) {}

  /**
   * Accepts one or more uploaded files under the `file`/`files` field:
   *   - a single ZIP archive (as before), or
   *   - one or more raw DICOM instances (e.g. the expanded contents of a PACS
   *     export folder, or a folder drag-and-drop from the web UI).
   *
   * When multiple files (or a single non-archive file) are supplied, the service
   * bundles them into a single in-memory ZIP so the existing hardened
   * extraction/validation pipeline is reused unchanged. Hospital ownership is
   * always derived from the authenticated user, never from the payload.
   */
  @Post('ingest')
  @Roles('HOSPITAL', 'ADMIN', 'MANAGER')
  @UseInterceptors(
    FilesInterceptor('file', DICOM_LIMITS.MAX_INSTANCES, {
      storage: memoryStorage(),
      limits: {
        fileSize: DICOM_LIMITS.MAX_FILE_BYTES,
        files: DICOM_LIMITS.MAX_INSTANCES,
      },
    }),
  )
  async ingest(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: IngestUser,
  ): Promise<{ data: any }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No file uploaded');
    }

    // A single uploaded archive (ZIP) with more than one entry must be
    // delivered as-is (already an archive); the service re-extracts it.
    const result = await this.dicomService.ingestDicom(
      files,
      files[0].originalname || 'study.zip',
      user,
    );

    return { data: result };
  }
}
