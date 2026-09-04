import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';

class ListAuditDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  actorRole?: string;

  @IsOptional()
  @IsString()
  resource?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  studyUid?: string;

  @IsOptional()
  @IsString()
  hospitalId?: string;

  /** ISO date start bound (inclusive). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** ISO date end bound (exclusive). */
  @IsOptional()
  @IsDateString()
  to?: string;
}

interface RequestUser {
  id: string;
  role: string;
  hospitalId?: string;
}

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER')
  list(@Query() dto: ListAuditDto, @CurrentUser() user: RequestUser) {
    return this.auditService.list({ ...dto, user });
  }
}
