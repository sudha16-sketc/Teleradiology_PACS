import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

function hasHistoryInput(value: DicomHistorySubmissionDto): boolean {
  return (
    value.patientName !== undefined ||
    value.patientAge !== undefined ||
    value.gender !== undefined ||
    value.clinicalHistory !== undefined ||
    value.referringPhysician !== undefined
  );
}

export class DicomHistorySubmissionDto {
  @ValidateIf(hasHistoryInput)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  patientName?: string;

  @ValidateIf(hasHistoryInput)
  @Transform(({ value }) =>
    value === undefined ? undefined : value === '' ? Number.NaN : Number(value),
  )
  @IsInt()
  @Min(0)
  @Max(130)
  patientAge?: number;

  @ValidateIf(hasHistoryInput)
  @IsIn(['M', 'F', 'O', 'U'] as const)
  gender?: 'M' | 'F' | 'O' | 'U';

  @ValidateIf(hasHistoryInput)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(10000)
  clinicalHistory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referringPhysician?: string;
}

export interface StudyHistoryForm {
  patientName: string;
  patientAge: number;
  gender: 'M' | 'F' | 'O' | 'U';
  clinicalHistory: string;
  referringPhysician?: string;
}

export function normalizeHistorySubmission(
  dto?: DicomHistorySubmissionDto,
): StudyHistoryForm | undefined {
  if (!dto) return undefined;
  if (!hasHistoryInput(dto)) return undefined;

  if (
    !dto.patientName?.trim() ||
    dto.patientAge === undefined ||
    !dto.gender ||
    !dto.clinicalHistory?.trim()
  ) {
    throw new BadRequestException(
      'Patient name, age, gender, and clinical history are required',
    );
  }

  return {
    patientName: dto.patientName.trim(),
    patientAge: dto.patientAge,
    gender: dto.gender,
    clinicalHistory: dto.clinicalHistory.trim(),
    referringPhysician: dto.referringPhysician?.trim() || undefined,
  };
}
