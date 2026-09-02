import { Controller, Get, Param, Query } from '@nestjs/common';
import { AIService } from './ai.service.js';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

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
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  studyId?: string;
}

@Controller('ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Get('jobs')
  listJobs(@Query() dto: ListAIJobsDto) {
    return this.aiService.listJobs(dto);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.aiService.getJob(id);
  }
}
