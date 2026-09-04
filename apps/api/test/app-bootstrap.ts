import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { correlationMiddleware } from '../src/common/observability/correlation.middleware.js';

// Prisma maps BIGINT columns (e.g. BackupRun.sizeBytes) to JS BigInt, which
// JSON.stringify cannot serialize. Keep responses JSON-safe in the test harness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function createTestApp(): Promise<{
  app: INestApplication;
  server: unknown;
}> {
  // abortOnError:false keeps a bootstrap error from process.exit() killing
  // the Jest worker; the error is instead thrown up to the test suite.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });

  app.enableCors({ origin: true, credentials: true });
  app.use(cookieParser());
  app.use(correlationMiddleware);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.init();

  const server = app.getHttpServer();
  return { app, server };
}
