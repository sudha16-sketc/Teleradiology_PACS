import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class HospitalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const hospitals = await this.prisma.hospital.findMany({
      orderBy: { name: 'asc' },
    });
    return { data: hospitals };
  }

  async getOne(id: string) {
    const hospital = await this.prisma.hospital.findUnique({
      where: { id },
      include: { sites: true },
    });
    if (!hospital) throw new NotFoundException(`Hospital ${id} not found`);
    return { data: hospital };
  }
}
