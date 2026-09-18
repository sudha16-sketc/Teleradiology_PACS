import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { sanitizeUser } from '../common/sanitize-user.js';
import { UserRole, UserStatus } from '@prisma/client';

interface ListUsersParams {
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  page?: string;
  pageSize?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(dto: {
    displayName: string;
    email: string;
    role: UserRole;
    password: string;
    phone?: string;
    organization?: string;
    licenseNumber?: string;
    hospitalId?: string;
    subspecialty?: string;
  }) {
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
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

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

    return { data: sanitizeUser(updated) };
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    await this.prisma.user.delete({ where: { id } });
    return { data: { success: true } };
  }
}