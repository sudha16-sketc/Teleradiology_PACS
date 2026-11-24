import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BackupModule } from '../backup/backup.module.js';
import { ManualDeletionsController } from './manual-deletions.controller.js';
import { ManualDeletionsService } from './manual-deletions.service.js';

@Module({
  imports: [AuditModule, BackupModule],
  controllers: [ManualDeletionsController],
  providers: [ManualDeletionsService],
})
export class ManualDeletionsModule {}
