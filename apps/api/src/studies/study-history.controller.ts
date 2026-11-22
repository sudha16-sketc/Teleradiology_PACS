import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import type { Response } from 'express';
import type { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { StudyHistoryService } from './study-history.service.js';
import {
  MAX_STUDY_HISTORY_ATTACHMENT_BYTES,
  STUDY_HISTORY_ATTACHMENT_MIME_TYPES,
} from './study-history.constants.js';

const ALLOWED_MIME_TYPES = new Set<string>(
  STUDY_HISTORY_ATTACHMENT_MIME_TYPES,
);

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string;
}

@Controller('studies')
export class StudyHistoryController {
  constructor(private readonly history: StudyHistoryService) {}

  @Get(':studyUid/history')
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL')
  getHistory(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.history.getHistory(studyUid, user);
  }

  @Post(':studyUid/history/attachments')
  @Roles('HOSPITAL', 'ADMIN', 'MANAGER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_STUDY_HISTORY_ATTACHMENT_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
          callback(
            new BadRequestException(
              'Supporting files must be a PDF, JPEG, or PNG document',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadAttachment(
    @Param('studyUid') studyUid: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.history.uploadAttachment(studyUid, file, user);
  }

  @Get('history-attachments/:attachmentId')
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const attachment = await this.history.readAttachment(attachmentId, user);
    const fallbackName =
      attachment.originalName.replace(/[^A-Za-z0-9._-]/g, '_') ||
      `supporting-file${attachment.mimeType === 'application/pdf' ? '.pdf' : ''}`;
    const encodedName = encodeURIComponent(attachment.originalName).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );

    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Length', attachment.buffer.length);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(200).send(attachment.buffer);
  }
}
