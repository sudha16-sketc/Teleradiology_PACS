import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { StudiesService } from './studies.service.js';
import { ListStudiesDto } from './dto/list-studies.dto.js';
import { UpdateStudyStatusDto } from './dto/update-study-status.dto.js';
import { CreateStudyDto } from './dto/create-study.dto.js';
import { Roles } from '../auth/auth.decorators.js';
import { CurrentUser } from '../auth/auth.decorators.js';

interface RequestUser {
  id: string;
  role: string;
  hospitalId?: string;
}

@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Get()
  list(@Query() dto: ListStudiesDto, @CurrentUser() user: RequestUser) {
    return this.studiesService.list(dto, user);
  }

  @Get(':studyUid')
  getByUid(@Param('studyUid') studyUid: string, @CurrentUser() user: RequestUser) {
    return this.studiesService.getByUid(studyUid, user);
  }

  @Get(':studyUid/series')
  getSeries(@Param('studyUid') studyUid: string) {
    return this.studiesService.getSeries(studyUid);
  }

  @Get(':studyUid/priors')
  priors(@Param('studyUid') studyUid: string) {
    return this.studiesService.priors(studyUid);
  }

  @Roles('HOSPITAL_USER', 'COORDINATOR', 'ADMIN')
  @Post()
  submit(@Body() dto: CreateStudyDto, @CurrentUser() user: RequestUser) {
    return this.studiesService.submit(dto, user.hospitalId as string);
  }

  @Patch(':studyUid/status')
  updateStatus(
    @Param('studyUid') studyUid: string,
    @Body() dto: UpdateStudyStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.studiesService.updateStatus(studyUid, dto, user);
  }
}
