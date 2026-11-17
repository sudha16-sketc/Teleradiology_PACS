import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateCompanySettingsDto } from './company.dto.js';

const SETTINGS_ID = 'default';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const settings = await this.prisma.companySettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    return { data: settings };
  }

  async update(dto: UpdateCompanySettingsDto, actorId: string) {
    const settings = await this.prisma.companySettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        name: dto.name ?? '',
        phone: dto.phone ?? '',
        email: dto.email ?? '',
        description: dto.description ?? '',
        disclaimer: dto.disclaimer ?? '',
        updatedById: actorId,
      },
      update: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.disclaimer !== undefined
          ? { disclaimer: dto.disclaimer }
          : {}),
        updatedById: actorId,
      },
    });
    return { data: settings };
  }
}
