import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveStudyUid } from './study-identifier.js';
import { StudiesService } from './studies.service.js';
import { MAX_STUDY_HISTORY_ATTACHMENT_BYTES } from './study-history.constants.js';

const MIME_EXTENSION: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

interface HistoryActor {
  id: string;
  role: UserRole;
  hospitalId?: string;
}

interface UploadedHistoryFile {
  buffer?: Buffer;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class StudyHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studies: StudiesService,
  ) {}

  async getHistory(studyUid: string, user: HistoryActor) {
    const uid = await resolveStudyUid(this.prisma, studyUid);
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: uid },
      include: {
        patient: { select: { displayName: true, gender: true } },
        historyAttachments: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    });
    if (!study) throw new NotFoundException(`Study ${uid} not found`);
    this.studies.assertCanView(study, user);

    return {
      data: {
        studyInstanceUid: study.studyInstanceUid,
        patientName: study.patient.displayName,
        patientAge: study.patientAge,
        gender: study.patient.gender,
        referringPhysician: study.referringPhysician,
        clinicalHistory: study.clinicalHistory,
        attachment: study.historyAttachments[0] ?? null,
      },
    };
  }

  async uploadAttachment(
    studyUid: string,
    file: UploadedHistoryFile | undefined,
    user: HistoryActor,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('A supporting file is required');
    }

    const mimeType = this.detectMimeType(file.buffer);
    if (!mimeType || file.mimetype !== mimeType) {
      throw new BadRequestException(
        'Supporting files must be a valid PDF, JPEG, or PNG document',
      );
    }
    if (
      file.buffer.length === 0 ||
      file.buffer.length > MAX_STUDY_HISTORY_ATTACHMENT_BYTES
    ) {
      throw new BadRequestException('Supporting files must be 10 MB or smaller');
    }

    const uid = await resolveStudyUid(this.prisma, studyUid);
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: uid },
      include: { historyAttachments: { select: { id: true } } },
    });
    if (!study) throw new NotFoundException(`Study ${uid} not found`);
    this.studies.assertCanView(study, user);
    if (!['HOSPITAL_SUBMITTED', 'UNASSIGNED'].includes(study.status)) {
      throw new ForbiddenException(
        'Supporting files can only be added before the study is assigned',
      );
    }
    if (study.historyAttachments.length > 0) {
      throw new ConflictException('A supporting file is already attached');
    }

    const originalName = this.safeOriginalName(file.originalname);
    const storageKey = `${randomUUID()}${MIME_EXTENSION[mimeType]}`;
    const directory = this.storageDirectory();
    const filePath = join(directory, storageKey);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(filePath, file.buffer, { flag: 'wx', mode: 0o600 });

    try {
      const attachment = await this.prisma.studyHistoryAttachment.create({
        data: {
          studyId: study.id,
          uploadedById: user.id,
          storageKey,
          originalName,
          mimeType,
          sizeBytes: file.buffer.length,
        },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      });
      return { data: attachment };
    } catch (error) {
      await unlink(filePath);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A supporting file is already attached');
      }
      throw error;
    }
  }

  async readAttachment(attachmentId: string, user: HistoryActor) {
    const attachment = await this.prisma.studyHistoryAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        study: {
          select: {
            id: true,
            hospitalId: true,
            assignedRadiologistId: true,
          },
        },
      },
    });
    if (!attachment) throw new NotFoundException('Supporting file not found');
    this.studies.assertCanView(attachment.study, user);

    try {
      const buffer = await readFile(join(this.storageDirectory(), attachment.storageKey));
      return {
        buffer,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new NotFoundException('The supporting file is unavailable');
      }
      throw error;
    }
  }

  private storageDirectory(): string {
    return resolve(
      process.env.AXIS_STUDY_HISTORY_DIR ??
        join(process.cwd(), 'uploads', 'study-history'),
    );
  }

  private safeOriginalName(originalName: string): string {
    const name = Array.from(basename(originalName.replace(/\\/g, '/')))
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code >= 0x20 && code !== 0x7f;
      })
      .join('')
      .slice(0, 255);
    return name || 'supporting-file';
  }

  private detectMimeType(buffer: Buffer): string | undefined {
    if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
      return 'application/pdf';
    }
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'image/png';
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    return undefined;
  }
}
