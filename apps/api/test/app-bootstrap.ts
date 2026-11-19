import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { correlationMiddleware } from '../src/common/observability/correlation.middleware.js';
import { limitUploadBody } from '../src/common/security/upload-size.middleware.js';
import { REDIS_CLIENT, type RedisCommands } from '../src/redis/redis-client.interface.js';

// Prisma maps BIGINT columns (e.g. BackupRun.sizeBytes) to JS BigInt, which
// JSON.stringify cannot serialize. Keep responses JSON-safe in the test harness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/** In-memory double for the Redis command surface. Tests must not depend on a
 * running Redis server; the provider is replaced before Nest instantiates any
 * auth, health or cache service. */
export function createInMemoryRedisClient(): RedisCommands {
  type Entry = { value: string; expiresAt?: number };
  const values = new Map<string, Entry>();
  const sets = new Map<string, Set<string>>();
  const setExpiries = new Map<string, number>();

  const dropExpired = (key: string): void => {
    const entry = values.get(key);
    if (entry?.expiresAt && entry.expiresAt <= Date.now()) values.delete(key);
    const expiry = setExpiries.get(key);
    if (expiry && expiry <= Date.now()) {
      sets.delete(key);
      setExpiries.delete(key);
    }
  };

  return {
    async connect() {
      return 'OK';
    },
    async get(key) {
      dropExpired(key);
      return values.get(key)?.value ?? null;
    },
    async set(key, value, _mode, ttlSeconds) {
      values.set(key, {
        value,
        expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined,
      });
      return 'OK';
    },
    async del(...keys) {
      let removed = 0;
      for (const key of keys) {
        dropExpired(key);
        if (values.delete(key)) removed += 1;
        if (sets.delete(key) || setExpiries.delete(key)) removed += 1;
      }
      return removed;
    },
    async sadd(key, ...members) {
      dropExpired(key);
      const set = sets.get(key) ?? new Set<string>();
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added += 1;
        }
      }
      sets.set(key, set);
      return added;
    },
    async srem(key, ...members) {
      dropExpired(key);
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const member of members) {
        if (set.delete(member)) removed += 1;
      }
      return removed;
    },
    async smembers(key) {
      dropExpired(key);
      return [...(sets.get(key) ?? [])];
    },
    async expire(key, ttlSeconds) {
      dropExpired(key);
      const expiry = Date.now() + ttlSeconds * 1000;
      const entry = values.get(key);
      if (entry) {
        entry.expiresAt = expiry;
        return 1;
      }
      if (sets.has(key)) {
        setExpiries.set(key, expiry);
        return 1;
      }
      return 0;
    },
    async incr(key) {
      dropExpired(key);
      const next = Number(values.get(key)?.value ?? 0) + 1;
      values.set(key, { value: String(next) });
      return next;
    },
    async ping() {
      return 'PONG';
    },
    async quit() {
      return 'OK';
    },
    disconnect() {
      values.clear();
      sets.clear();
      setExpiries.clear();
    },
  };
}

export async function createTestApp(): Promise<{
  app: INestApplication;
  server: unknown;
}> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS_CLIENT)
    .useValue(createInMemoryRedisClient())
    .compile();

  // abortOnError:false keeps a bootstrap error from process.exit() killing
  // the Jest worker; the error is instead thrown up to the test suite.
  const app = moduleFixture.createNestApplication({
    logger: false,
    abortOnError: false,
  });

  app.enableCors({ origin: true, credentials: true });
  app.use(cookieParser());
  app.use(correlationMiddleware);
  app.use('/api/dicom/ingest', limitUploadBody);
  app.use('/api/dicom/reingest', limitUploadBody);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.init();

  const server = app.getHttpServer();
  return { app, server };
}
