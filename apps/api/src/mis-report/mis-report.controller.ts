import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.constants.js';
import { MisReportService } from './mis-report.service.js';
import { MisExportQueryDto } from './dto/mis-export-query.dto.js';

@Controller('reports/mis')
export class MisReportController {
  constructor(private readonly misReportService: MisReportService) {}

  @Get('export')
  @Roles('ADMIN', 'MANAGER')
  async export(
    @Query() query: MisExportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.misReportService.export(user, query, {
      ipAddress: request.ip || request.socket.remoteAddress || undefined,
      userAgent: request.headers['user-agent'],
    });

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    response.setHeader('Content-Length', String(result.buffer.length));
    response.setHeader('X-MIS-Row-Count', String(result.rowCount));
    response.setHeader('Cache-Control', 'no-store');
    response.send(result.buffer);
  }
}
