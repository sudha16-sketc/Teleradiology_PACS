import { IsNotEmpty, IsOptional, IsString, IsInt, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCorrectionRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason for the correction is required' })
  @MaxLength(2000)
  reason!: string;
}

export class RejectCorrectionDto {
  @IsString()
  @IsNotEmpty({ message: 'A resolution is required to reject a correction request' })
  @MaxLength(2000)
  resolution!: string;
}

export class ListCorrectionsQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
