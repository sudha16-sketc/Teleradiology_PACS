import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HealthComponent, HealthReport } from '@axis/types';

function orthancBase(): string {
  return (process.env.ORTHANC_URL ?? 'http://localhost:8042').replace(/\/+$/, '');
}

function orthancAuthHeader(): Record<string, string> {
  const u = process.env.ORTHANC_USERNAME;
  const p = process.env.ORTHANC_PASSWORD;
  if (u && p) {
    return { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` };
  }
  return {};
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

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

    const orthStart = process.hrtime.bigint();
    let orthUp = true;
    try {
      const res = await fetch(`${orthancBase()}/system`, {
        headers: orthancAuthHeader(),
        signal: AbortSignal.timeout(3000),
      });
      orthUp = res.ok;
    } catch {
      orthUp = false;
    }
    const orthMs = Number(process.hrtime.bigint() - orthStart) / 1e6;
    components.push({
      name: 'orthanc',
      status: orthUp ? 'up' : 'down',
      latencyMs: Math.round(orthMs),
    });

    const ready = pgUp && orthUp;
    return {
      status: ready ? 'ok' : 'degraded',
      ready,
      components,
      timestamp: new Date().toISOString(),
    };
  }
}
