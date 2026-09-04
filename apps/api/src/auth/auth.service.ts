import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { sanitizeUser } from '../common/sanitize-user.js';
import { AuditService } from '../audit/audit.service.js';
import {
  SESSION_COOKIE,
  sessionSecret,
  sessionExpirySeconds,
  DUMMY_PASSWORD_HASH,
  type AuthenticatedUser,
} from './auth.constants.js';
import type { RegisterDto, ApproveRequestDto, RejectRequestDto } from './auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
      if (existing.status === UserStatus.PENDING) {
        throw new ConflictException(
          'A registration request with this email is already awaiting approval',
        );
      }
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
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

  async login(dto: { email: string; password: string }, response: Response) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenException(
        'Your registration request is still awaiting administrator approval.',
      );
    }
    if (user.status === UserStatus.REJECTED) {
      const reason = user.rejectionReason?.trim();
      throw new ForbiddenException(
        reason
          ? `Your registration request has been rejected. Reason: ${reason}`
          : 'Your registration request has been rejected. Please contact the administrator.',
      );
    }
    if (user.status === UserStatus.SUSPENDED || !user.isActive) {
      throw new ForbiddenException(
        'Your account has been suspended. Please contact the administrator.',
      );
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      sessionSecret(),
      { expiresIn: sessionExpirySeconds() },
    );

    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
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

  async me(user: AuthenticatedUser) {
    const full = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!full) throw new UnauthorizedException('User no longer exists');
    if (full.status !== UserStatus.APPROVED || !full.isActive) {
      throw new UnauthorizedException('Account is not active');
    }
    return { data: sanitizeUser(full) };
  }

  async logout(response: Response) {
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
        status: UserStatus.APPROVED,
        role: dto.role,
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
        metadata: { action: 'REGISTRATION_APPROVED', finalRole: dto.role },
      })
      .catch(() => {});

    return { data: sanitizeUser(updated) };
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