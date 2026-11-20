import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BackupModule } from '../backup/backup.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetentionArchiveService } from './retention-archive.service.js';
import { RetentionAuditService } from './retention-audit.service.js';
import {
  RetentionController,
  RetentionNotificationController,
} from './retention.controller.js';
import { RetentionEligibilityService } from './retention-eligibility.service.js';
import { RetentionJobService } from './retention-job.service.js';
import { RetentionNotificationService } from './retention-notification.service.js';
import { RetentionSchedulerService } from './retention-scheduler.service.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [AuditModule, BackupModule, NotificationsModule],
  controllers: [RetentionController, RetentionNotificationController],
  providers: [
    RetentionService,
    RetentionAuditService,
    RetentionEligibilityService,
    RetentionArchiveService,
    RetentionNotificationService,
    RetentionJobService,
    RetentionSchedulerService,
  ],
  exports: [RetentionService],
})
export class RetentionModule {}
