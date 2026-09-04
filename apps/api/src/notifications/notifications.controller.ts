import { Controller, Get, Post, Param, Body, NotFoundException, BadRequestException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { UserRole } from '@prisma/client';

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL')
  list(@CurrentUser() user: RequestUser) {
    return this.notificationsService.list(user);
  }

  @Get('unread-count')
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL')
  async unreadCount(@CurrentUser() user: RequestUser) {
    const { unread } = await this.notificationsService.list(user, { limit: 1 });
    return { data: { unread } };
  }

  @Post('read-all')
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL')
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.notificationsService.markAllRead(user);
  }

  @Post(':id/read')
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL')
  markRead(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    if (!id) throw new BadRequestException('Missing notification id');
    return this.notificationsService.markRead(id, user);
  }
}
