import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { Modality, Subspecialty } from '@prisma/client';

export class CreateTemplateDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(Object.values(Modality) as string[])
  modality?: Modality;

  @IsOptional()
  @IsIn(Object.values(Subspecialty) as string[])
  subspecialty?: Subspecialty;

  @IsOptional()
  @IsString()
  bodyPart?: string;

  @IsOptional()
  @IsString()
  clinicalHistory?: string;

  @IsOptional()
  @IsString()
  findings?: string;

  @IsOptional()
  @IsString()
  impression?: string;

  @IsOptional()
  @IsString()
  technique?: string;

  @IsOptional()
  @IsString()
  comparison?: string;

  @IsOptional()
  @IsString()
  recommendations?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}