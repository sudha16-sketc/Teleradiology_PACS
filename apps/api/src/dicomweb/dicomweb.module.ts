import { Module } from '@nestjs/common';
import { DicomWebController } from './dicomweb.controller.js';
import { DicomWebService } from './dicomweb.service.js';

@Module({
  controllers: [DicomWebController],
  providers: [DicomWebService],
})
export class DicomWebModule {}