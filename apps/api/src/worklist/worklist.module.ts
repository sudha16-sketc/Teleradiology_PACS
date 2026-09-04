import { Module } from '@nestjs/common';
import { WorklistController } from './worklist.controller.js';
import { WorklistService } from './worklist.service.js';
import { StudiesModule } from '../studies/studies.module.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [StudiesModule, AuditModule],
  controllers: [WorklistController],
  providers: [WorklistService],
})
export class WorklistModule {}
