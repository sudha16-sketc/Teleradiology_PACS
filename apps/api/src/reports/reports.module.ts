import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { ReportImagesController } from './report-images.controller.js';
import { ReportImagesService } from './report-images.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { StudiesModule } from '../studies/studies.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { CorrectionsModule } from '../corrections/corrections.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuditModule, StudiesModule, ReviewsModule, CorrectionsModule],
  controllers: [ReportsController, ReportImagesController],
  providers: [ReportsService, ReportImagesService],
  exports: [ReportsService],
})
export class ReportsModule {}
