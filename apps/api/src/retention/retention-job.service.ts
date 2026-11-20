import { Injectable } from '@nestjs/common';
import { Prisma, RetentionJobStatus, RetentionJobType } from '@prisma/client';
import { retentionPolicy } from './retention-config.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RetentionJobInput {
  type: RetentionJobType;
  dedupeKey: string;
  dueAt: Date;
  studyId?: string;
  retentionId?: string;
  payload?: Record<string, unknown>;
}

export interface RetentionJobRecord {
  id: string;
  type: RetentionJobType;
  studyId: string | null;
  retentionId: string | null;
  payload: Prisma.JsonValue;
  attempts: number;
}

@Injectable()
export class RetentionJobService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: RetentionJobInput) {
    return this.prisma.retentionJob.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: {
        type: input.type,
        dedupeKey: input.dedupeKey,
        dueAt: input.dueAt,
        studyId: input.studyId,
        retentionId: input.retentionId,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        maxAttempts: retentionPolicy().jobRetryLimit ?? 5,
      },
      update: {},
    });
  }

  async recoverExpiredLeases(now = new Date()): Promise<number> {
    const result = await this.prisma.retentionJob.updateMany({
      where: {
        status: RetentionJobStatus.RUNNING,
        leaseUntil: { lt: now },
      },
      data: {
        status: RetentionJobStatus.PENDING,
        leaseUntil: null,
        lockedBy: null,
        dueAt: now,
      },
    });
    return result.count;
  }

  async claim(workerId: string, leaseMs = 5 * 60 * 1000): Promise<RetentionJobRecord | null> {
    const now = new Date();
    const candidate = await this.prisma.retentionJob.findFirst({
      where: {
        status: RetentionJobStatus.PENDING,
        dueAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!candidate) return null;

    const claimed = await this.prisma.retentionJob.updateMany({
      where: {
        id: candidate.id,
        status: RetentionJobStatus.PENDING,
        dueAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: {
        status: RetentionJobStatus.RUNNING,
        lockedBy: workerId,
        leaseUntil: new Date(now.getTime() + leaseMs),
        startedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;

    return this.prisma.retentionJob.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        type: true,
        studyId: true,
        retentionId: true,
        payload: true,
        attempts: true,
      },
    });
  }

  async complete(id: string): Promise<void> {
    await this.prisma.retentionJob.updateMany({
      where: { id, status: RetentionJobStatus.RUNNING },
      data: {
        status: RetentionJobStatus.SUCCEEDED,
        completedAt: new Date(),
        leaseUntil: null,
        lockedBy: null,
        lastError: null,
      },
    });
  }

  async fail(id: string, error: unknown): Promise<void> {
    const job = await this.prisma.retentionJob.findUnique({
      where: { id },
      select: { attempts: true, maxAttempts: true },
    });
    if (!job) return;
    const dead = job.attempts >= job.maxAttempts;
    const backoffMinutes = Math.min(1440, 5 * 2 ** Math.max(0, job.attempts - 1));
    await this.prisma.retentionJob.updateMany({
      where: { id, status: RetentionJobStatus.RUNNING },
      data: {
        status: dead ? RetentionJobStatus.DEAD : RetentionJobStatus.PENDING,
        dueAt: new Date(Date.now() + backoffMinutes * 60 * 1000),
        leaseUntil: null,
        lockedBy: null,
        lastError: this.safeError(error),
      },
    });
  }

  async retry(id: string): Promise<void> {
    const job = await this.prisma.retentionJob.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!job) return;
    if (
      job.status !== RetentionJobStatus.DEAD &&
      job.status !== RetentionJobStatus.FAILED
    ) {
      return;
    }
    await this.prisma.retentionJob.update({
      where: { id },
      data: {
        status: RetentionJobStatus.PENDING,
        dueAt: new Date(),
        attempts: 0,
        lastError: null,
        leaseUntil: null,
        lockedBy: null,
      },
    });
  }

  async list(limit = 100) {
    return this.prisma.retentionJob.findMany({
      take: Math.min(Math.max(limit, 1), 200),
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        status: true,
        studyId: true,
        dueAt: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
      },
    });
  }

  private safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\r\n]+/g, ' ').slice(0, 2000) || 'Retention job failed';
  }
}

export const RETENTION_JOB_TYPES = RetentionJobType;
