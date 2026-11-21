import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { RetentionCronGuard } from './retention-cron.guard.js';
import {
  RetentionSchedulerService,
  type RetentionTickResult,
} from './retention-scheduler.service.js';

@Controller('internal/retention')
@UseGuards(RetentionCronGuard)
export class RetentionCronController {
  constructor(private readonly scheduler: RetentionSchedulerService) {}

  @Public()
  @Post('tick')
  @HttpCode(HttpStatus.OK)
  async tick(): Promise<{
    data: RetentionTickResult & { accepted: boolean };
    meta: { triggeredAt: string };
  }> {
    const result = await this.scheduler.tick();
    return {
      data: { ...result, accepted: !result.skipped },
      meta: { triggeredAt: new Date().toISOString() },
    };
  }
}
