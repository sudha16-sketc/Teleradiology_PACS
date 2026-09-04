import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { StudiesModule } from '../studies/studies.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { CorrectionsModule } from '../corrections/corrections.module.js';

@Module({
  imports: [AuditModule, StudiesModule, ReviewsModule, CorrectionsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
