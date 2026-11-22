import { Controller, Get, Header, Logger, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { AnalyticsService } from './analytics.service.js';
import { MisReportService } from './mis-report.service.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.constants.js';

@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly misReportService: MisReportService,
  ) {}

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

  @Get('mis-report')
  @Roles('ADMIN', 'MANAGER')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header('Content-Disposition', 'attachment; filename="MIS-Report.xlsx"')
  @Header('Cache-Control', 'no-store')
  async misReport(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const artifact = await this.misReportService.generate(user);
    const stream = createReadStream(artifact.filePath);
    stream.once('close', () => {
      void artifact.cleanup().catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.error(`Unable to remove a streamed MIS export file: ${detail}`);
      });
    });
    return new StreamableFile(stream);
  }
}