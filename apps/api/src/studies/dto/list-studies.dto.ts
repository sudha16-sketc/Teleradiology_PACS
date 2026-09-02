import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import type { StudyStatus, StudyPriority, Modality } from '@axis/types';

export class ListStudiesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsEnum(['NEW', 'SUBMITTED', 'VALIDATED', 'UNASSIGNED', 'ASSIGNED', 'IN_READING', 'DRAFT_REPORT', 'FINAL', 'AMENDED', 'DELIVERED', 'CANCELLED'] as const)
  status?: StudyStatus;

  @IsOptional()
  @IsString()
  modality?: Modality;

  @IsOptional()
  @IsString()
  hospitalId?: string;

  @IsOptional()
  @IsEnum(['STAT', 'URGENT', 'ROUTINE'] as const)
  priority?: StudyPriority;

  @IsOptional()
  @IsString()
  search?: string;
}
