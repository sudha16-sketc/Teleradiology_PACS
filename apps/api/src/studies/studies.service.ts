import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListStudiesDto } from './dto/list-studies.dto.js';
import { UpdateStudyStatusDto } from './dto/update-study-status.dto.js';
import { CreateStudyDto } from './dto/create-study.dto.js';
import { StudyStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

const ALLOWED_TRANSITIONS: Record<StudyStatus, StudyStatus[]> = {
  NEW: ['SUBMITTED', 'VALIDATED', 'CANCELLED'],
  SUBMITTED: ['VALIDATED', 'UNASSIGNED', 'CANCELLED'],
  VALIDATED: ['UNASSIGNED', 'CANCELLED'],
  UNASSIGNED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_READING', 'UNASSIGNED', 'CANCELLED'],
  IN_READING: ['DRAFT_REPORT', 'ASSIGNED'],
  DRAFT_REPORT: ['FINAL', 'IN_READING'],
  FINAL: ['AMENDED', 'DELIVERED'],
  AMENDED: ['FINAL', 'DELIVERED'],
  DELIVERED: ['FINAL'],
  CANCELLED: [],
};

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListStudiesDto, user?: { role: string; hospitalId?: string }) {
    const { page = 1, pageSize = 20, status, modality, hospitalId, priority, search } = dto;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (modality) where.modality = modality;
    if (priority) where.priority = priority;

    if (user?.role === 'HOSPITAL_USER' && user.hospitalId) {
      where.hospitalId = user.hospitalId;
    } else if (hospitalId) {
      where.hospitalId = hospitalId;
    }

    if (search) {
      where.OR = [
        { accessionNumber: { contains: search, mode: 'insensitive' } },
        { studyDescription: { contains: search, mode: 'insensitive' } },
        { patient: { displayName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.study.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          patient: true,
          hospital: true,
          assignedRadiologist: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.study.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getByUid(studyUid: string, user?: { id: string; role: string; hospitalId?: string }) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      include: {
        patient: true,
        hospital: true,
        assignedRadiologist: true,
        reports: {
          include: { author: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!study) {
      throw new NotFoundException(`Study ${studyUid} not found`);
    }

    this.assertCanView(study.hospitalId, user);

    return { data: study };
  }

  async getSeries(studyUid: string) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });

    if (!study) {
      throw new NotFoundException(`Study ${studyUid} not found`);
    }

    const series = await this.prisma.series.findMany({
      where: { studyId: study.id },
      orderBy: { seriesNumber: 'asc' },
    });

    return { data: series };
  }

  async priors(studyUid: string) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    const priors = await this.prisma.study.findMany({
      where: {
        patientId: study.patientId,
        status: { in: ['FINAL', 'DELIVERED', 'AMENDED'] },
        studyInstanceUid: { not: studyUid },
      },
      include: { patient: true, hospital: true },
      orderBy: { studyDate: 'desc' },
    });

    return { data: priors };
  }

  async submit(dto: CreateStudyDto, hospitalId: string) {
    if (!hospitalId) {
      throw new ForbiddenException('Your account is not linked to a hospital');
    }

    const studyInstanceUid =
      dto.studyInstanceUid || `1.2.826.0.1.3680043.8.498.${Date.now()}.${randomUUID().replace(/-/g, '')}`;
    const accessionNumber =
      dto.accessionNumber || `AX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100000 + Math.random() * 900000)}`;

    const existing = await this.prisma.study.findUnique({
      where: { studyInstanceUid },
      include: { patient: true },
    });
    if (existing) {
      throw new BadRequestException(`Study ${studyInstanceUid} already exists`);
    }

    const patient = await this.prisma.patient.findFirst({
      where: { hospitalId, displayName: dto.patientName },
    });

    const patientId =
      dto.patientId ||
      patient?.patientId ||
      `P-${new Date().getTime()}`;

    const study = await this.prisma.study.create({
      data: {
        studyInstanceUid,
        accessionNumber,
        patientId: patient
          ? patient.id
          : (
              await this.prisma.patient.create({
                data: {
                  hospitalId,
                  patientId,
                  displayName: dto.patientName,
                  dateOfBirth: dto.patientBirthDate ? new Date(dto.patientBirthDate) : undefined,
                  gender: dto.gender || 'U',
                },
              })
            ).id,
        hospitalId,
        studyDate: dto.studyDate ? new Date(dto.studyDate) : new Date(),
        modality: dto.modality || 'CT',
        bodyPart: dto.bodyPart || '',
        referringPhysician: dto.referringPhysician || '',
        studyDescription: dto.studyDescription || '',
        clinicalHistory: dto.clinicalHistory || '',
        priority: dto.priority || 'ROUTINE',
        subspecialty: dto.subspecialty || 'GENERAL',
        status: 'SUBMITTED',
        receivedAt: new Date(),
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
      include: { patient: true, hospital: true },
    });

    return { data: study };
  }

  async updateStatus(
    studyUid: string,
    dto: UpdateStudyStatusDto,
    user: { id: string; role: string; hospitalId?: string },
  ) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });

    if (!study) {
      throw new NotFoundException(`Study ${studyUid} not found`);
    }

    if (user.role === 'HOSPITAL_USER' && study.hospitalId !== user.hospitalId) {
      throw new ForbiddenException('You do not have access to studies from this hospital');
    }

    const allowed = ALLOWED_TRANSITIONS[study.status] || [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status transition ${study.status} -> ${dto.status}`,
      );
    }

    const data: Record<string, unknown> = { status: dto.status };
    if (dto.status === 'ASSIGNED') data.assignedBy = user.id;
    if (dto.status === 'IN_READING') data.reportingStartedAt = new Date();
    if (dto.status === 'FINAL') data.finalizedAt = new Date();

    const updated = await this.prisma.study.update({
      where: { studyInstanceUid: studyUid },
      data,
      include: {
        patient: true,
        hospital: true,
        assignedRadiologist: true,
      },
    });

    return { data: updated };
  }

  private assertCanView(
    studyHospitalId: string | null,
    user?: { id: string; role: string; hospitalId?: string },
  ) {
    if (!user) return;
    if (user.role === 'ADMIN' || user.role === 'COORDINATOR' || user.role === 'RADIOLOGIST') return;
    if (user.role === 'HOSPITAL_USER' && studyHospitalId && studyHospitalId === user.hospitalId) {
      return;
    }
    throw new ForbiddenException('You do not have access to this study');
  }
}
