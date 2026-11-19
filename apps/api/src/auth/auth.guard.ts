import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service.js';
import { SESSION_COOKIE, IS_PUBLIC_KEY, sessionSecret } from './auth.constants.js';
import { jwtVerifyOptions, sessionRevocationStore } from './session-store.js';
import { RedisSessionService, type StoredSession } from '../redis/redis-session.service.js';
import { RedisUnavailableError } from '../redis/redis-client.interface.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly sessions: RedisSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      cookies?: Record<string, string | undefined>;
      user?: unknown;
      session?: StoredSession;
    }>();
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Not authenticated');

    let payload: { sub: string; jti?: string; email?: string; authVersion?: number };
    try {
      payload = jwt.verify(token, sessionSecret(), jwtVerifyOptions()) as {
        sub: string;
        jti?: string;
        email?: string;
        authVersion?: number;
      };
    } catch {
      throw new UnauthorizedException('Session expired or invalid');
    }
    if (!payload.jti) throw new UnauthorizedException('Session expired or invalid');

    // Local revocation is defense in depth; Redis is the shared authority for
    // every API replica. Neither check ever trusts browser-supplied identity.
    if (sessionRevocationStore.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    let session: StoredSession;
    try {
      session = await this.sessions.validate(payload.jti);
    } catch (error) {
      if (error instanceof RedisUnavailableError) {
        // Fail closed: a Redis outage must never become unauthenticated access.
        throw new ServiceUnavailableException('Session store temporarily unavailable');
      }
      throw new UnauthorizedException('Session expired or invalid');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        isActive: true,
        hospitalId: true,
        authVersion: true,
      },
    });

    if (!user) throw new UnauthorizedException('User no longer exists');
    if ((payload.authVersion ?? 0) !== user.authVersion) {
      throw new UnauthorizedException('Session expired or invalid');
    }
    if (user.status !== 'APPROVED' || !user.isActive) {
      throw new UnauthorizedException('Account is not active');
    }
    this.sessions.assertMatches(session, user);

    request.user = user;
    request.session = session;
    return true;
  }
}
