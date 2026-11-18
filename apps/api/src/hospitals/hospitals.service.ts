import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateHospitalDto } from './dto/create-hospital.dto.js';

@Injectable()
export class HospitalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const hospitals = await this.prisma.hospital.findMany({
      orderBy: { name: 'asc' },
    });
    return { data: hospitals };
  }

  async create(dto: CreateHospitalDto) {
    try {
      const hospital = await this.prisma.hospital.create({
        data: {
          name: dto.name.trim(),
          code: dto.code.trim().toUpperCase(),
          address: dto.address?.trim() || null,
          timezone: dto.timezone?.trim() || 'UTC',
        },
      });
      return { data: hospital };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A hospital with this code already exists.');
      }
      throw error;
    }
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
