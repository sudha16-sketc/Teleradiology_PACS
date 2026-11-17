import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import type { UserRole } from '@prisma/client';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import {
  ReportImagesService,
  REPORT_IMAGE_MAX_BYTES,
  REPORT_IMAGE_MIME_TYPES,
} from './report-images.service.js';

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string;
}

@Controller('reports')
export class ReportImagesController {
  constructor(private readonly images: ReportImagesService) {}

  @Post(':studyUid/images')
  @Roles('RADIOLOGIST')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: REPORT_IMAGE_MAX_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (
          !REPORT_IMAGE_MIME_TYPES.includes(
            file.mimetype as (typeof REPORT_IMAGE_MIME_TYPES)[number],
          )
        ) {
          callback(
            new BadRequestException(
              'Unsupported image type. Upload a PNG, JPEG, GIF or WebP image.',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  upload(
    @Param('studyUid') studyUid: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.images.upload(studyUid, file, user);
  }

  /**
   * Authenticated image streaming. Report images are never exposed as public
   * static assets: every read passes through the same study/report access rules
   * as the report itself.
   */
  @Get('images/:id')
  @Roles('RADIOLOGIST', 'MANAGER', 'ADMIN', 'HOSPITAL')
  async read(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { image, stream } = await this.images.read(id, user);
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', String(image.sizeBytes));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }

  @Delete('images/:id')
  @Roles('RADIOLOGIST', 'MANAGER', 'ADMIN')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.images.remove(id, user);
  }
}
