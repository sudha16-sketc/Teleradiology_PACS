import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  DicomWebService,
  type DicomWebUser,
} from '../dicomweb/dicomweb.service.js';
import type { ImagingAvailability } from '@axis/types';
import type {
  ListReconciliationRunsDto,
  RunReconciliationDto,
} from './dto/reconciliation.dto.js';

interface ReconciliationFinding {
  studyInstanceUid: string;
  state: ImagingAvailability;
  reason: string;
  expectedSeriesCount: number;
  actualSeriesCount: number;
  expectedInstanceCount: number;
  actualInstanceCount: number;
  missingSeriesUids: string[];
  missingInstanceUids: string[];
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dicomweb: DicomWebService,
    private readonly audit: AuditService,
  ) {}

  async listRuns(dto: ListReconciliationRunsDto) {
    const skip = (dto.page - 1) * dto.pageSize;
    const [data, total] = await Promise.all([
      this.prisma.studyReconciliationRun.findMany({
        skip,
        take: dto.pageSize,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.studyReconciliationRun.count(),
    ]);
    return {
      data,
      meta: {
        total,
        page: dto.page,
        pageSize: dto.pageSize,
        totalPages: Math.ceil(total / dto.pageSize),
      },
    };
  }

  async getRun(id: string) {
    const run = await this.prisma.studyReconciliationRun.findUnique({
      where: { id },
    });
    if (!run) throw new NotFoundException('Reconciliation run not found');
    return { data: run };
  }

  async run(user: DicomWebUser, dto: RunReconciliationDto) {
    const run = await this.prisma.studyReconciliationRun.create({
      data: {
        requestedById: user.id,
        status: 'RUNNING',
        findings: [] as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      const skip = (dto.page - 1) * dto.pageSize;
      const studies = await this.prisma.study.findMany({
        where: dto.hospitalId ? { hospitalId: dto.hospitalId } : undefined,
        skip,
        take: dto.pageSize,
        orderBy: { createdAt: 'desc' },
        select: { studyInstanceUid: true },
      });

      const findings: ReconciliationFinding[] = [];
      const counts = {
        availableCount: 0,
        missingCount: 0,
        incompleteCount: 0,
        unavailableCount: 0,
      };

      for (const study of studies) {
        const result = await this.dicomweb.verifyStudyAvailability(
          user,
          study.studyInstanceUid,
          { persist: true, audit: false },
        );
        findings.push({
          studyInstanceUid: result.studyInstanceUid,
          state: result.state,
          reason: result.reason,
          expectedSeriesCount: result.expectedSeriesCount,
          actualSeriesCount: result.actualSeriesCount,
          expectedInstanceCount: result.expectedInstanceCount,
          actualInstanceCount: result.actualInstanceCount,
          missingSeriesUids: result.missingSeriesUids,
          missingInstanceUids: result.missingInstanceUids,
        });
        if (result.state === 'AVAILABLE') counts.availableCount += 1;
        else if (result.state === 'MISSING') counts.missingCount += 1;
        else if (result.state === 'INCOMPLETE') counts.incompleteCount += 1;
        else if (result.state === 'UNAVAILABLE') counts.unavailableCount += 1;
      }

      const orthancUids = [...new Set(await this.dicomweb.listOrthancStudyUids())];
      const indexed = await this.prisma.study.findMany({
        where: { studyInstanceUid: { in: orthancUids } },
        select: { studyInstanceUid: true },
      });
      const indexedSet = new Set(indexed.map((row) => row.studyInstanceUid));
      const unexpectedUids = orthancUids.filter((uid) => !indexedSet.has(uid));
      for (const uid of unexpectedUids) {
        findings.push({
          studyInstanceUid: uid,
          state: 'MISSING',
          reason: 'Study exists in Orthanc but has no matching PostgreSQL record',
          expectedSeriesCount: 0,
          actualSeriesCount: 0,
          expectedInstanceCount: 0,
          actualInstanceCount: 0,
          missingSeriesUids: [],
          missingInstanceUids: [],
        });
      }

      const completed = await this.prisma.studyReconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          studiesScanned: studies.length,
          ...counts,
          unexpectedCount: unexpectedUids.length,
          findings: findings as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.create({
        actorId: user.id,
        actorName: 'DICOM reconciliation',
        actorRole: user.role,
        action: 'DICOM_RECONCILIATION',
        resource: 'WORKLIST',
        resourceId: run.id,
        metadata: {
          studiesScanned: completed.studiesScanned,
          missingCount: completed.missingCount,
          incompleteCount: completed.incompleteCount,
          unexpectedCount: completed.unexpectedCount,
        },
      });
      return { data: completed };
    } catch (err) {
      const failed = await this.prisma.studyReconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          failureReason: (err as Error).message,
        },
      });
      await this.audit.create({
        actorId: user.id,
        actorName: 'DICOM reconciliation',
        actorRole: user.role,
        action: 'DICOM_RECONCILIATION',
        resource: 'WORKLIST',
        resourceId: run.id,
        metadata: { status: 'FAILED' },
      }).catch(() => undefined);
      return { data: failed };
    }
  }
}
