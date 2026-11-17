import { Controller, Get, Post, Body } from '@nestjs/common';
import { SlaService } from './sla.service.js';
import { SaveSlaConfigDto } from './dto/save-sla-config.dto.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.constants.js';

@Controller('sla')
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  @Get('overview')
  @Roles('ADMIN', 'MANAGER')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.sla.operationalOverview(user);
  }

  @Get('config')
  @Roles('ADMIN', 'MANAGER')
  config() {
    return this.sla.getConfig();
  }

  @Post('config')
  @Roles('ADMIN')
  saveConfig(@Body() dto: SaveSlaConfigDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sla.saveConfig(dto.priority, dto.minutes, user.id, user.displayName ?? user.role);
  }
}
