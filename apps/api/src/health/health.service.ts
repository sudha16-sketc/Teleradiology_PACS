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

function dicomwebProbeUrl(studyUid?: string): string {
  const base = `${orthancBaseUrl()}/dicom-web/studies`;
  return studyUid
    ? `${base}?StudyInstanceUID=${encodeURIComponent(studyUid)}`
    : `${base}?limit=1`;
}

function orthancPluginsProbeUrl(): string {
  return `${orthancBaseUrl()}/plugins`;
}

function pluginName(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const record = item as Record<string, unknown>;
  return [
    record.Name,
    record.name,
    record.ID,
    record.id,
    record.Plugin,
    record.plugin,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

function hasDicomWebPlugin(body: unknown): boolean {
  const values = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { plugins?: unknown }).plugins)
      ? ((body as { plugins: unknown[] }).plugins)
      : [];
  return values.some((item) => /dicom-web/i.test(pluginName(item)));
}

function qidoStudyUid(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const element = (item as Record<string, { Value?: unknown[] } | undefined>)['0020000D'];
  const value = element?.Value?.[0];
  return typeof value === 'string' ? value : undefined;
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

    let probeStudyUid: string | undefined;
    if (pgUp) {
      try {
        const study = await this.prisma.study.findFirst({
          where: {
            OR: [
              { seriesCount: { gt: 0 } },
              { instanceCount: { gt: 0 } },
              { series: { some: {} } },
              { instances: { some: {} } },
            ],
          },
          select: { studyInstanceUid: true },
          orderBy: { createdAt: 'desc' },
        });
        probeStudyUid = study?.studyInstanceUid;
      } catch (err) {
        log('warn', 'orthanc_health_expected_study_lookup_failed', {
          errorName: (err as Error)?.name ?? 'UnknownError',
        });
      }
    }

    const dicomwebStart = process.hrtime.bigint();
    let dicomwebUp = true;
    try {
      const res = await fetch(dicomwebProbeUrl(probeStudyUid), {
        headers: { ...orthancAuthHeader(), Accept: 'application/dicom+json' },
        signal: AbortSignal.timeout(orthancHealthTimeoutMs()),
      });
      dicomwebUp = res.ok;
      if (!dicomwebUp) {
        log('warn', 'orthanc_dicomweb_health_unexpected_status', { upstreamStatus: res.status });
        await res.body?.cancel();
      } else {
        const body = await res.json().catch(() => null);
        if (!Array.isArray(body)) {
          dicomwebUp = false;
          log('warn', 'orthanc_dicomweb_health_unexpected_response');
        } else if (probeStudyUid) {
          const matched = body.some((item) => qidoStudyUid(item) === probeStudyUid);
          if (!matched) {
            dicomwebUp = false;
            log('warn', 'orthanc_dicomweb_archive_mismatch');
          }
        }
      }
    } catch (err) {
      dicomwebUp = false;
      log('warn', 'orthanc_dicomweb_health_unreachable', {
        errorName: (err as Error)?.name ?? 'UnknownError',
      });
    }

    try {
      const res = await fetch(orthancPluginsProbeUrl(), {
        headers: orthancAuthHeader(),
        signal: AbortSignal.timeout(orthancHealthTimeoutMs()),
      });
      if (!res.ok) {
        dicomwebUp = false;
        log('warn', 'orthanc_plugins_health_unexpected_status', { upstreamStatus: res.status });
      } else {
        const body = await res.json().catch(() => null);
        if (!hasDicomWebPlugin(body)) {
          dicomwebUp = false;
          log('warn', 'orthanc_dicomweb_plugin_missing');
        }
      }
    } catch (err) {
      dicomwebUp = false;
      log('warn', 'orthanc_plugins_health_unreachable', {
        errorName: (err as Error)?.name ?? 'UnknownError',
      });
    }
    const dicomwebMs = Number(process.hrtime.bigint() - dicomwebStart) / 1e6;
    components.push({
      name: 'dicomweb',
      status: dicomwebUp ? 'up' : 'down',
      latencyMs: Math.round(dicomwebMs),
    });

    // Sessions cannot be validated without Redis, so an API instance with no
    // Redis connection must not receive protected traffic. Liveness stays
    // independent to avoid restart loops during a Redis outage.
    const ready = pgUp && redisProbe.up;
    return {
      status: ready && orthUp && dicomwebUp ? 'ok' : 'degraded',
      ready,
      components,
      timestamp: new Date().toISOString(),
    };
  }
}
