import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { orthancBaseUrl } from '../common/config/orthanc-url.js';
import { log } from '../common/observability/structured-logger.js';
import { RedisService } from '../redis/redis.service.js';
import type { HealthComponent, HealthReport } from '@axis/types';

function orthancAuthHeader(): Record<string, string> {
  const u = process.env.ORTHANC_USERNAME;
  const p = process.env.ORTHANC_PASSWORD;
  if (u && p) {
    return { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` };
  }
  return {};
}

function orthancHealthTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.AXIS_ORTHANC_HEALTH_TIMEOUT_MS ?? '5000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<HealthReport & { ready: boolean }> {
    const components: HealthComponent[] = [];

    const pgStart = process.hrtime.bigint();
    let pgUp = true;
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch {
      pgUp = false;
    }
    const pgMs = Number(process.hrtime.bigint() - pgStart) / 1e6;
    components.push({
      name: 'postgresql',
      status: pgUp ? 'up' : 'down',
      latencyMs: Math.round(pgMs),
    });

    const redisProbe = await this.redis.probe();
    components.push({
      name: 'redis',
      status: redisProbe.up ? 'up' : 'down',
      latencyMs: redisProbe.latencyMs,
    });

    const orthStart = process.hrtime.bigint();
    let orthUp = true;
    try {
      const res = await fetch(`${orthancBaseUrl()}/system`, {
        headers: orthancAuthHeader(),
        signal: AbortSignal.timeout(orthancHealthTimeoutMs()),
      });
      orthUp = res.ok;
      if (!orthUp) {
        log('warn', 'orthanc_health_unexpected_status', { upstreamStatus: res.status });
      }
    } catch (err) {
      orthUp = false;
      log('warn', 'orthanc_health_unreachable', {
        errorName: (err as Error)?.name ?? 'UnknownError',
      });
    }
    const orthMs = Number(process.hrtime.bigint() - orthStart) / 1e6;
    components.push({
      name: 'orthanc',
      status: orthUp ? 'up' : 'down',
      latencyMs: Math.round(orthMs),
    });

    // Sessions cannot be validated without Redis, so an API instance with no
    // Redis connection must not receive protected traffic. Liveness stays
    // independent to avoid restart loops during a Redis outage.
    const ready = pgUp && redisProbe.up;
    return {
      status: ready && orthUp ? 'ok' : 'degraded',
      ready,
      components,
      timestamp: new Date().toISOString(),
    };
  }
}
