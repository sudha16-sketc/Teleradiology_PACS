import { Module } from '@nestjs/common';
import { CorrectionsController, StudyCorrectionsController } from './corrections.controller.js';
import { CorrectionsService } from './corrections.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  controllers: [CorrectionsController, StudyCorrectionsController],
  providers: [CorrectionsService],
  exports: [CorrectionsService],
})
export class CorrectionsModule {}
