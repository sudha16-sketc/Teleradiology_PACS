import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { DicomWebUser } from '../dicomweb/dicomweb.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import {
  ListReconciliationRunsDto,
  RunReconciliationDto,
} from './dto/reconciliation.dto.js';

@Controller('admin/dicom-reconciliation')
@Roles(UserRole.ADMIN)
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get()
  list(@Query() dto: ListReconciliationRunsDto) {
    return this.service.listRuns(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  @Post()
  run(@Body() dto: RunReconciliationDto, @CurrentUser() user: DicomWebUser) {
    return this.service.run(user, dto);
  }
}
