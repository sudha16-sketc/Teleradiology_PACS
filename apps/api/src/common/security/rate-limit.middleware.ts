import type { Request, Response, NextFunction } from 'express';
import { log } from '../observability/structured-logger.js';

/**
 * Simple in-process fixed-window rate limiter keyed by client IP.
 *
 * This is intentionally a single-instance limiter (no external store such as
 * Redis). It is suitable for the current single-API-replica deployment and is
 * documented as a limitation: if multiple API replicas are run behind a load
 * balancer, an external store is required for an accurate aggregate limit.
 *
 * The limiter is disabled when NODE_ENV=test so the existing automated test
 * suite (which authenticates heavily from a single IP) is unaffected.
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const { windowMs, max, name } = opts;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    const record = hits.get(key);
    if (!record || record.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    record.count += 1;
    if (record.count > max) {
      log('warn', 'rate_limited', { name, key, count: record.count });
      res.setHeader('Retry-After', String(Math.ceil((record.resetAt - now) / 1000)));
      res.status(429).json({
        statusCode: 429,
        message: `Too many requests. Rate limit exceeded for ${name}.`,
        error: 'Too Many Requests',
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
      });
      return;
    }
    next();
  };
}
