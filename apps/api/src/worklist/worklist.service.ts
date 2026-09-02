import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WorklistService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: Record<string, string | undefined>, user?: { id: string; role: string }) {
    const where: Record<string, unknown> = {};

    if (user?.role === 'RADIOLOGIST') {
      where.study = { assignedRadiologistId: user.id };
    }

    if (filters.status) {
      where.study = { ...(where.study as Record<string, unknown>), status: filters.status };
    }
    if (filters.hospitalId) {
      where.study = { ...(where.study as Record<string, unknown>), hospitalId: filters.hospitalId };
    }
    if (filters.priority) {
      where.study = { ...(where.study as Record<string, unknown>), priority: filters.priority };
    }
    if (filters.modality) {
      where.study = { ...(where.study as Record<string, unknown>), modality: filters.modality };
    }
    if (filters.search) {
      where.study = {
        ...(where.study as Record<string, unknown>),
        OR: [
          { accessionNumber: { contains: filters.search, mode: 'insensitive' } },
          { patient: { displayName: { contains: filters.search, mode: 'insensitive' } } },
        ],
      };
    }

    const items = await this.prisma.worklistItem.findMany({
      where,
      include: {
        study: {
          include: {
            patient: true,
            hospital: true,
            assignedRadiologist: true,
          },
        },
      },
    });

    return { data: items };
  }

  async my(userId: string, userRole: string) {
    if (userRole === 'RADIOLOGIST') {
      const studies = await this.prisma.study.findMany({
        where: {
          assignedRadiologistId: userId,
          status: { in: ['ASSIGNED', 'IN_READING', 'DRAFT_REPORT'] },
        },
        include: {
          patient: true,
          hospital: true,
          assignedRadiologist: true,
          reports: {
            include: { author: true },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      });

      const items = studies.map((s) => ({
        id: s.id,
        study: s,
        assignedAt: s.assignedAt,
        startedAt: s.reportingStartedAt,
        completedAt: s.finalizedAt,
        assignedRadiologistId: s.assignedRadiologistId,
      }));

      return { data: items };
    }

    const studies = await this.prisma.study.findMany({
      where: { status: { in: ['SUBMITTED', 'VALIDATED', 'UNASSIGNED'] } },
      include: {
        patient: true,
        hospital: true,
        assignedRadiologist: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const items = studies.map((s) => ({
      id: s.id,
      study: s,
      assignedAt: s.assignedAt,
      startedAt: s.reportingStartedAt,
      completedAt: s.finalizedAt,
      assignedRadiologistId: s.assignedRadiologistId,
    }));

    return { data: items };
  }

  async assign(studyUid: string, radiologistId: string, assignedBy?: string) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });

    if (!study) {
      throw new NotFoundException(`Study ${studyUid} not found`);
    }

    const updated = await this.prisma.study.update({
      where: { studyInstanceUid: studyUid },
      data: {
        status: 'ASSIGNED',
        assignedRadiologistId: radiologistId,
        assignedBy,
        assignedAt: new Date(),
      },
    });

    await this.prisma.worklistItem.upsert({
      where: { studyId: study.id },
      update: { assignedAt: new Date() },
      create: {
        studyId: study.id,
        assignedAt: new Date(),
      },
    });

    return { data: updated };
  }
}
