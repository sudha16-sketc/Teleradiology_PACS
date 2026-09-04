import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { log } from './structured-logger.js';
import { requestContext } from './request-context.js';

export const CORRELATION_HEADER = 'x-request-id';

/**
 * Generates (or accepts a valid) request correlation ID and ensures it is
 * returned on the response so that: frontend request -> API log -> audit event
 * can all be correlated by a single value. Runs as Express middleware before
 * any NestJS guard so the ID is also available when a guard throws.
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[CORRELATION_HEADER];
  const incomingValue = Array.isArray(incoming) ? incoming[0] : incoming;
  const id =
    typeof incomingValue === 'string' && incomingValue.trim().length
      ? incomingValue.trim().slice(0, 128)
      : randomUUID();

  (req as Request & { correlationId: string }).correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  requestContext.run({ correlationId: id }, () => next());
}

/**
 * Logs one structured record per request with the correlation ID, route,
 * method, status code, duration and (when authenticated) actor id. Safe fields
 * only.
 */
export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    const r = req as Request & { correlationId?: string; user?: { id?: string } };
    log('info', 'request', {
      correlationId: r.correlationId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Math.round(durMs),
      actorId: r.user?.id,
    });
  });
  next();
}

export function getCorrelationId(req: unknown): string | undefined {
  return (req as { correlationId?: string } | undefined)?.correlationId;
}
