import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { TemplatesService } from './templates.service.js';
import { CreateTemplateDto } from './dto/create-template.dto.js';
import { UpdateTemplateDto } from './dto/update-template.dto.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { UserRole } from '@prisma/client';

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST')
  list(
    @CurrentUser() user: RequestUser,
    @Query('modality') modality?: string,
    @Query('subspecialty') subspecialty?: string,
    @Query('bodyPart') bodyPart?: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.templatesService.list(user, {
      modality,
      subspecialty,
      bodyPart,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      search,
    });
  }

  @Get('for-study/:studyUid')
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL')
  getForStudy(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templatesService.getForStudy(studyUid, user);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST')
  getById(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templatesService.getById(id, user);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST')
  create(
    @Body() dto: CreateTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templatesService.create(dto, user);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'RADIOLOGIST')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templatesService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  delete(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.templatesService.delete(id, user);
  }
}