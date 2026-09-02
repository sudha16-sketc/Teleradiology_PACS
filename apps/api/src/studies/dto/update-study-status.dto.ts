import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { StudyStatus } from '@axis/types';

export class UpdateStudyStatusDto {
  @IsEnum(['NEW', 'SUBMITTED', 'VALIDATED', 'UNASSIGNED', 'ASSIGNED', 'IN_READING', 'DRAFT_REPORT', 'FINAL', 'AMENDED', 'DELIVERED', 'CANCELLED'] as const)
  status!: StudyStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
