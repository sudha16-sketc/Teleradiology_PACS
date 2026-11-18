import { Module } from '@nestjs/common';
import { DicomWebController } from './dicomweb.controller.js';
import { DicomWebService } from './dicomweb.service.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [DicomWebController],
  providers: [DicomWebService],
  exports: [DicomWebService],
})
export class DicomWebModule {}
