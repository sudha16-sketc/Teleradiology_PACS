import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class DeleteStudiesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  studyInstanceUids!: string[];
}

export class ListDeletedDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  recordType?: string;

  @IsOptional()
  @IsString()
  deletedBy?: string;

  @IsOptional()
  @IsIn([
    'ARCHIVING',
    'ARCHIVED',
    'RESTORING',
    'RESTORED',
    'PURGING',
    'PURGE_FAILED',
    'PURGED',
    'FAILED',
  ])
  status?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class PurgeArchiveDto {
  @IsString()
  confirmArchiveId!: string;
}
