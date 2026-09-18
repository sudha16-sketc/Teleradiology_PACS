import { Injectable, NotFoundException } from '@nestjs/common';
import { AIJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.constants.js';

type JobStatus = AIJobStatus;

@Injectable()
export class AIService {
  constructor(private readonly prisma: PrismaService) {}

  async listJobs(
    filters: {
      page?: number;
      pageSize?: number;
      status?: JobStatus;
      studyId?: string;
    },
    user: AuthenticatedUser,
  ) {
    const { page = 1, pageSize = 20, status, studyId } = filters;
    const skip = (page - 1) * pageSize;

    // MANAGERs are hospital-scoped: they may only view AI jobs for studies of
    // their own hospital. An ADMIN/RADIOLOGIST covers all hospitals.
    if (user.role === 'MANAGER') {
      if (!user.hospitalId) {
        return { data: [], meta: { total: 0, page, pageSize, totalPages: 0 } };
      }
      const where: Prisma.AIJobWhereInput = {
        study: { hospitalId: user.hospitalId },
      };
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
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    }

    const where: Prisma.AIJobWhereInput = {};
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

  async getJob(id: string, user: AuthenticatedUser) {
    const job = await this.prisma.aIJob.findUnique({
      where: { id },
      include: { study: { include: { patient: true } } },
    });

    if (!job) throw new NotFoundException(`AI Job ${id} not found`);

    // Tenant isolation: a MANAGER cannot read job results for another
    // hospital's study. NotFound (not Forbidden) avoids an existence oracle.
    if (user.role === 'MANAGER' && job.study.hospitalId !== user.hospitalId) {
      throw new NotFoundException(`AI Job ${id} not found`);
    }

    return { data: job };
  }
}