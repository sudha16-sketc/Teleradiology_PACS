import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RetentionJobType } from '@prisma/client';
import { retentionPolicy } from './retention-config.js';
import { RetentionJobService } from './retention-job.service.js';
import { RetentionService } from './retention.service.js';

@Injectable()
export class RetentionSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId = `retention-worker-${randomUUID()}`;
  private running = false;

  constructor(
    private readonly jobs: RetentionJobService,
    private readonly retention: RetentionService,
  ) {}

  onModuleInit(): void {
    const policy = retentionPolicy();
    if (!policy.schedulerEnabled) return;
    const intervalMs = this.intervalMs();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Retention scheduler enabled (interval ${Math.round(intervalMs / 60000)}m, dryRun=${policy.dryRun})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ claimed: number; processed: number; failed: number }> {
    if (this.running) return { claimed: 0, processed: 0, failed: 0 };
    this.running = true;
    try {
      await this.jobs.recoverExpiredLeases();
      await this.enqueueRecurringJobs();
      let claimed = 0;
      let processed = 0;
      let failed = 0;
      for (let index = 0; index < 5; index += 1) {
        const job = await this.jobs.claim(this.workerId);
        if (!job) break;
        claimed += 1;
        try {
          await this.retention.processJob(job);
          await this.jobs.complete(job.id);
          processed += 1;
        } catch (error) {
          await this.jobs.fail(job.id, error);
          failed += 1;
          this.logger.warn(
            `Retention job ${job.id} failed: ${
              error instanceof Error ? error.message.slice(0, 500) : 'unknown error'
            }`,
          );
        }
      }
      return { claimed, processed, failed };
    } finally {
      this.running = false;
    }
  }

  private intervalMs(): number {
    const raw = Number(process.env.RETENTION_SCHEDULER_INTERVAL_MINUTES ?? '15');
    const minutes = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 1440) : 15;
    return minutes * 60 * 1000;
  }

  private async enqueueRecurringJobs(): Promise<void> {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const hour = day + 'T' + String(now.getUTCHours()).padStart(2, '0');
    await this.jobs.enqueue({
      type: RetentionJobType.START_RETENTION,
      dedupeKey: `retention-lifecycle:${day}`,
      dueAt: now,
      payload: { day },
    });
    await this.jobs.enqueue({
      type: RetentionJobType.SEND_NOTIFICATION,
      dedupeKey: `retention-notifications:${hour}`,
      dueAt: now,
      payload: { hour },
    });
    await this.jobs.enqueue({
      type: RetentionJobType.MARK_IGNORED,
      dedupeKey: `retention-ignored:${hour}`,
      dueAt: now,
      payload: { hour },
    });
    await this.jobs.enqueue({
      type: RetentionJobType.DELETE_EXPIRED_BACKUPS,
      dedupeKey: `retention-backup-cleanup:${day}`,
      dueAt: now,
      payload: { day },
    });
  }
}
