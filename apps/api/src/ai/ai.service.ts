import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AIService {
  constructor(private readonly prisma: PrismaService) {}

  async listJobs(filters: {
    page?: number;
    pageSize?: number;
    status?: string;
    studyId?: string;
  }) {
    const { page = 1, pageSize = 20, status, studyId } = filters;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (studyId) where.studyId = studyId;

    const [data, total] = await Promise.all([
      this.prisma.aIJob.findMany({
        where,
        skip,
        take: pageSize,
        include: { study: { include: { patient: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.aIJob.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getJob(id: string) {
    const job = await this.prisma.aIJob.findUnique({
      where: { id },
      include: { study: { include: { patient: true } } },
    });

    if (!job) throw new NotFoundException(`AI Job ${id} not found`);
    return { data: job };
  }
}
