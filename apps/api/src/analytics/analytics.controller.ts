import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { Roles } from '../auth/auth.decorators.js';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @Roles('ADMIN', 'MANAGER')
  overview() {
    return this.analyticsService.overview();
  }

  @Get('tat')
  @Roles('ADMIN', 'MANAGER')
  tatDistribution() {
    return this.analyticsService.tatDistribution();
  }

  @Get('hospital-performance')
  @Roles('ADMIN', 'MANAGER')
  hospitalPerformance() {
    return this.analyticsService.hospitalPerformance();
  }
}
