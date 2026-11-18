import { Module } from '@nestjs/common';
import { DicomController } from './dicom.controller.js';
import { DicomService } from './dicom.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { DicomWebModule } from '../dicomweb/dicomweb.module.js';

@Module({
  imports: [AuditModule, DicomWebModule],
  controllers: [DicomController],
  providers: [DicomService],
  exports: [DicomService],
})
export class DicomModule {}
