import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

type LimitScope = 'login' | 'recovery';
type LimitIdentity = { scope: string; value: string };

@Injectable()
export class AuthRateLimitService {
  private cleanupCounter = 0;
  private readonly hashSecret =
    process.env.AUTH_SECRET ?? 'axis-development-auth-rate-limit-key';

  constructor(private readonly prisma: PrismaService) {}

  private key(scope: string, value: string): string {
    return createHmac('sha256', this.hashSecret)
      .update(`${scope}:${value}`)
      .digest('hex');
  }

  private clientIp(request: Request): string {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  private limit(scope: LimitScope): { max: number; windowSeconds: number } {
    const recovery = scope === 'recovery';
    const max = Number(
      process.env[recovery ? 'AUTH_RECOVERY_MAX_REQUESTS' : 'AUTH_LOGIN_MAX_ATTEMPTS'] ??
        (recovery ? 5 : 10),
    );
    const windowSeconds = Number(
      process.env[recovery ? 'AUTH_RECOVERY_WINDOW_SECONDS' : 'AUTH_LOGIN_WINDOW_SECONDS'] ??
        900,
    );
    if (
      !Number.isInteger(max) ||
      max < 1 ||
      !Number.isInteger(windowSeconds) ||
      windowSeconds < 1
    ) {
      throw new Error(`Invalid ${recovery ? 'recovery' : 'login'} rate-limit configuration`);
    }
    return { max, windowSeconds };
  }

  private identities(
    request: Request,
    scope: LimitScope,
    identifier: string,
    kind?: 'forgot' | 'reset',
  ): LimitIdentity[] {
    const suffix = kind ? `:${kind}` : '';
    return [
      { scope: `${scope}${suffix}:ip`, value: this.clientIp(request) },
      { scope: `${scope}${suffix}:identifier`, value: identifier },
    ];
  }

  private async assertNotLimited(
    keys: string[],
    max: number,
    response: Response,
  ): Promise<void> {
    const records = await this.prisma.authRateLimit.findMany({
      where: { key: { in: keys } },
      select: { count: true, resetAt: true },
    });
    const now = Date.now();
    const blockedUntil = records
      .filter((record) => record.resetAt.getTime() > now && record.count >= max)
      .reduce((latest, record) => Math.max(latest, record.resetAt.getTime()), 0);

    if (blockedUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
      response.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async increment(key: string, windowSeconds: number): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "AuthRateLimit" ("key", "count", "resetAt")
      VALUES (${key}, 1, NOW() + (${windowSeconds} * INTERVAL '1 second'))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "AuthRateLimit"."resetAt" <= NOW() THEN 1
          ELSE "AuthRateLimit"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "AuthRateLimit"."resetAt" <= NOW()
            THEN NOW() + (${windowSeconds} * INTERVAL '1 second')
          ELSE "AuthRateLimit"."resetAt"
        END
    `;

    this.cleanupCounter += 1;
    if (this.cleanupCounter % 500 === 0) {
      await this.prisma.authRateLimit.deleteMany({
        where: { resetAt: { lt: new Date() } },
      });
    }
  }

  async assertLoginAllowed(request: Request, email: string, response: Response) {
    const options = this.limit('login');
    const keys = this.identities(request, 'login', email).map(({ scope, value }) =>
      this.key(scope, value),
    );
    await this.assertNotLimited(keys, options.max, response);
    return {
      keys,
      windowSeconds: options.windowSeconds,
    };
  }

  async recordFailedLogin(keys: string[], windowSeconds: number): Promise<void> {
    await Promise.all(keys.map((key) => this.increment(key, windowSeconds)));
  }

  async resetLoginAccountCounter(email: string): Promise<void> {
    await this.prisma.authRateLimit.deleteMany({
      where: { key: this.key('login:identifier', email) },
    });
  }

  async assertRecoveryAllowed(
    request: Request,
    kind: 'forgot' | 'reset',
    identifier: string,
    response: Response,
  ): Promise<void> {
    const options = this.limit('recovery');
    const keys = this.identities(request, 'recovery', identifier, kind).map(
      ({ scope, value }) => this.key(scope, value),
    );
    await this.assertNotLimited(keys, options.max, response);
    await Promise.all(keys.map((key) => this.increment(key, options.windowSeconds)));
  }
}
