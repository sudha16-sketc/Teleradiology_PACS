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
import type { UserRole } from '@prisma/client';

/**
 * Clinical report content. Actor identity (author) is NEVER accepted here --
 * the authenticated session is authoritative and only the assigned radiologist
 * may write clinical content.
 */
class ReportContentDto {
  @IsOptional()
  @IsString()
  clinicalHistory?: string;

  @IsOptional()
  @IsString()
  findings?: string;

  @IsOptional()
  @IsString()
  impression?: string;

  @IsOptional()
  @IsString()
  technique?: string;

  @IsOptional()
  @IsString()
  comparison?: string;

  @IsOptional()
  @IsString()
  recommendations?: string;

  @IsOptional()
  @IsBoolean()
  criticalFinding?: boolean;
}

class ValidateDto {
  @IsIn(['SIGNED', 'DRAFT'] as const)
  status!: 'SIGNED' | 'DRAFT';

  @IsOptional()
  @IsString()
  reason?: string;
}

class ChangeRequestDto {
  @IsString()
  reason!: string;
}

class ChangeRequestRespondDto {
  @IsString()
  resolution!: string;
}

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @Roles('RADIOLOGIST', 'MANAGER', 'ADMIN', 'HOSPITAL')
  list(@CurrentUser() user: RequestUser) {
    return this.reportsService.list(user);
  }

  @Get('hospital')
  @Roles('HOSPITAL', 'MANAGER', 'ADMIN')
  hospitalReports(@CurrentUser() user: RequestUser) {
    return this.reportsService.hospitalReports(user);
  }

  @Get('change-requests')
  @Roles('RADIOLOGIST', 'MANAGER', 'ADMIN')
  changeRequests(@CurrentUser() user: RequestUser) {
    return this.reportsService.changeRequests(user);
  }

  @Get('hospital/:studyUid/pdf')
  @Roles('HOSPITAL', 'MANAGER', 'ADMIN')
  async hospitalPdf(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    await this.reportsService.hospitalPdf(studyUid, user, res);
  }

  @Get(':studyUid/versions')
  @Roles('RADIOLOGIST', 'MANAGER', 'ADMIN', 'HOSPITAL')
  versions(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.getVersions(studyUid, user);
  }

  @Get(':studyUid')
  @Roles('RADIOLOGIST', 'MANAGER', 'ADMIN', 'HOSPITAL')
  getByStudy(@Param('studyUid') studyUid: string, @CurrentUser() user: RequestUser) {
    return this.reportsService.getByStudy(studyUid, user);
  }

  @Post(':studyUid')
  @Roles('RADIOLOGIST')
  createOrUpdate(
    @Param('studyUid') studyUid: string,
    @Body() dto: ReportContentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.createOrUpdate(studyUid, dto, user);
  }

  @Patch(':studyUid/draft')
  @Roles('RADIOLOGIST')
  saveDraft(
    @Param('studyUid') studyUid: string,
    @Body() dto: ReportContentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.saveDraft(studyUid, dto, user);
  }

  @Post(':studyUid/sign')
  @Roles('RADIOLOGIST')
  signOff(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    // Signer identity is derived from the authenticated session, never from the
    // request body.
    return this.reportsService.signOff(studyUid, user);
  }

  @Post(':studyUid/amend')
  @Roles('RADIOLOGIST')
  amend(
    @Param('studyUid') studyUid: string,
    @Body() dto: ReportContentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.amend(studyUid, dto, user);
  }

  @Post(':studyUid/validate')
  @Roles('MANAGER', 'ADMIN')
  validate(
    @Param('studyUid') studyUid: string,
    @Body() dto: ValidateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.validate(studyUid, dto, user);
  }

  @Post(':studyUid/change-request')
  @Roles('MANAGER', 'ADMIN')
  requestChange(
    @Param('studyUid') studyUid: string,
    @Body() dto: ChangeRequestDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.requestChange(studyUid, dto, user);
  }

  @Post(':studyUid/verify')
  @Roles('MANAGER', 'ADMIN')
  verify(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.verify(studyUid, user);
  }

  @Post(':studyUid/release')
  @Roles('MANAGER', 'ADMIN')
  release(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.release(studyUid, user);
  }

  @Post(':studyUid/deliver')
  @Roles('MANAGER', 'ADMIN')
  deliver(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.deliver(studyUid, user);
  }

  @Post('change-requests/:id/respond')
  @Roles('RADIOLOGIST')
  respondChangeRequest(
    @Param('id') id: string,
    @Body() dto: ChangeRequestRespondDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportsService.respondChangeRequest(id, dto, user);
  }
}