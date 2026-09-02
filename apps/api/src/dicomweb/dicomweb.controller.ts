import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Head,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/auth.decorators.js';
import { DicomWebService } from './dicomweb.service.js';

@Controller('dicom-web')
@Roles(UserRole.ADMIN, UserRole.COORDINATOR, UserRole.RADIOLOGIST)
export class DicomWebController {
  constructor(private readonly dicomwebService: DicomWebService) {}

  @Get('*')
  get(@Req() request: Request, @Res() response: Response) {
    return this.dicomwebService.proxy(request, 'GET', response);
  }

  @Head('*')
  head(@Req() request: Request, @Res() response: Response) {
    return this.dicomwebService.proxy(request, 'HEAD', response);
  }

  @Post('*')
  post(@Req() request: Request, @Res() response: Response) {
    return this.dicomwebService.proxy(request, 'POST', response);
  }

  @Put('*')
  put(@Req() request: Request, @Res() response: Response) {
    return this.dicomwebService.proxy(request, 'PUT', response);
  }

  @Delete('*')
  delete(@Req() request: Request, @Res() response: Response) {
    return this.dicomwebService.proxy(request, 'DELETE', response);
  }
}