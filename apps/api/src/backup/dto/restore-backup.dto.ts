import { IsEnum, IsIn } from 'class-validator';
import { BackupType } from '@prisma/client';

export class RestoreBackupDto {
  @IsEnum(BackupType)
  type!: BackupType;

  @IsIn([true])
  confirm!: true;
}
