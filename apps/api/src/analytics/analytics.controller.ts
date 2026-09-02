import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  overview() {
    return this.analyticsService.overview();
  }

  @Get('tat')
  tatDistribution() {
    return this.analyticsService.tatDistribution();
  }

  @Get('hospital-performance')
  hospitalPerformance() {
    return this.analyticsService.hospitalPerformance();
  }
}
