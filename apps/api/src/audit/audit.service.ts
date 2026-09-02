import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuditAction, AuditResource } from '@axis/types';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    page?: number;
    pageSize?: number;
    actorId?: string;
    resource?: string;
    action?: string;
  }) {
    const { page = 1, pageSize = 50, actorId, resource, action } = filters;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (actorId) where.actorId = actorId;
    if (resource) where.resource = resource;
    if (action) where.action = action;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { timestamp: 'desc' },
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
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
