import {
  All,
  Controller,
  Get,
  Head,
  MethodNotAllowedException,
  Options,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { DicomWebService, type DicomWebUser } from './dicomweb.service.js';

const READ_ONLY_DICOMWEB_PATHS = [
  'studies',
  'studies/:studyUid',
  'studies/:studyUid/series',
  'studies/:studyUid/series/:seriesUid',
  'studies/:studyUid/series/:seriesUid/instances',
  'studies/:studyUid/series/:seriesUid/instances/:instanceUid',
  'studies/:studyUid/series/:seriesUid/instances/:instanceUid/frames/:frameNumber',
  'series',
  'series/:seriesUid',
  'instances',
  'instances/:instanceUid',
  'availability/:studyUid',
];

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

  @Options(READ_ONLY_DICOMWEB_PATHS)
  options(@Req() request: Request, @CurrentUser() user: DicomWebUser) {
    this.dicomwebService.assertGatewaySession(request, user);
  }

  @All(READ_ONLY_DICOMWEB_PATHS)
  rejectMutation(
    @Req() request: Request,
    @CurrentUser() user: DicomWebUser,
  ): never {
    this.dicomwebService.assertGatewaySession(request, user);
    throw new MethodNotAllowedException(
      'Only read DICOMweb operations are supported through this proxy',
    );
  }
}
