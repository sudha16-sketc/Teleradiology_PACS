import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class RetentionHoldDto {
  @IsEnum(['LEGAL_HOLD', 'ACTIVE_DISPUTE', 'HOSPITAL_RETENTION_REQUEST', 'PENDING_REPORT_DELIVERY', 'MANDATORY_RETENTION', 'INVESTIGATION'])
  reason!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class RetentionResponseDto {
  @IsEnum(['CANCEL', 'DELETE'])
  response!: 'CANCEL' | 'DELETE';
}
