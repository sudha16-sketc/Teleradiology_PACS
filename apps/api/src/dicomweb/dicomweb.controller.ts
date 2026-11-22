import {
  Controller,
  Get,
  Head,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { DicomWebService, type DicomWebUser } from './dicomweb.service.js';

@Controller('dicom-web')
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.RADIOLOGIST, UserRole.HOSPITAL)
export class DicomWebController {
  constructor(private readonly dicomwebService: DicomWebService) {}

  @Get('availability/:studyUid')
  async availability(
    @Req() request: Request,
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: DicomWebUser,
  ) {
    this.dicomwebService.assertGatewaySession(request, user);
    return {
      data: await this.dicomwebService.verifyStudyAvailability(user, studyUid),
    };
  }

  @Get('*')
  get(@Req() request: Request, @Res() response: Response) {
    return this.dicomwebService.proxy(request, 'GET', response);
  }

  @Head('*')
  head(@Req() request: Request, @Res() response: Response) {
    return this.dicomwebService.proxy(request, 'HEAD', response);
  }
}