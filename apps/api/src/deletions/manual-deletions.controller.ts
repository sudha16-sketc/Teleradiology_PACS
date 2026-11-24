import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { UserRole } from '@prisma/client';
import {
  DeleteStudiesDto,
  ListDeletedDto,
  PurgeArchiveDto,
} from './dto/manual-deletion.dto.js';
import { ManualDeletionsService } from './manual-deletions.service.js';

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string | null;
  displayName?: string;
}

function requiredId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) {
    throw new BadRequestException('Invalid archive id');
  }
  return id;
}

@Controller('manual-deletions')
@Roles('ADMIN', 'MANAGER')
export class ManualDeletionsController {
  constructor(private readonly deletions: ManualDeletionsService) {}

  @Post('studies')
  deleteStudies(
    @Body() dto: DeleteStudiesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.deletions.deleteStudies(dto.studyInstanceUids, user);
  }

  @Get()
  list(
    @Query() query: ListDeletedDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.deletions.list(query, user);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.deletions.restore(requiredId(id), user);
  }

  @Post(':id/purge')
  @Roles('ADMIN')
  purge(
    @Param('id') id: string,
    @Body() dto: PurgeArchiveDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.deletions.purge(requiredId(id), user, dto.confirmArchiveId);
  }
}
