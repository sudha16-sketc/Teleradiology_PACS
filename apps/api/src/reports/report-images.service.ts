import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { HOSPITAL_VISIBLE_STATES } from '../reviews/reviews.service.js';
import { createReadStream } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { UserRole } from '@prisma/client';

export const REPORT_IMAGE_MAX_BYTES = Number(
  process.env.AXIS_REPORT_IMAGE_MAX_BYTES ?? 10 * 1024 * 1024,
);

export const REPORT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

interface Actor {
  id: string;
  role: UserRole;
  hospitalId?: string;
}

interface UploadFile {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

/** Detect the real image type from magic bytes; never trust the client MIME. */
export function detectImageMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

@Injectable()
export class ReportImagesService {
  constructor(private readonly prisma: PrismaService) {}

  private storageDir(): string {
    return (
      process.env.AXIS_REPORT_IMAGE_DIR ??
      path.join(process.cwd(), 'uploads', 'report-images')
    );
  }

  private async assertUploadAccess(studyUid: string, actor: Actor) {
    if (actor.role !== 'RADIOLOGIST') {
      throw new ForbiddenException('Only the assigned radiologist can upload report images');
    }
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      select: {
        id: true,
        assignedRadiologistId: true,
        reports: {
          select: { id: true, status: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);
    if (study.assignedRadiologistId !== actor.id) {
      throw new ForbiddenException('Only the assigned radiologist can upload images to this report');
    }
    const report = study.reports[0];
    if (!report) {
      throw new BadRequestException('Create the report draft before uploading images');
    }
    if (report.status !== 'DRAFT') {
      throw new BadRequestException('Images can only be uploaded while the report is a draft');
    }
    return { study, report };
  }

  async upload(studyUid: string, file: UploadFile | undefined, actor: Actor) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No image file uploaded');
    }
    if (file.size && file.size > REPORT_IMAGE_MAX_BYTES) {
      throw new BadRequestException(
        `Image exceeds the ${Math.round(REPORT_IMAGE_MAX_BYTES / (1024 * 1024))}MB limit`,
      );
    }

    const mimeType = detectImageMime(file.buffer);
    if (!mimeType || !EXTENSION_BY_MIME[mimeType]) {
      throw new BadRequestException(
        'Unsupported image type. Upload a PNG, JPEG, GIF or WebP image.',
      );
    }

    const { study, report } = await this.assertUploadAccess(studyUid, actor);
    const extension = EXTENSION_BY_MIME[mimeType];
    const storageKey = `${randomUUID()}.${extension}`;
    const directory = this.storageDir();
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, storageKey);
    await writeFile(target, file.buffer);

    let image;
    try {
      image = await this.prisma.reportImage.create({
        data: {
          reportId: report.id,
          studyId: study.id,
          uploadedById: actor.id,
          storageKey,
          originalName: file.originalname ?? `image.${extension}`,
          mimeType,
          sizeBytes: file.buffer.length,
        },
      });
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    }

    return {
      data: {
        ...image,
        url: `/api/reports/images/${image.id}`,
      },
    };
  }

  private async loadAuthorized(id: string, actor: Actor) {
    const image = await this.prisma.reportImage.findUnique({
      where: { id },
      include: {
        report: { select: { authorId: true } },
        study: {
          select: {
            hospitalId: true,
            status: true,
            assignedRadiologistId: true,
          },
        },
      },
    });
    if (!image) throw new NotFoundException(`Report image ${id} not found`);

    if (actor.role === 'HOSPITAL') {
      if (image.study.hospitalId !== actor.hospitalId) {
        throw new ForbiddenException('You do not have access to this image');
      }
      if (!HOSPITAL_VISIBLE_STATES.includes(image.study.status)) {
        throw new ForbiddenException('The final report is not yet available for this study.');
      }
      return image;
    }
    if (actor.role === 'RADIOLOGIST') {
      if (
        image.study.assignedRadiologistId !== actor.id &&
        image.report.authorId !== actor.id
      ) {
        throw new ForbiddenException('You do not have access to this image');
      }
      return image;
    }
    if (actor.role === 'ADMIN' || actor.role === 'MANAGER') return image;
    throw new ForbiddenException('You do not have access to this image');
  }

  async read(id: string, actor: Actor) {
    const image = await this.loadAuthorized(id, actor);
    const filePath = path.join(this.storageDir(), image.storageKey);
    return { image, stream: createReadStream(filePath) };
  }

  async remove(id: string, actor: Actor) {
    const image = await this.loadAuthorized(id, actor);
    if (
      actor.role !== 'ADMIN' &&
      actor.role !== 'MANAGER' &&
      image.uploadedById !== actor.id &&
      image.report.authorId !== actor.id
    ) {
      throw new ForbiddenException('You can only delete images you uploaded');
    }
    await this.prisma.reportImage.delete({ where: { id } });
    await unlink(path.join(this.storageDir(), image.storageKey)).catch(
      () => undefined,
    );
    return { success: true };
  }
}
