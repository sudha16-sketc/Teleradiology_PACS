import { IsEnum } from 'class-validator';
import { BackupType } from '@prisma/client';

export class StartBackupDto {
  @IsEnum(BackupType)
  type!: BackupType;
}
