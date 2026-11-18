import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DicomWebModule } from '../dicomweb/dicomweb.module.js';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  imports: [AuditModule, DicomWebModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
