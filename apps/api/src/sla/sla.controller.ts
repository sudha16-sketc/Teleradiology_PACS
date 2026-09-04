import { Controller, Get, Post, Body } from '@nestjs/common';
import { SlaService } from './sla.service.js';
import { SaveSlaConfigDto } from './dto/save-sla-config.dto.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';

interface RequestUser {
  id: string;
  role: string;
  displayName?: string;
}

@Controller('sla')
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  @Get('overview')
  @Roles('ADMIN', 'MANAGER')
  overview() {
    return this.sla.operationalOverview();
  }

  @Get('config')
  @Roles('ADMIN', 'MANAGER')
  config() {
    return this.sla.getConfig();
  }

  @Post('config')
  @Roles('ADMIN')
  saveConfig(@Body() dto: SaveSlaConfigDto, @CurrentUser() user: RequestUser) {
    return this.sla.saveConfig(dto.priority, dto.minutes, user.id, user.displayName ?? user.role);
  }
}
