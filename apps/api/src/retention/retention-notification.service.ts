import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RetentionJobType,
  RetentionStatus,
  UserRole,
} from '@prisma/client';
import type { RetentionResponseResult } from '@axis/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { retentionPolicy } from './retention-config.js';
import { RetentionAuditService, type RetentionActor } from './retention-audit.service.js';
import {
  retentionStudyInclude,
  RetentionEligibilityService,
} from './retention-eligibility.service.js';
import { RetentionJobService } from './retention-job.service.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

@Injectable()
export class RetentionNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly eligibility: RetentionEligibilityService,
    private readonly jobs: RetentionJobService,
    private readonly audit: RetentionAuditService,
  ) {}

  async sendDueNotifications(now = new Date()): Promise<number> {
    const policy = retentionPolicy();
    const due = await this.prisma.studyRetention.findMany({
      where: {
        status: {
          in: ['PENDING_RETENTION', 'CANCELLED_DEFERRED', 'NOTIFICATION_IGNORED'] as RetentionStatus[],
        },
        retentionLocked: false,
        nextActionAt: { lte: now },
        study: { retentionLocked: false },
      },
      include: {
        study: { include: retentionStudyInclude },
        notifications: {
          select: {
            id: true,
            recipientUserId: true,
            sequenceNumber: true,
            deliveryStatus: true,
            nextRetryAt: true,
            deliveryAttempts: true,
          },
        },
      },
      take: 100,
      orderBy: { nextActionAt: 'asc' },
    });

    let sent = 0;
    for (const retention of due) {
      const cutoff = this.eligibility.cutoff(policy.initialRetentionDays, now);
      const evaluation = this.eligibility.evaluate(
        retention.study,
        await this.eligibility.findVerifiedBackup(this.prisma),
        policy,
        cutoff,
        now,
        'LIFECYCLE',
      );
      if (!evaluation.eligible) {
        const nextStatus = evaluation.blockedByLock ? RetentionStatus.ON_HOLD : RetentionStatus.PENDING_RETENTION;
        await this.prisma.studyRetention.update({
          where: { id: retention.id },
          data: {
            status: nextStatus,
            nextActionAt: new Date(now.getTime() + MS_PER_DAY),
          },
        });
        await this.audit.record({
          studyId: retention.studyId,
          retentionId: retention.id,
          action: 'RETENTION_ELIGIBILITY_CHECKED',
          triggeredBy: 'SCHEDULER',
          status: 'SKIPPED',
          details: { reason: evaluation.reason ?? 'NOT_ELIGIBLE' },
        });
        continue;
      }

      const sequence = retention.notificationSequence + 1;
      const recipients = await this.recipients(retention.study.hospitalId);
      if (!recipients.length) {
        await this.prisma.studyRetention.update({
          where: { id: retention.id },
          data: {
            status: RetentionStatus.PENDING_RETENTION,
            nextActionAt: new Date(now.getTime() + MS_PER_DAY),
          },
        });
        continue;
      }
      const responseDeadline = new Date(
        now.getTime() + policy.ignoreResponseHours * MS_PER_HOUR,
      );
      const message =
        `Study ${retention.study.accessionNumber} has completed its retention review period. ` +
        `Choose CANCEL to defer for ${policy.cancelReminderDays} days or DELETE to archive now. ` +
        `If no response is recorded within ${policy.ignoreResponseHours} hours, the automated retention policy will be evaluated after ${policy.ignoreReminderDays} days.`;

      for (const recipientId of recipients) {
        const existing = retention.notifications.find(
          (item) =>
            item.recipientUserId === recipientId &&
            item.sequenceNumber === sequence,
        );
        if (
          existing &&
          existing.deliveryStatus !== 'FAILED'
        ) {
          continue;
        }
        if (
          existing?.deliveryStatus === 'FAILED' &&
          existing.nextRetryAt &&
          existing.nextRetryAt > now
        ) {
          continue;
        }

        let notificationId = existing?.id;
        let attempts = existing?.deliveryAttempts ?? 0;
        try {
          if (!notificationId) {
            const created = await this.prisma.retentionNotification.create({
              data: {
                studyId: retention.studyId,
                retentionId: retention.id,
                recipientUserId: recipientId,
                sequenceNumber: sequence,
                responseDeadline,
                deliveryStatus: 'PENDING',
                deliveryAttempts: 0,
              },
              select: { id: true },
            });
            notificationId = created.id;
          }
          attempts += 1;
          const appNotification = await this.notifications.create({
            recipientUserId: recipientId,
            type: 'RETENTION_NOTIFICATION',
            title: 'Retention decision required',
            message,
            studyId: retention.studyId,
          });
          await this.prisma.retentionNotification.update({
            where: { id: notificationId },
            data: {
              appNotificationId: appNotification.id,
              sentAt: now,
              deliveredAt: now,
              responseDeadline,
              deliveryStatus: 'DELIVERED',
              deliveryAttempts: attempts,
              lastError: null,
              nextRetryAt: null,
            },
          });
          sent += 1;
        } catch (error) {
          const delayMinutes = Math.min(1440, 5 * 2 ** Math.max(0, attempts - 1));
          await this.prisma.retentionNotification.update({
            where: { id: notificationId as string },
            data: {
              deliveryStatus: 'FAILED',
              deliveryAttempts: attempts,
              nextRetryAt: new Date(now.getTime() + delayMinutes * 60 * 1000),
              lastError: (error instanceof Error ? error.message : String(error))
                .replace(/[\r\n]+/g, ' ')
                .slice(0, 2000),
            },
          });
        }
      }

      const delivered = await this.prisma.retentionNotification.count({
        where: {
          retentionId: retention.id,
          sequenceNumber: sequence,
          deliveryStatus: { in: ['SENT', 'DELIVERED', 'READ', 'RESPONDED'] },
        },
      });
      if (!delivered) continue;

      await this.prisma.studyRetention.update({
        where: { id: retention.id },
        data: {
          status: RetentionStatus.AWAITING_USER_RESPONSE,
          notificationSequence: sequence,
          lastNotificationAt: now,
          responseDeadline,
          nextActionAt: responseDeadline,
        },
      });
      await this.audit.record({
        studyId: retention.studyId,
        retentionId: retention.id,
        action: 'NOTIFICATION_SENT',
        triggeredBy: 'SCHEDULER',
        status: 'SUCCESS',
        details: {
          sequence,
          recipientCount: delivered,
          responseDeadline: responseDeadline.toISOString(),
        },
      });
    }
    return sent;
  }

  async markIgnoredDue(now = new Date()): Promise<number> {
    const policy = retentionPolicy();
    const due = await this.prisma.retentionNotification.findMany({
      where: {
        response: null,
        responseDeadline: { lte: now },
        deliveryStatus: { in: ['SENT', 'DELIVERED', 'READ'] },
        retention: { retentionLocked: false },
        study: { retentionLocked: false },
      },
      select: {
        id: true,
        retentionId: true,
        sequenceNumber: true,
      },
    });
    const groups = new Map<string, { retentionId: string; sequence: number; ids: string[] }>();
    for (const item of due) {
      const key = `${item.retentionId}:${item.sequenceNumber}`;
      const group = groups.get(key) ?? {
        retentionId: item.retentionId,
        sequence: item.sequenceNumber,
        ids: [],
      };
      group.ids.push(item.id);
      groups.set(key, group);
    }

    let ignoredSequences = 0;
    for (const group of groups.values()) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const counted = await tx.retentionNotification.updateMany({
          where: { id: group.ids[0], ignoredCounted: false, response: null },
          data: { ignoredCounted: true },
        });
        if (!counted.count) return null;

        const updated = await tx.retentionNotification.updateMany({
          where: {
            id: { in: group.ids },
            response: null,
            retention: { retentionLocked: false },
            study: { retentionLocked: false },
          },
          data: {
            response: 'IGNORED',
            deliveryStatus: 'IGNORED',
            respondedAt: now,
            readAt: now,
          },
        });
        if (!updated.count) return null;

        const retention = await tx.studyRetention.update({
          where: { id: group.retentionId, retentionLocked: false },
          data: { ignoredCount: { increment: 1 } },
          select: { ignoredCount: true, studyId: true },
        });
        let shouldProcess = retention.ignoredCount >= policy.ignoreMaxCount;
        const nextActionAt = shouldProcess
          ? now
          : new Date(now.getTime() + policy.ignoreReminderDays * MS_PER_DAY);
        if (shouldProcess) {
          await tx.studyRetention.update({
            where: { id: group.retentionId },
            data: { status: RetentionStatus.AUTOMATIC_PROCESSING, nextActionAt },
          });
        } else {
          const deferred = await tx.studyRetention.updateMany({
            where: {
              id: group.retentionId,
              ignoredCount: { lt: policy.ignoreMaxCount },
              status: {
                in: [
                  RetentionStatus.PENDING_RETENTION,
                  RetentionStatus.AWAITING_USER_RESPONSE,
                  RetentionStatus.CANCELLED_DEFERRED,
                  RetentionStatus.NOTIFICATION_IGNORED,
                ],
              },
              retentionLocked: false,
            },
            data: { status: RetentionStatus.NOTIFICATION_IGNORED, nextActionAt },
          });
          if (!deferred.count) {
            const latest = await tx.studyRetention.findUnique({
              where: { id: group.retentionId },
              select: { ignoredCount: true },
            });
            if (latest && latest.ignoredCount >= policy.ignoreMaxCount) {
              shouldProcess = true;
              await tx.studyRetention.update({
                where: { id: group.retentionId },
                data: { status: RetentionStatus.AUTOMATIC_PROCESSING, nextActionAt: now },
              });
            }
          }
        }
        await this.audit.recordTx(tx, {
          studyId: retention.studyId,
          retentionId: group.retentionId,
          action: 'NOTIFICATION_IGNORED',
          triggeredBy: 'SCHEDULER',
          status: 'SUCCESS',
          details: {
            sequence: group.sequence,
            ignoredCount: retention.ignoredCount,
            threshold: policy.ignoreMaxCount,
            automaticProcessing: shouldProcess,
          },
        });
        return {
          studyId: retention.studyId,
          ignoredCount: retention.ignoredCount,
          shouldProcess,
        };
      });
      if (!outcome) continue;
      if (outcome.shouldProcess) await this.enqueueArchive(group.retentionId, now);
      ignoredSequences += 1;
    }
    return ignoredSequences;
  }

  async respond(
    notificationId: string,
    actor: RetentionActor,
    response: 'CANCEL' | 'DELETE',
  ): Promise<RetentionResponseResult> {
    const notification = await this.prisma.retentionNotification.findUnique({
      where: { id: notificationId },
      include: {
        study: { select: { id: true, hospitalId: true, retentionLocked: true } },
        retention: {
          select: {
            id: true,
            cancelCount: true,
            ignoredCount: true,
            retentionLocked: true,
            status: true,
          },
        },
      },
    });
    if (!notification) throw new NotFoundException(`Notification ${notificationId} not found`);
    this.assertRecipient(notification.recipientUserId, notification.study.hospitalId, actor);
    if (notification.respondedAt) {
      throw new ConflictException('Retention notification already has a response');
    }
    if (notification.study.retentionLocked || notification.retention.retentionLocked) {
      throw new ForbiddenException('Retention decision is locked');
    }

    const policy = retentionPolicy();
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const responded = await tx.retentionNotification.updateMany({
        where: { id: notification.id, respondedAt: null },
        data: {
          response,
          respondedAt: now,
          readAt: now,
          deliveryStatus: 'RESPONDED',
        },
      });
      if (responded.count !== 1) {
        throw new ConflictException('Retention notification already has a response');
      }
      if (notification.appNotificationId) {
        await tx.notification.updateMany({
          where: { id: notification.appNotificationId },
          data: { readAt: now },
        });
      }
      const current = await tx.studyRetention.update({
        where: { id: notification.retentionId, retentionLocked: false },
        data: response === 'CANCEL' ? { cancelCount: { increment: 1 } } : {},
        select: { cancelCount: true, ignoredCount: true, status: true },
      });
      const cancelCount = current.cancelCount;
      let shouldProcess = response === 'DELETE' || cancelCount >= policy.cancelMaxCount;
      let status = shouldProcess
        ? RetentionStatus.AUTOMATIC_PROCESSING
        : RetentionStatus.CANCELLED_DEFERRED;
      let nextActionAt = shouldProcess
        ? now
        : new Date(now.getTime() + policy.cancelReminderDays * MS_PER_DAY);
      if (shouldProcess) {
        await tx.studyRetention.update({
          where: { id: notification.retentionId },
          data: { status: RetentionStatus.AUTOMATIC_PROCESSING, nextActionAt },
        });
      } else {
        const deferred = await tx.studyRetention.updateMany({
          where: {
            id: notification.retentionId,
            cancelCount: { lt: policy.cancelMaxCount },
            status: {
              in: [
                RetentionStatus.PENDING_RETENTION,
                RetentionStatus.AWAITING_USER_RESPONSE,
                RetentionStatus.CANCELLED_DEFERRED,
                RetentionStatus.NOTIFICATION_IGNORED,
              ],
            },
            retentionLocked: false,
          },
          data: { status: RetentionStatus.CANCELLED_DEFERRED, nextActionAt },
        });
        if (!deferred.count) {
          const latest = await tx.studyRetention.findUnique({
            where: { id: notification.retentionId },
            select: { cancelCount: true, status: true },
          });
          if (
            latest?.status === RetentionStatus.AUTOMATIC_PROCESSING ||
            (latest && latest.cancelCount >= policy.cancelMaxCount)
          ) {
            shouldProcess = true;
            status = RetentionStatus.AUTOMATIC_PROCESSING;
            nextActionAt = now;
            await tx.studyRetention.update({
              where: { id: notification.retentionId },
              data: { status: RetentionStatus.AUTOMATIC_PROCESSING, nextActionAt: now },
            });
          }
        }
      }
      await this.audit.recordTx(tx, {
        studyId: notification.studyId,
        retentionId: notification.retentionId,
        action: response === 'CANCEL' ? 'DELETION_CANCELLED' : 'AUTOMATIC_DELETION_TRIGGERED',
        triggeredBy: 'USER',
        actor,
        status: 'SUCCESS',
        details: {
          notificationId,
          response,
          cancelCount,
          threshold: policy.cancelMaxCount,
          automaticProcessing: shouldProcess,
        },
      });
      return {
        cancelCount,
        ignoredCount: current.ignoredCount,
        status,
        nextActionAt,
        shouldProcess,
      };
    });
    if (outcome.shouldProcess) await this.enqueueArchive(notification.retentionId, now);

    return {
      notificationId,
      response,
      retentionStatus: outcome.status as unknown as RetentionResponseResult['retentionStatus'],
      cancelCount: outcome.cancelCount,
      ignoredCount: outcome.ignoredCount,
      nextActionAt: outcome.nextActionAt.toISOString(),
    };
  }

  async list(actor: RetentionActor, limit = 100) {
    const where: Prisma.RetentionNotificationWhereInput =
      actor.role === UserRole.ADMIN
        ? {}
        : actor.role === UserRole.MANAGER
          ? { study: { hospitalId: actor.hospitalId ?? '__axis_no_hospital__' } }
          : { recipientUserId: actor.id };
    const rows = await this.prisma.retentionNotification.findMany({
      where,
      take: Math.min(Math.max(limit, 1), 200),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        studyId: true,
        study: {
          select: {
            status: true,
            studyInstanceUid: true,
            accessionNumber: true,
            hospital: { select: { name: true } },
            reports: {
              select: { status: true },
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
        },
        sequenceNumber: true,
        sentAt: true,
        responseDeadline: true,
        respondedAt: true,
        response: true,
        deliveryStatus: true,
        retention: {
          select: { cancelCount: true, ignoredCount: true, nextActionAt: true },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      studyId: row.studyId,
      studyInstanceUid: row.study.studyInstanceUid,
      accessionNumber: row.study.accessionNumber,
      hospitalName: row.study.hospital.name,
      reportStatus: row.study.reports[0]?.status ?? row.study.status,
      sequenceNumber: row.sequenceNumber,
      sentAt: row.sentAt?.toISOString() ?? null,
      responseDeadline: row.responseDeadline?.toISOString() ?? null,
      scheduledDeletionAt: row.retention.nextActionAt?.toISOString() ?? null,
      respondedAt: row.respondedAt?.toISOString() ?? null,
      response: row.response,
      deliveryStatus: row.deliveryStatus,
      cancelCount: row.retention.cancelCount,
      ignoredCount: row.retention.ignoredCount,
    }));
  }

  private async recipients(hospitalId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        status: 'APPROVED',
        OR: [
          { role: UserRole.ADMIN },
          { role: UserRole.MANAGER, hospitalId },
          { role: UserRole.HOSPITAL, hospitalId },
        ],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return users.map((user) => user.id);
  }

  private assertRecipient(
    recipientUserId: string,
    studyHospitalId: string,
    actor: RetentionActor,
  ): void {
    if (recipientUserId !== actor.id) {
      throw new ForbiddenException('Only the notification recipient may respond');
    }
    if (actor.role !== UserRole.ADMIN && actor.hospitalId !== studyHospitalId) {
      throw new ForbiddenException('You cannot respond to another hospital’s retention notice');
    }
  }

  private async enqueueArchive(retentionId: string, now: Date): Promise<void> {
    await this.jobs.enqueue({
      type: RetentionJobType.PROCESS_ARCHIVE,
      dedupeKey: `retention-archive:${retentionId}`,
      dueAt: now,
      retentionId,
      payload: { retentionId },
    });
  }
}
