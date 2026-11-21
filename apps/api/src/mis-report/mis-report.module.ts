import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { MisReportController } from './mis-report.controller.js';
import { MisReportService } from './mis-report.service.js';

@Module({
  imports: [AuditModule],
  controllers: [MisReportController],
  providers: [MisReportService],
  exports: [MisReportService],
})
export class MisReportModule {}
