import { Module } from '@nestjs/common';
import { StudiesController } from './studies.controller.js';
import { StudiesService } from './studies.service.js';
import { StudyHistoryController } from './study-history.controller.js';
import { StudyHistoryService } from './study-history.service.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [StudiesController, StudyHistoryController],
  providers: [StudiesService, StudyHistoryService],
  exports: [StudiesService],
})
export class StudiesModule {}
