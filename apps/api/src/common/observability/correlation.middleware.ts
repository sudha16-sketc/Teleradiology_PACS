import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { log } from './structured-logger.js';
import { requestContext } from './request-context.js';

export const CORRELATION_HEADER = 'x-request-id';
const WEB_REQUEST_ID = /^web-[0-9a-f]{16}$/i;
const UUID_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeRoutePath(request: Request): string {
  const route = (request as Request & { route?: { path?: unknown } }).route?.path;
  return typeof route === 'string'
    ? `${request.baseUrl}${route}`
    : '<unmatched-route>';
}

/**
 * Accepts only opaque IDs in the frontend's generated format or UUID form;
 * arbitrary header values could contain PHI or credentials and are replaced.
 * The ID is returned on the response and is available before any Nest guard.
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[CORRELATION_HEADER];
  const incomingValue = Array.isArray(incoming) ? incoming[0] : incoming;
  const candidate = typeof incomingValue === 'string' ? incomingValue.trim() : '';
  const id =
    WEB_REQUEST_ID.test(candidate) || UUID_REQUEST_ID.test(candidate)
      ? candidate
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
      path: safeRoutePath(req),
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
