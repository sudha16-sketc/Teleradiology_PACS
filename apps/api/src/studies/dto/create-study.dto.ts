import {
  IsString,
  IsOptional,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type { Modality, StudyPriority, Subspecialty } from '@axis/types';

export class CreateStudyDto {
  // Patient
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  patientName!: string;

  @Transform(({ value }) => value === undefined ? undefined : value === '' ? Number.NaN : Number(value))
  @IsInt()
  @Min(0)
  @Max(130)
  patientAge!: number;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsIn(['M', 'F', 'O', 'U'] as const)
  gender!: 'M' | 'F' | 'O' | 'U';

  @IsOptional()
  @IsDateString()
  patientBirthDate?: string;

  // Study
  @IsOptional()
  @IsString()
  studyInstanceUid?: string;

  @IsOptional()
  @IsString()
  accessionNumber?: string;

  @IsOptional()
  @IsIn(['CT', 'MRI', 'XR', 'US', 'NM', 'PET', 'MG', 'DX', 'CR', 'Fluoro'] as const)
  modality?: Modality;

  @IsOptional()
  @IsString()
  bodyPart?: string;

  @IsOptional()
  @IsString()
  referringPhysician?: string;

  @IsOptional()
  @IsString()
  studyDescription?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(10000)
  clinicalHistory!: string;

  @IsOptional()
  @IsIn(['STAT', 'URGENT', 'ROUTINE'] as const)
  priority?: StudyPriority;

  @IsOptional()
  @IsIn([
    'NEURO',
    'MSK',
    'CHEST',
    'ABDOMEN',
    'CARDIOVASCULAR',
    'MAMMOGRAPHY',
    'MUSCULOSKELETAL',
    'GENERAL',
    'PEDIATRIC',
    'ONCOLOGY',
    'INTERVENTIONAL',
  ] as const)
  subspecialty?: Subspecialty;

  @IsOptional()
  @IsDateString()
  studyDate?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
