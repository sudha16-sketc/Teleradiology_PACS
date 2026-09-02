import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Res,
} from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import {
  IsOptional,
  IsString,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { Response } from 'express';

class CreateReportDto {
  @IsString()
  authorId!: string;

  @IsOptional()
  @IsString()
  findings?: string;

  @IsOptional()
  @IsString()
  impression?: string;

  @IsOptional()
  @IsString()
  recommendations?: string;

  @IsOptional()
  @IsBoolean()
  criticalFinding?: boolean;
}

class SignOffDto {
  @IsString()
  signedOffBy!: string;
}

class AmendDto {
  @IsString()
  authorId!: string;

  @IsString()
  findings!: string;

  @IsString()
  impression!: string;

  @IsOptional()
  @IsString()
  recommendations?: string;
}

class DraftDto {
  @IsString()
  authorId!: string;

  @IsOptional()
  @IsString()
  findings?: string;

  @IsOptional()
  @IsString()
  impression?: string;

  @IsOptional()
  @IsString()
  recommendations?: string;

  @IsOptional()
  @IsBoolean()
  criticalFinding?: boolean;
}

class ValidateDto {
  @IsIn(['FINAL', 'PENDING_SIGNOFF'] as const)
  status!: 'FINAL' | 'PENDING_SIGNOFF';

  @IsOptional()
  @IsString()
  reason?: string;
}

interface RequestUser {
  id: string;
  role: string;
  hospitalId?: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @Roles('RADIOLOGIST', 'COORDINATOR', 'ADMIN')
  list(@CurrentUser() user: RequestUser) {
    return this.reportsService.list(user);
  }

  @Get('hospital')
  @Roles('HOSPITAL_USER', 'COORDINATOR', 'ADMIN')
  hospitalReports(@CurrentUser() user: RequestUser) {
    return this.reportsService.hospitalReports(user);
  }

  @Get('hospital/:studyUid/pdf')
  @Roles('HOSPITAL_USER', 'COORDINATOR', 'ADMIN')
  async hospitalPdf(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    await this.reportsService.hospitalPdf(studyUid, user, res);
  }

  @Get(':studyUid')
  getByStudy(@Param('studyUid') studyUid: string, @CurrentUser() user: RequestUser) {
    return this.reportsService.getByStudy(studyUid, user);
  }

  @Post(':studyUid')
  @Roles('RADIOLOGIST', 'COORDINATOR', 'ADMIN')
  createOrUpdate(
    @Param('studyUid') studyUid: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.createOrUpdate(studyUid, dto);
  }

  @Patch(':studyUid/draft')
  @Roles('RADIOLOGIST', 'COORDINATOR', 'ADMIN')
  saveDraft(
    @Param('studyUid') studyUid: string,
    @Body() dto: DraftDto,
  ) {
    return this.reportsService.saveDraft(studyUid, dto);
  }

  @Post(':studyUid/sign')
  @Roles('RADIOLOGIST', 'COORDINATOR', 'ADMIN')
  signOff(
    @Param('studyUid') studyUid: string,
    @Body() dto: SignOffDto,
  ) {
    return this.reportsService.signOff(studyUid, dto.signedOffBy);
  }

  @Post(':studyUid/amend')
  @Roles('RADIOLOGIST', 'COORDINATOR', 'ADMIN')
  amend(
    @Param('studyUid') studyUid: string,
    @Body() dto: AmendDto,
  ) {
    return this.reportsService.amend(studyUid, dto);
  }

  @Post(':studyUid/validate')
  @Roles('COORDINATOR', 'ADMIN')
  validate(
    @Param('studyUid') studyUid: string,
    @Body() dto: ValidateDto,
  ) {
    return this.reportsService.validate(studyUid, dto);
  }
}
