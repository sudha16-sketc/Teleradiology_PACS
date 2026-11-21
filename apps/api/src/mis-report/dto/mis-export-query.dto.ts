import { IsDateString, IsOptional } from 'class-validator';

export class MisExportQueryDto {
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}
