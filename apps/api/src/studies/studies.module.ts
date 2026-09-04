import { Module } from '@nestjs/common';
import { StudiesController } from './studies.controller.js';
import { StudiesService } from './studies.service.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [StudiesController],
  providers: [StudiesService],
  exports: [StudiesService],
})
export class StudiesModule {}
