import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { WorklistService } from './worklist.service.js';
import { IsOptional, IsString } from 'class-validator';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { UserRole } from '@prisma/client';

class GetWorklistDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  hospitalId?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  modality?: string;

  @IsOptional()
  @IsString()
  search?: string;

  [key: string]: string | undefined;
}

class AssignStudyDto {
  @IsString()
  radiologistId!: string;
}

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

@Controller('worklist')
export class WorklistController {
  constructor(private readonly worklistService: WorklistService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST')
  list(@Query() dto: GetWorklistDto, @CurrentUser() user: RequestUser) {
    return this.worklistService.list(dto, user);
  }

  @Get('radiologists')
  @Roles('MANAGER', 'ADMIN')
  radiologists(@CurrentUser() user: RequestUser) {
    return this.worklistService.radiologists();
  }

  @Get('my')
  @Roles('RADIOLOGIST', 'MANAGER', 'ADMIN', 'HOSPITAL')
  my(@CurrentUser() user: RequestUser) {
    return this.worklistService.my(user.id, user.role, user.hospitalId);
  }

  @Post(':studyUid/assign')
  @Roles('MANAGER', 'ADMIN')
  assign(
    @Param('studyUid') studyUid: string,
    @Body() dto: AssignStudyDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.worklistService.assign(studyUid, dto.radiologistId, user);
  }
}
