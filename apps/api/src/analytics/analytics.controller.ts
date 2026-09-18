import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.constants.js';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @Roles('ADMIN', 'MANAGER')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.overview(user);
  }

  @Get('tat')
  @Roles('ADMIN', 'MANAGER')
  tatDistribution(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.tatDistribution(user);
  }

  @Get('hospital-performance')
  @Roles('ADMIN', 'MANAGER')
  hospitalPerformance(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.hospitalPerformance(user);
  }
}