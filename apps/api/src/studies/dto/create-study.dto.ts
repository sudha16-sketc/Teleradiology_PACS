import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsIn,
} from 'class-validator';
import type { Modality, StudyPriority, Subspecialty } from '@axis/types';

export class CreateStudyDto {
  // Patient
  @IsString()
  patientName!: string;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsIn(['M', 'F', 'O', 'U'] as const)
  gender?: 'M' | 'F' | 'O' | 'U';

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

  @IsOptional()
  @IsString()
  clinicalHistory?: string;

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
