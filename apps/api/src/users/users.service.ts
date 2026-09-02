import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { sanitizeUser } from '../common/sanitize-user.js';
import { UserRole, UserStatus } from '@prisma/client';

interface ListUsersParams {
  search?: string;
  role?: UserRole;
  status?: UserStatus;
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
    return { data: users.map((u) => sanitizeUser(u)) };
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
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException(`User with email ${dto.email} already exists`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
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

    return { data: sanitizeUser(user) };
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

    const effectiveStatus = targetedStatus === UserStatus.SUSPENDED
      ? UserStatus.SUSPENDED
      : targetedStatus === UserStatus.APPROVED
        ? UserStatus.APPROVED
        : user.status;

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
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        status: effectiveStatus,
        ...(dto.status === UserStatus.SUSPENDED ? { isActive: false } : {}),
        ...(dto.status === UserStatus.APPROVED ? { isActive: true } : {}),
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