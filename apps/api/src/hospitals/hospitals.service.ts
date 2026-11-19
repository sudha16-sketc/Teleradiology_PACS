import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateHospitalDto } from './dto/create-hospital.dto.js';
import { RedisCacheService, CACHE_NAMESPACES } from '../redis/redis-cache.service.js';
import { normalizePhoneOrThrow } from '../common/validators/phone.js';
import { HOSPITAL_CONFIG_TTL_SECONDS } from '../redis/redis.config.js';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
  ) {}

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
          phone: normalizePhoneOrThrow(dto.phone),
          timezone: dto.timezone?.trim() || 'UTC',
        },
      });
      await this.cache.invalidateHospital(hospital.id);
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
    // Non-sensitive reference data only. Authorization still reads the User
    // and Study rows from PostgreSQL on every protected request.
    const hospital = await this.cache.getOrSet({
      namespace: CACHE_NAMESPACES.hospitalConfig,
      tenantId: id,
      key: 'details',
      ttlSeconds: HOSPITAL_CONFIG_TTL_SECONDS,
      loader: () =>
        this.prisma.hospital.findUnique({
          where: { id },
          include: { sites: true },
        }),
    });
    if (!hospital) throw new NotFoundException(`Hospital ${id} not found`);
    return { data: hospital };
  }

  /** Call after any future hospital configuration update so cached reference
   * data cannot survive a change to the tenant settings. */
  async invalidateHospital(id: string): Promise<void> {
    await this.cache.invalidateHospital(id);
  }
}
