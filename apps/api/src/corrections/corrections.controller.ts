import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { CorrectionsService } from './corrections.service.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import { CreateCorrectionRequestDto, RejectCorrectionDto } from './dto/corrections.dto.js';
import type { UserRole } from '@prisma/client';

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

/**
 * Study-scoped correction lifecycle endpoints. POST /studies/:uid/correction-requests
 * is the ONLY authorized way to move a study into the correction workflow; the
 * generic status PATCH cannot do so.
 */
@Controller('studies')
export class StudyCorrectionsController {
  constructor(private readonly correctionsService: CorrectionsService) {}

  @Post(':studyUid/correction-requests')
  @Roles('ADMIN', 'MANAGER', 'HOSPITAL')
  request(
    @Param('studyUid') studyUid: string,
    @Body() dto: CreateCorrectionRequestDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.correctionsService.request(studyUid, dto.reason, user);
  }

  @Post(':studyUid/corrections/begin')
  @Roles('RADIOLOGIST')
  begin(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.correctionsService.begin(studyUid, user);
  }
}

/**
 * Correction-request queue and manager review actions.
 */
@Controller('corrections')
export class CorrectionsController {
  constructor(private readonly correctionsService: CorrectionsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL')
  list(@CurrentUser() user: RequestUser) {
    return this.correctionsService.list(user);
  }

  @Post(':id/approve')
  @Roles('ADMIN', 'MANAGER')
  approve(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.correctionsService.approve(id, user);
  }

  @Post(':id/reject')
  @Roles('ADMIN', 'MANAGER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectCorrectionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.correctionsService.reject(id, dto.resolution, user);
  }
}
