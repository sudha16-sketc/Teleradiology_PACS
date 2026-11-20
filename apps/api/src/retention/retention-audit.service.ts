import { Injectable } from '@nestjs/common';
import {
  AuditResource as DbAuditResource,
  Prisma,
  RetentionAuditAction,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RetentionActor {
  id: string;
  role: string;
  displayName?: string;
  email?: string;
  hospitalId?: string | null;
}

export interface RetentionAuditInput {
  studyId?: string;
  retentionId?: string;
  action: RetentionAuditAction;
  triggeredBy: 'USER' | 'SYSTEM' | 'SCHEDULER';
  actor?: RetentionActor;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  details?: Record<string, unknown>;
}

const NOTIFICATION_ACTIONS = new Set<RetentionAuditAction>([
  RetentionAuditAction.NOTIFICATION_SENT,
  RetentionAuditAction.NOTIFICATION_DELIVERED,
  RetentionAuditAction.NOTIFICATION_IGNORED,
]);
const ARCHIVE_ACTIONS = new Set<RetentionAuditAction>([
  RetentionAuditAction.ARCHIVE_CREATED,
  RetentionAuditAction.ARCHIVE_VERIFIED,
  RetentionAuditAction.ARCHIVE_FAILED,
  RetentionAuditAction.DICOM_BACKUP_DELETED,
  RetentionAuditAction.METADATA_BACKUP_DELETED,
  RetentionAuditAction.ORIGINAL_DATA_DELETED,
  RetentionAuditAction.PERMANENT_DELETION_VERIFIED,
]);
const LOCK_ACTIONS = new Set<RetentionAuditAction>([
  RetentionAuditAction.RETENTION_LOCK_APPLIED,
  RetentionAuditAction.RETENTION_LOCK_RELEASED,
]);

@Injectable()
export class RetentionAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async record(input: RetentionAuditInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.recordTx(tx, input);
    });
  }

  async recordTx(tx: Prisma.TransactionClient, input: RetentionAuditInput): Promise<void> {
    await tx.retentionAuditLog.create({
      data: {
        studyId: input.studyId,
        retentionId: input.retentionId,
        action: input.action,
        triggeredBy: input.triggeredBy,
        actorId: input.actor?.id,
        status: input.status,
        details: (input.details ?? {}) as Prisma.InputJsonValue,
      },
    });
    if (!input.actor) return;
    await this.audit.createTx(tx, {
      actorId: input.actor.id,
      actorName: input.actor.displayName ?? input.actor.email ?? input.actor.id,
      actorRole: input.actor.role,
      action: input.action as unknown as Parameters<AuditService['createTx']>[1]['action'],
      resource: this.resourceFor(input.action),
      resourceId: input.retentionId ?? input.studyId ?? input.actor.id,
      metadata: {
        triggeredBy: input.triggeredBy,
        status: input.status,
        ...(input.details ?? {}),
      },
    });
  }

  private resourceFor(action: RetentionAuditAction): DbAuditResource {
    if (NOTIFICATION_ACTIONS.has(action)) return DbAuditResource.RETENTION_NOTIFICATION;
    if (ARCHIVE_ACTIONS.has(action)) return DbAuditResource.RETENTION_ARCHIVE;
    if (LOCK_ACTIONS.has(action)) return DbAuditResource.LEGAL_HOLD;
    return DbAuditResource.RETENTION;
  }
}
