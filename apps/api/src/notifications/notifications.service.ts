import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserRole } from '@prisma/client';

interface Actor {
  id: string;
  role: UserRole;
  hospitalId?: string;
}

export interface NotificationInput {
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  studyId?: string | null;
  correctionRequestId?: string | null;
}

/**
 * Application notifications for workflow events.
 *
 * - Recipients are ALWAYS derived server-side from workflow participants
 *   (role/hospital/assignment). The client never supplies a recipientUserId.
 * - A user can only read / mark-read their own notifications.
 * - Messages carry minimal metadata and never embed full report content.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: NotificationInput) {
    return this.prisma.notification.create({
      data: {
        recipientUserId: input.recipientUserId,
        type: input.type,
        title: input.title,
        message: input.message,
        studyId: input.studyId ?? null,
        correctionRequestId: input.correctionRequestId ?? null,
      },
    });
  }

  /**
   * Notify all active APPROVED MANAGER (operational reviewer) users.
   * Returns the number of notifications written.
   */
  async notifyManagers(
    input: Omit<NotificationInput, 'recipientUserId'>,
  ): Promise<number> {
    const managers = await this.prisma.user.findMany({
      where: { role: UserRole.MANAGER, isActive: true, status: 'APPROVED' },
      select: { id: true },
    });
    await this.prisma.notification.createMany({
      data: managers.map((m) => ({
        recipientUserId: m.id,
        type: input.type,
        title: input.title,
        message: input.message,
        studyId: input.studyId ?? null,
        correctionRequestId: input.correctionRequestId ?? null,
      })),
    });
    return managers.length;
  }

  /**
   * Notify all active APPROVED HOSPITAL users belonging to the given hospital.
   */
  async notifyHospital(
    hospitalId: string,
    input: Omit<NotificationInput, 'recipientUserId'>,
  ): Promise<number> {
    if (!hospitalId) return 0;
    const users = await this.prisma.user.findMany({
      where: {
        role: UserRole.HOSPITAL,
        hospitalId,
        isActive: true,
        status: 'APPROVED',
      },
      select: { id: true },
    });
    await this.prisma.notification.createMany({
      data: users.map((u) => ({
        recipientUserId: u.id,
        type: input.type,
        title: input.title,
        message: input.message,
        studyId: input.studyId ?? null,
        correctionRequestId: input.correctionRequestId ?? null,
      })),
    });
    return users.length;
  }

  async notifyRadiologist(
    radiologistId: string,
    input: Omit<NotificationInput, 'recipientUserId'>,
  ) {
    if (!radiologistId) return;
    await this.create({ ...input, recipientUserId: radiologistId });
  }

  async list(user: Actor, opts: { limit?: number } = {}) {
    const limit = opts.limit ?? 50;
    const items = await this.prisma.notification.findMany({
      where: { recipientUserId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const unread = await this.prisma.notification.count({
      where: { recipientUserId: user.id, readAt: null },
    });
    return { data: items, unread };
  }

  async markRead(id: string, user: Actor) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) throw new NotFoundException(`Notification ${id} not found`);
    if (notification.recipientUserId !== user.id) {
      throw new ForbiddenException('You can only read your own notifications');
    }
    if (notification.readAt) return { data: notification };
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return { data: updated };
  }

  async markAllRead(user: Actor) {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientUserId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { data: { updated: count } };
  }
}
