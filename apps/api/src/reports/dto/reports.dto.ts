import { IsOptional, IsString } from 'class-validator';

/**
 * Bounded list query carrier (C8). page/pageSize arrive as strings via the
 * query string (same carrier contract the corrections list thread proved);
 * the service clamps and coerces (cap 100) defensively.
 */
export class ListReportsQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
