import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { assertRequiredEnv } from './common/config/env-validation.js';
import {
  correlationMiddleware,
  requestLoggingMiddleware,
} from './common/observability/correlation.middleware.js';
import { securityHeadersMiddleware } from './common/security/security-headers.middleware.js';
import { rateLimit } from './common/security/rate-limit.middleware.js';
import { logger } from './common/observability/structured-logger.js';

/**
 * Derive the list of allowed frontend origins from CORS_ORIGIN. Credentials are
 * only enabled for a concrete allow-list of origins. An unrestricted '*' origin
 * is supported only without credentials (never both).
 */
function resolveCors() {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    return { origin: true, credentials: false };
  }
  return { origin: origins, credentials: true };
}

async function bootstrap() {
  // Prisma maps BIGINT columns (e.g. BackupRun.sizeBytes) to JS BigInt, which
  // JSON.stringify cannot serialize. Serialize them as strings so API responses
  // remain valid JSON regardless of which Prisma fields surface as BigInt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };

  // Fail fast in production if mandatory configuration is missing.
  assertRequiredEnv();

  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.use(correlationMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(requestLoggingMiddleware);

  // Targeted abuse protection. In-process limiter (see rate-limit module notes).
  // Disabled under NODE_ENV=test so the automated suite is unaffected.
  const rl = (name: string, windowMs: number, max: number) =>
    rateLimit({ windowMs, max, name });
  app.use('/api/auth/login', rl('login', 15 * 60 * 1000, 100));
  app.use('/api/auth/register', rl('register', 60 * 60 * 1000, 20));
  app.use('/api/dicom/ingest', rl('dicom_upload', 60 * 1000, 20));
  app.use('/api/studies/:uid/correction-requests', rl('correction_request', 60 * 60 * 1000, 50));
  app.use('/api/corrections/:id/approve', rl('correction_approve', 60 * 60 * 1000, 100));
  app.use('/api/corrections/:id/reject', rl('correction_reject', 60 * 60 * 1000, 100));

  const cors = resolveCors();
  app.enableCors({
    origin: cors.origin,
    credentials: cors.credentials,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // Signal-based graceful shutdown: stops accepting new connections and lets
  // PrismaService.onModuleDestroy close the database pool cleanly.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  logger.info('axis_api_started', { port, env: process.env.NODE_ENV ?? 'development' });
}

bootstrap().catch((err) => {
  logger.error('axis_api_bootstrap_failed', {
    message: (err as Error)?.message,
    stack: (err as Error)?.stack,
  });
  process.exit(1);
});
