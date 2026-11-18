import { Injectable, UnauthorizedException, ForbiddenException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { sanitizeUser } from '../common/sanitize-user.js';
import { AuditService } from '../audit/audit.service.js';
import { isProduction } from '../common/config/env-validation.js';
import {
  SESSION_COOKIE,
  sessionSecret,
  sessionExpirySeconds,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_ALGORITHM,
  DUMMY_PASSWORD_HASH,
  type AuthenticatedUser,
} from './auth.constants.js';
import { sessionRevocationStore } from './session-store.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { PasswordResetEmailService } from './password-reset-email.service.js';
import { logger } from '../common/observability/structured-logger.js';
import type { RegisterDto, ApproveRequestDto, RejectRequestDto, ResetPasswordDto } from './auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly resetEmail: PasswordResetEmailService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.requestedRole === UserRole.ADMIN) {
      throw new BadRequestException(
        'The Administrator role cannot be self-assigned during registration',
      );
    }
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      // Do not reveal whether the account is PENDING vs already active; both
      // cases collapse to the same generic response so callers cannot enumerate.
      throw new ConflictException(
        'An account with this email already exists. If you need help, contact the administrator.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase().trim(),
          displayName: dto.displayName.trim(),
          phone: dto.phone,
          organization: dto.organization,
          licenseNumber: dto.licenseNumber,
          requestedRole: dto.requestedRole,
          role: dto.requestedRole,
          status: UserStatus.PENDING,
          isActive: true,
          passwordHash,
        },
      });
    } catch (err) {
      // Race between the existence check and the create (unique email).
      if ((err as { code?: string })?.code === 'P2002') {
        throw new ConflictException(
          'An account with this email already exists. If you need help, contact the administrator.',
        );
      }
      throw err;
    }

    await this.audit
      .create({
        actorId: user.id,
        actorName: user.displayName,
        actorRole: user.role,
        action: 'USER_CREATED',
        resource: 'USER',
        resourceId: user.id,
        metadata: { source: 'registration' },
      })
      .catch(() => {});

    return { data: sanitizeUser(user) };
  }

  async login(
    dto: { email: string; password: string },
    request: Request,
    response: Response,
  ) {
    const email = dto.email.toLowerCase().trim();
    const loginLimit = await this.rateLimit.assertLoginAllowed(request, email, response);
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      await this.rateLimit.recordFailedLogin(loginLimit.keys, loginLimit.windowSeconds);
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.rateLimit.recordFailedLogin(loginLimit.keys, loginLimit.windowSeconds);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== UserStatus.APPROVED || !user.isActive) {
      // One generic message for PENDING/REJECTED/SUSPENDED so the response does
      // not leak account state or the admin-written rejection reason.
      throw new ForbiddenException(
        'Your account is currently not active. Please contact the administrator.',
      );
    }

    const jti = randomUUID();
    const token = jwt.sign(
      { sub: user.id, email: user.email, authVersion: user.authVersion },
      sessionSecret(),
      {
        algorithm: JWT_ALGORITHM,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: sessionExpirySeconds(),
        jwtid: jti,
      },
    );
    sessionRevocationStore.register(jti, user.id);
    await this.rateLimit.resetLoginAccountCounter(email);

    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction(),
      maxAge: sessionExpirySeconds() * 1000,
      path: '/',
    });

    await this.audit
      .create({
        actorId: user.id,
        actorName: user.displayName,
        actorRole: user.role,
        action: 'LOGIN',
        resource: 'AUTH',
        resourceId: user.id,
      })
      .catch(() => {});

    return { data: sanitizeUser(user) };
  }

  async forgotPassword(emailInput: string, request: Request, response: Response) {
    const email = emailInput.toLowerCase().trim();
    await this.rateLimit.assertRecoveryAllowed(request, 'forgot', email, response);

    if (!this.resetEmail.isConfigured()) {
      logger.error('password_reset_email_not_configured');
      return { data: { message: 'If an account exists for that email, password reset instructions will be sent.' } };
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true, isActive: true },
    });
    if (!user || user.status !== UserStatus.APPROVED || !user.isActive) {
      return { data: { message: 'If an account exists for that email, password reset instructions will be sent.' } };
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + this.passwordResetTtlMs());
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.create({
        data: { tokenHash, userId: user.id, expiresAt },
      });
    });

    try {
      await this.resetEmail.sendPasswordReset(email, token);
    } catch (error) {
      logger.error('password_reset_email_delivery_failed', {
        message: error instanceof Error ? error.message : 'Unknown email delivery error',
      });
      try {
        await this.prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
      } catch (cleanupError) {
        logger.error('password_reset_token_cleanup_failed', {
          message:
            cleanupError instanceof Error
              ? cleanupError.message
              : 'Unknown reset-token cleanup error',
        });
      }
    }

    return { data: { message: 'If an account exists for that email, password reset instructions will be sent.' } };
  }

  async resetPassword(dto: ResetPasswordDto, request: Request, response: Response) {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    await this.rateLimit.assertRecoveryAllowed(request, 'reset', tokenHash, response);
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { email: true } },
      },
    });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
      throw new BadRequestException('Reset token is invalid or expired');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException('Reset token is invalid or expired');
      }

      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: now },
      });
    });
    sessionRevocationStore.revokeAllForUser(resetToken.userId);
    await this.rateLimit.resetLoginAccountCounter(resetToken.user.email);

    return { data: { success: true } };
  }

  private passwordResetTtlMs(): number {
    const minutes = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 20);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 30) {
      throw new Error('PASSWORD_RESET_TOKEN_TTL_MINUTES must be an integer from 15 to 30');
    }
    return minutes * 60 * 1000;
  }

  async me(user: AuthenticatedUser) {
    const full = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!full) throw new UnauthorizedException('User no longer exists');
    if (full.status !== UserStatus.APPROVED || !full.isActive) {
      throw new UnauthorizedException('Account is not active');
    }
    return { data: sanitizeUser(full) };
  }

  async logout(response: Response) {
    sessionRevocationStore.revokeFromResponse(response);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    return { data: { success: true } };
  }

  async listRegistrationRequests(status?: string) {
    const validStatus = Object.values(UserStatus).includes(status as UserStatus)
      ? (status as UserStatus)
      : undefined;

    const requests = await this.prisma.user.findMany({
      where: validStatus ? { status: validStatus } : {},
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        organization: true,
        licenseNumber: true,
        requestedRole: true,
        role: true,
        status: true,
        hospitalId: true,
        rejectionReason: true,
        createdAt: true,
        approvedAt: true,
        approvedById: true,
      },
    });

    return { data: requests };
  }

  async approveRegistrationRequest(
    id: string,
    dto: ApproveRequestDto,
    admin: AuthenticatedUser,
  ) {
    if (dto.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Administrator promotion is restricted to the trusted administrative process',
      );
    }
    const request = await this.prisma.user.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Registration request not found');
    if (request.status !== UserStatus.PENDING) {
      throw new ConflictException(
        `Request is no longer pending (current status: ${request.status})`,
      );
    }

    const hospitalId =
      dto.role === UserRole.HOSPITAL
        ? await this.resolveHospitalId(dto.hospitalId ?? request.hospitalId)
        : null;

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.APPROVED,
        role: dto.role,
        // A hospital link only means anything for a HOSPITAL account; carrying a
        // stale one onto a radiologist/manager silently widens what they can see
        // if the role is ever changed back.
        hospitalId,
        isActive: true,
        approvedAt: new Date(),
        approvedById: admin.id,
        rejectionReason: null,
      },
    });

    await this.audit
      .create({
        actorId: admin.id,
        actorName: admin.displayName,
        actorRole: admin.role,
        action: 'USER_UPDATED',
        resource: 'USER',
        resourceId: id,
        metadata: {
          action: 'REGISTRATION_APPROVED',
          finalRole: dto.role,
          hospitalId,
        },
      })
      .catch(() => {});

    return { data: sanitizeUser(updated) };
  }

  /**
   * Resolves the hospital a HOSPITAL account must be bound to at approval time.
   * An unset or dangling id is a hard error rather than a silent null, because
   * the alternative is an account that can log in but can never load data.
   */
  private async resolveHospitalId(hospitalId?: string | null): Promise<string> {
    if (!hospitalId) {
      throw new BadRequestException(
        'A hospital must be selected when approving a hospital account',
      );
    }
    const hospital = await this.prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { id: true, isActive: true },
    });
    if (!hospital) {
      throw new BadRequestException('hospitalId does not reference a known hospital');
    }
    if (!hospital.isActive) {
      throw new BadRequestException('Cannot link the account to an inactive hospital');
    }
    return hospital.id;
  }

  async rejectRegistrationRequest(
    id: string,
    dto: RejectRequestDto,
    admin: AuthenticatedUser,
  ) {
    const request = await this.prisma.user.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Registration request not found');
    if (request.status !== UserStatus.PENDING) {
      throw new ConflictException(
        `Request is no longer pending (current status: ${request.status})`,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.REJECTED,
        isActive: false,
        rejectionReason: dto.reason?.trim() || null,
      },
    });

    await this.audit
      .create({
        actorId: admin.id,
        actorName: admin.displayName,
        actorRole: admin.role,
        action: 'USER_UPDATED',
        resource: 'USER',
        resourceId: id,
        metadata: { action: 'REGISTRATION_REJECTED', reason: dto.reason },
      })
      .catch(() => {});

    return { data: sanitizeUser(updated) };
  }
}