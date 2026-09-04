import { IsEnum, IsInt, Min } from 'class-validator';
import { SlaPriority } from '@prisma/client';

export class SaveSlaConfigDto {
  @IsEnum(SlaPriority)
  priority!: SlaPriority;

  @IsInt()
  @Min(1)
  minutes!: number;
}
