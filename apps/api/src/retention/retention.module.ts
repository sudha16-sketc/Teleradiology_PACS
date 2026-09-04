import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service.js';
import { RetentionController } from './retention.controller.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [RetentionController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
