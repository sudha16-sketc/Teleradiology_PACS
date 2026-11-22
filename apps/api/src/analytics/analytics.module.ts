import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { MisReportService } from './mis-report.service.js';
import { SlaModule } from '../sla/sla.module.js';

@Module({
  imports: [SlaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, MisReportService],
})
export class AnalyticsModule {}
