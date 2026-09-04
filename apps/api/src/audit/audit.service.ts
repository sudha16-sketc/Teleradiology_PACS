import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuditAction, AuditResource } from '@axis/types';
import { Prisma, AuditAction as DbAuditAction, AuditResource as DbAuditResource } from '@prisma/client';
import { currentCorrelationId } from '../common/observability/request-context.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    page?: number;
    pageSize?: number;
    actorId?: string;
    actorRole?: string;
    resource?: string;
    action?: string;
    correlationId?: string;
    studyUid?: string;
    hospitalId?: string;
    from?: string;
    to?: string;
    user?: { id: string; role: string; hospitalId?: string };
  }) {
    let { page = 1, pageSize = 50, user } = filters;
    if (pageSize > 200) pageSize = 200;
    page = page < 1 ? 1 : page;
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.actorRole) where.actorRole = filters.actorRole;
    if (filters.resource) where.resource = filters.resource as DbAuditResource;
    if (filters.action) where.action = filters.action as DbAuditAction;
    if (filters.correlationId) where.correlationId = filters.correlationId;

    // Date-range filtering on the audit timestamp.
    if (filters.from || filters.to) {
      where.timestamp = {};
      if (filters.from) where.timestamp.gte = new Date(filters.from);
      if (filters.to) where.timestamp.lt = new Date(filters.to);
    }

    // Map a studyInstanceUid filter to the study's internal id found in resourceId.
    if (filters.studyUid) {
      const study = await this.prisma.study.findFirst({
        where: { studyInstanceUid: filters.studyUid },
        select: { id: true },
      });
      if (study) where.resourceId = study.id;
      else return { data: [], meta: { total: 0, page, pageSize, totalPages: 0 } };
    }

    // Admin scope: optionally restrict to a specific hospital's studies.
    if (filters.hospitalId && user && user.role === 'ADMIN') {
      const hospitalStudies = await this.prisma.study.findMany({
        where: { hospitalId: filters.hospitalId },
        select: { id: true },
      });
      where.resourceId = { in: hospitalStudies.map((s) => s.id) };
    }

    // Manager scope: own actions + actions on studies from their hospital.
    if (user && user.role === 'MANAGER' && user.hospitalId) {
      const hospitalStudies = await this.prisma.study.findMany({
        where: { hospitalId: user.hospitalId },
        select: { id: true },
      });
      const studyIds = hospitalStudies.map((s) => s.id);
      const orClauses: Record<string, unknown>[] = [
        ...(Array.isArray(where.OR) ? where.OR : []),
        { actorId: user.id },
      ];
      if (studyIds.length) {
        orClauses.push({ resourceId: { in: studyIds } });
      } else {
        // Hospital with no studies yet: nothing to see beyond the actor's own rows.
        orClauses.push({ resourceId: null });
      }
      where.OR = orClauses;
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.auditLog.count({ where }),
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

  async create(entry: {
    actorId: string;
    actorName: string;
    actorRole: string;
    action: AuditAction;
    resource: AuditResource;
    resourceId: string;
    ipAddress?: string;
    userAgent?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        actorName: entry.actorName,
        actorRole: entry.actorRole,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        correlationId: entry.correlationId ?? currentCorrelationId(),
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Writes an audit row using a caller-supplied Prisma transaction client so the
   * audit row is committed atomically with the workflow mutation it describes.
   */
  async createTx(
    tx: Prisma.TransactionClient,
    entry: {
      actorId: string;
      actorName: string;
      actorRole: string;
      action: AuditAction;
      resource: AuditResource;
      resourceId: string;
      ipAddress?: string;
      userAgent?: string;
      correlationId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        actorName: entry.actorName,
        actorRole: entry.actorRole,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        correlationId: entry.correlationId ?? currentCorrelationId(),
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
