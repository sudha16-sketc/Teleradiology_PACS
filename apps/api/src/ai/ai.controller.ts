import { Controller, Get, Param, Query } from '@nestjs/common';
import { AIJobStatus, UserRole } from '@prisma/client';
import { AIService } from './ai.service.js';
import { IsOptional, IsString, IsInt, Min, IsEnum, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.constants.js';

class ListAIJobsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsEnum(AIJobStatus)
  status?: AIJobStatus;

  @IsOptional()
  @IsString()
  studyId?: string;
}

@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.RADIOLOGIST)
@Controller('ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Get('jobs')
  listJobs(@Query() dto: ListAIJobsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.aiService.listJobs(dto, user);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.aiService.getJob(id, user);
  }
}