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
  role: string;
}

@Controller('worklist')
export class WorklistController {
  constructor(private readonly worklistService: WorklistService) {}

  @Get()
  list(@Query() dto: GetWorklistDto, @CurrentUser() user: RequestUser) {
    return this.worklistService.list(dto, user);
  }

  @Get('my')
  @Roles('RADIOLOGIST', 'COORDINATOR', 'ADMIN')
  my(@CurrentUser() user: RequestUser) {
    return this.worklistService.my(user.id, user.role);
  }

  @Post(':studyUid/assign')
  @Roles('COORDINATOR', 'ADMIN')
  assign(
    @Param('studyUid') studyUid: string,
    @Body() dto: AssignStudyDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.worklistService.assign(studyUid, dto.radiologistId, user.id);
  }
}
