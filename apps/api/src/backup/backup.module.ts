import { Module } from '@nestjs/common';
import { BackupService } from './backup.service.js';
import { BackupController } from './backup.controller.js';
import { AuditModule } from '../audit/audit.module.js';
import { BACKUP_STORAGE, createBackupStorage } from './backup-storage.js';
import { resolveBackupEnv } from './backup-ops.js';

@Module({
  imports: [AuditModule],
  controllers: [BackupController],
  providers: [
    BackupService,
    {
      provide: BACKUP_STORAGE,
      useFactory: () => createBackupStorage(resolveBackupEnv()),
    },
  ],
  exports: [BackupService],
})
export class BackupModule {}
