import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { sanitizeUser } from '../common/sanitize-user.js';
import { UserRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.constants.js';

interface ListUsersParams {
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  page?: string;
  pageSize?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(params: ListUsersParams = {}) {
    const users = await this.prisma.user.findMany({
      where: {
        ...(params.role ? { role: params.role } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.search
          ? {
              OR: [
                { displayName: { contains: params.search, mode: 'insensitive' } },
                { email: { contains: params.search, mode: 'insensitive' } },
                { organization: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const page = Math.max(parseInt(params.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(params.pageSize ?? '20', 10) || 20, 1), 100);
    const take = pageSize;
    const skip = (page - 1) * pageSize;

    const [total, paged] = await Promise.all([
      this.prisma.user.count({ where: { /* cannot reuse; rebuild below */ } }),
      this.prisma.user.findMany({
        where: {
          ...(params.role ? { role: params.role } : {}),
          ...(params.status ? { status: params.status } : {}),
          ...(params.search
            ? {
                OR: [
                  { displayName: { contains: params.search, mode: 'insensitive' } },
                  { email: { contains: params.search, mode: 'insensitive' } },
                  { organization: { contains: params.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);

    const sanitized = paged.map((u) => sanitizeUser(u));
    return {
      data: sanitized,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return { data: sanitizeUser(user) };
  }

  async create(
    dto: {
      displayName: string;
      email: string;
      role: UserRole;
      password: string;
      phone?: string;
      organization?: string;
      licenseNumber?: string;
      hospitalId?: string;
      subspecialty?: string;
    },
    actor: AuthenticatedUser,
  ) {
    if (dto.role === UserRole.HOSPITAL && !dto.hospitalId) {
      throw new BadRequestException(
        'A hospital must be selected when creating a hospital account',
      );
    }
    if (dto.hospitalId) {
      const hospital = await this.prisma.hospital.findUnique({ where: { id: dto.hospitalId } });
      if (!hospital) {
        throw new BadRequestException('hospitalId does not reference a known hospital');
      }
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException(`User with email ${dto.email} already exists`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase().trim(),
          displayName: dto.displayName.trim(),
          role: dto.role,
          status: UserStatus.APPROVED,
          isActive: true,
          passwordHash,
          phone: dto.phone,
          organization: dto.organization,
          licenseNumber: dto.licenseNumber,
          hospitalId: dto.hospitalId,
          subspecialty: dto.subspecialty,
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        throw new ConflictException(`User with email ${dto.email} already exists`);
      }
      throw err;
    }

    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName,
      actorRole: actor.role,
      action: 'USER_CREATED',
      resource: 'USER',
      resourceId: user.id,
      metadata: {
        email: user.email,
        role: user.role,
        hospitalId: user.hospitalId,
      },
    });

    return { data: sanitizeUser(user) };
  }

  private async assertNotLastActiveAdmin(excludeUserId: string): Promise<void> {
    const count = await this.prisma.user.count({
      where: {
        role: UserRole.ADMIN,
        status: UserStatus.APPROVED,
        isActive: true,
        id: { not: excludeUserId },
      },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Cannot demote or deactivate the last active administrator',
      );
    }
  }

  async update(
    id: string,
    dto: {
      displayName?: string;
      role?: UserRole;
      phone?: string;
      organization?: string;
      licenseNumber?: string;
      hospitalId?: string;
      subspecialty?: string;
      isActive?: boolean;
      status?: UserStatus;
    },
    actor: AuthenticatedUser,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    // A HOSPITAL account is only usable while it is bound to a hospital, and an
    // unknown id would break every hospital-scoped query with a 403. Validate
    // before writing so the account can never be left unlinked or dangling.
    const effectiveRole = dto.role ?? user.role;
    const effectiveHospitalId =
      dto.hospitalId !== undefined ? dto.hospitalId || null : user.hospitalId;
    if (effectiveRole === UserRole.HOSPITAL) {
      if (!effectiveHospitalId) {
        throw new BadRequestException(
          'A hospital must be selected when the account has the Hospital role',
        );
      }
      const hospital = await this.prisma.hospital.findUnique({
        where: { id: effectiveHospitalId },
        select: { id: true, isActive: true },
      });
      if (!hospital) {
        throw new BadRequestException('hospitalId does not reference a known hospital');
      }
      if (!hospital.isActive) {
        throw new BadRequestException('Cannot link the account to an inactive hospital');
      }
    }

    const targetedStatus = dto.status;
    if (targetedStatus === UserStatus.PENDING || targetedStatus === UserStatus.REJECTED) {
      throw new BadRequestException(
        'Status can only be set to APPROVED or SUSPENDED from user management',
      );
    }

    // C11: a REJECTED (or PENDING) account must not be silently re-activated
    // out-of-band; it can only be re-approved through the audited approval flow.
    if (
      (user.status === UserStatus.REJECTED || user.status === UserStatus.PENDING) &&
      ((dto.status && dto.status !== user.status) || dto.isActive === true)
    ) {
      throw new BadRequestException(
        'Rejected or pending accounts can only be approved through the registration review flow',
      );
    }

    const effectiveStatus = targetedStatus === UserStatus.SUSPENDED
      ? UserStatus.SUSPENDED
      : targetedStatus === UserStatus.APPROVED
        ? UserStatus.APPROVED
        : user.status;

    const effectiveIsActive = targetedStatus === UserStatus.SUSPENDED
      ? false
      : targetedStatus === UserStatus.APPROVED
        ? true
        : dto.isActive !== undefined
          ? dto.isActive
          : user.isActive;

    // C10: never remove the last active administrator (demote or deactivate).
    const demoting = dto.role !== undefined && dto.role !== user.role && user.role === UserRole.ADMIN;
    const deactivating =
      (user.role === UserRole.ADMIN) &&
      (effectiveIsActive === false || effectiveStatus === UserStatus.SUSPENDED);
    if (user.role === UserRole.ADMIN && (demoting || deactivating)) {
      await this.assertNotLastActiveAdmin(user.id);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined && dto.displayName !== ''
          ? { displayName: dto.displayName.trim() }
          : {}),
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
        ...(dto.organization !== undefined ? { organization: dto.organization || null } : {}),
        ...(dto.licenseNumber !== undefined ? { licenseNumber: dto.licenseNumber || null } : {}),
        ...(dto.hospitalId !== undefined ? { hospitalId: dto.hospitalId || null } : {}),
        ...(dto.subspecialty !== undefined ? { subspecialty: dto.subspecialty || null } : {}),
        isActive: effectiveIsActive,
        status: effectiveStatus,
      },
    });

    // Record only the attributes that actually changed so the audit row states
    // what the administrator modified, not merely what they submitted.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const track = (field: string, from: unknown, to: unknown) => {
      if (from !== to) changes[field] = { from: from ?? null, to: to ?? null };
    };
    track('displayName', user.displayName, updated.displayName);
    track('role', user.role, updated.role);
    track('phone', user.phone, updated.phone);
    track('organization', user.organization, updated.organization);
    track('licenseNumber', user.licenseNumber, updated.licenseNumber);
    track('hospitalId', user.hospitalId, updated.hospitalId);
    track('subspecialty', user.subspecialty, updated.subspecialty);
    track('isActive', user.isActive, updated.isActive);
    track('status', user.status, updated.status);

    if (Object.keys(changes).length > 0) {
      await this.audit.create({
        actorId: actor.id,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'USER_UPDATED',
        resource: 'USER',
        resourceId: updated.id,
        metadata: { email: updated.email, changes },
      });
    }

    return { data: sanitizeUser(updated) };
  }

  async remove(id: string, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    await this.prisma.user.delete({ where: { id } });

    // resourceId is a plain column, so the trail survives the account removal.
    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName,
      actorRole: actor.role,
      action: 'USER_DELETED',
      resource: 'USER',
      resourceId: user.id,
      metadata: {
        email: user.email,
        role: user.role,
        hospitalId: user.hospitalId,
      },
    });

    return { data: { success: true } };
  }
}