import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SESSION_COOKIE,
  IS_PUBLIC_KEY,
  sessionSecret,
} from './auth.constants.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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
    }>();
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Not authenticated');

    let payload: { sub: string };
    try {
      payload = jwt.verify(token, sessionSecret()) as { sub: string };
    } catch {
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
      },
    });

    if (!user) throw new UnauthorizedException('User no longer exists');
    if (user.status !== 'APPROVED' || !user.isActive) {
      throw new UnauthorizedException('Account is not active');
    }

    request.user = user;
    return true;
  }
}