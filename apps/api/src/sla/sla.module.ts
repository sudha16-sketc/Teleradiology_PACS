import { Module } from '@nestjs/common';
import { SlaService } from './sla.service.js';
import { SlaController } from './sla.controller.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [SlaController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
