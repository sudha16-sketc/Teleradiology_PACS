import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { RetentionLockReason } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { RetentionResponseDto, RetentionHoldDto } from './dto/retention.dto.js';
import type { RetentionActor } from './retention-audit.service.js';
import { RetentionService } from './retention.service.js';

interface RequestUser {
  id: string;
  role: string;
  displayName?: string;
  email?: string;
  hospitalId?: string | null;
}

function actor(user: RequestUser): RetentionActor {
  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    email: user.email,
    hospitalId: user.hospitalId,
  };
}

function requiredId(value: string, label: string): string {
  if (!value || !value.trim()) throw new BadRequestException(`Missing ${label}`);
  return value.trim();
}

@Controller('admin/retention')
@Roles('ADMIN', 'MANAGER')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('preview')
  preview(@CurrentUser() user: RequestUser) {
    return this.retention.preview(actor(user));
  }

  @Post('execute')
  execute(@CurrentUser() user: RequestUser) {
    return this.retention.execute(actor(user));
  }

  @Get('jobs')
  jobs(@CurrentUser() user: RequestUser) {
    return this.retention.listJobs(actor(user));
  }

  @Post('jobs/:id/retry')
  retryJob(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.retention.retryJob(requiredId(id, 'job id'), actor(user));
  }

  @Post('holds/:studyId')
  async applyHold(
    @Param('studyId') studyId: string,
    @Body() body: RetentionHoldDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.retention.applyLegalHold(
      requiredId(studyId, 'study id'),
      actor(user),
      body.reason as RetentionLockReason,
      body.expiresAt ? new Date(body.expiresAt) : undefined,
    );
    return { data: { studyId, retentionLocked: true } };
  }

  @Delete('holds/:studyId')
  async releaseHold(
    @Param('studyId') studyId: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.retention.releaseLegalHold(requiredId(studyId, 'study id'), actor(user));
    return { data: { studyId, retentionLocked: false } };
  }
}

@Controller('retention/notifications')
export class RetentionNotificationController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'HOSPITAL')
  list(@CurrentUser() user: RequestUser) {
    return this.retention.listNotifications(actor(user));
  }

  @Post(':id/respond')
  @Roles('ADMIN', 'MANAGER', 'HOSPITAL')
  respond(
    @Param('id') id: string,
    @Body() body: RetentionResponseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.retention.respondNotification(requiredId(id, 'notification id'), actor(user), body.response);
  }
}
