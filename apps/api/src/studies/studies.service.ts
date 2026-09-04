import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ListStudiesDto } from './dto/list-studies.dto.js';
import { UpdateStudyStatusDto } from './dto/update-study-status.dto.js';
import { CreateStudyDto } from './dto/create-study.dto.js';
import { StudyStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';

export const ALLOWED_TRANSITIONS: Record<StudyStatus, StudyStatus[]> = {
  HOSPITAL_SUBMITTED: ['RECEIVING', 'CANCELLED'],
  RECEIVING: ['VALIDATING', 'CANCELLED'],
  VALIDATING: ['UNASSIGNED', 'CANCELLED'],
  UNASSIGNED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_READING', 'UNASSIGNED', 'CANCELLED'],
  IN_READING: ['REPORT_DRAFT', 'ASSIGNED'],
  REPORT_DRAFT: ['RADIOLOGIST_SIGNED', 'IN_READING'],
  RADIOLOGIST_SIGNED: ['MANAGER_REVIEW'],
  MANAGER_REVIEW: ['MANAGER_APPROVED', 'CORRECTION_REQUESTED'],
  MANAGER_APPROVED: ['DELIVERED_TO_HOSPITAL'],
  DELIVERED_TO_HOSPITAL: ['HOSPITAL_REVIEW'],
  HOSPITAL_REVIEW: ['HOSPITAL_ACCEPTED', 'HOSPITAL_CHANGE_REQUESTED'],
  HOSPITAL_ACCEPTED: ['COMPLETED'],
  COMPLETED: [],
  CORRECTION_REQUESTED: ['IN_READING'],
  HOSPITAL_CHANGE_REQUESTED: ['MANAGER_REVIEW'],
  CANCELLED: [],
};

export const TRANSITION_ACTORS: Record<string, UserRole[]> = {
  HOSPITAL_SUBMITTED: ['HOSPITAL', 'ADMIN'],
  RECEIVING: ['ADMIN', 'MANAGER'],
  VALIDATING: ['ADMIN', 'MANAGER'],
  UNASSIGNED: ['ADMIN', 'MANAGER'],
  ASSIGNED: ['ADMIN', 'MANAGER'],
  IN_READING: ['ADMIN', 'MANAGER', 'RADIOLOGIST'],
  REPORT_DRAFT: ['RADIOLOGIST'],
  RADIOLOGIST_SIGNED: ['RADIOLOGIST'],
  MANAGER_REVIEW: ['ADMIN', 'MANAGER'],
  MANAGER_APPROVED: ['ADMIN', 'MANAGER'],
  DELIVERED_TO_HOSPITAL: ['ADMIN', 'MANAGER'],
  HOSPITAL_REVIEW: ['ADMIN', 'MANAGER', 'HOSPITAL'],
  HOSPITAL_ACCEPTED: ['ADMIN', 'MANAGER', 'HOSPITAL'],
  COMPLETED: ['ADMIN', 'MANAGER'],
  CORRECTION_REQUESTED: ['ADMIN', 'MANAGER'],
  HOSPITAL_CHANGE_REQUESTED: ['HOSPITAL'],
  CANCELLED: ['ADMIN', 'MANAGER'],
};

@Injectable()
export class StudiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(dto: ListStudiesDto, user?: { id: string; role: UserRole; hospitalId?: string }) {
    const { page = 1, pageSize = 20, status, modality, hospitalId, priority, search } = dto;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (modality) where.modality = modality;
    if (priority) where.priority = priority;

    if (user?.role === UserRole.HOSPITAL && user.hospitalId) {
      where.hospitalId = user.hospitalId;
    } else if (user?.role === UserRole.RADIOLOGIST && user.id) {
      where.assignedRadiologistId = user.id;
    } else if (hospitalId && (user?.role === UserRole.ADMIN || user?.role === UserRole.MANAGER)) {
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

  async getByUid(studyUid: string, user?: { id: string; role: UserRole; hospitalId?: string }) {
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

    this.assertCanView(study, user);

    return { data: study };
  }

  async getSeries(studyUid: string, user?: { id: string; role: UserRole; hospitalId?: string }) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });

    if (!study) {
      throw new NotFoundException(`Study ${studyUid} not found`);
    }

    this.assertCanView(study, user);

    const series = await this.prisma.series.findMany({
      where: { studyId: study.id },
      orderBy: { seriesNumber: 'asc' },
    });

    return { data: series };
  }

  async priors(studyUid: string, user?: { id: string; role: UserRole; hospitalId?: string }) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    this.assertCanView(study, user);

    const priors = await this.prisma.study.findMany({
      where: {
        patientId: study.patientId,
        status: { in: ['MANAGER_APPROVED', 'DELIVERED_TO_HOSPITAL', 'COMPLETED'] },
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
        status: 'HOSPITAL_SUBMITTED',
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
    user: { id: string; role: UserRole; hospitalId?: string },
  ) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });

    if (!study) {
      throw new NotFoundException(`Study ${studyUid} not found`);
    }

    if (user.role === UserRole.HOSPITAL && study.hospitalId !== user.hospitalId) {
      throw new ForbiddenException('You do not have access to studies from this hospital');
    }

    if (user.role === UserRole.RADIOLOGIST && study.assignedRadiologistId !== user.id) {
      throw new ForbiddenException('You can only update status of studies assigned to you');
    }

    // Direct transition to ASSIGNED is forbidden. Assignment must go through
    // POST /worklist/:studyUid/assign so that Assignment history + audit are
    // always preserved. This is the single source of truth for ASSIGNED.
    if (dto.status === 'ASSIGNED') {
      throw new BadRequestException(
        'Assign a study via POST /worklist/:studyUid/assign. Direct status transitions to ASSIGNED are not allowed because assignment history and audit must be preserved.',
      );
    }

    const allowed = ALLOWED_TRANSITIONS[study.status] || [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status transition ${study.status} -> ${dto.status}`,
      );
    }

    // A study cannot enter the reading workflow unless it is actually assigned
    // to a real radiologist. This prevents IN_READING without an active
    // assignment.
    if (dto.status === 'IN_READING' && !study.assignedRadiologistId) {
      throw new BadRequestException(
        'The study must be assigned to a radiologist before reading can begin. Assign it via POST /worklist/:studyUid/assign first.',
      );
    }

    const allowedActors = TRANSITION_ACTORS[dto.status] || [];
    if (!allowedActors.includes(user.role)) {
      throw new ForbiddenException(
        `Your role (${user.role}) is not authorized to transition to ${dto.status}`,
      );
    }

    // -------------------------------------------------------------------------
    // Phase 5 — Prerequisite validation for sensitive workflow transitions.
    // These guards ensure a generic status PATCH can never bypass the role-
    // specific review / delivery / accept operations. Each sensitive transition
    // requires the clinical report to be signed and, where relevant, prior
    // approval / delivery / acceptance to have actually occurred.
    // -------------------------------------------------------------------------
    const requiresSignedReport: StudyStatus[] = [
      StudyStatus.MANAGER_REVIEW,
      StudyStatus.MANAGER_APPROVED,
      StudyStatus.DELIVERED_TO_HOSPITAL,
      StudyStatus.HOSPITAL_REVIEW,
      StudyStatus.HOSPITAL_ACCEPTED,
      StudyStatus.COMPLETED,
    ];
    if (requiresSignedReport.includes(dto.status)) {
      const signedReport = await this.prisma.report.findFirst({
        where: { studyId: study.id, status: 'SIGNED' },
        orderBy: { version: 'desc' },
      });
      if (!signedReport) {
        throw new BadRequestException(
          `A signed clinical report is required before the study can be moved to ${dto.status}.`,
        );
      }
    }

    if (
      dto.status === StudyStatus.DELIVERED_TO_HOSPITAL &&
      !study.hospitalId
    ) {
      throw new BadRequestException('The study is not linked to a destination hospital.');
    }

    if (
      dto.status === StudyStatus.HOSPITAL_ACCEPTED &&
      (!study.managerApprovedAt || !study.deliveredAt)
    ) {
      throw new BadRequestException(
        'The report must be manager-approved and delivered before the hospital can accept it.',
      );
    }

    if (dto.status === StudyStatus.COMPLETED && !study.hospitalAcceptedAt) {
      throw new BadRequestException(
        'The study must be accepted by the hospital before it can be completed.',
      );
    }

    const data: Record<string, unknown> = { status: dto.status };
    const now = new Date();

    if (dto.status === 'IN_READING') data.reportingStartedAt = now;
    if (dto.status === 'RADIOLOGIST_SIGNED') data.signedOffAt = now;
    if (dto.status === 'MANAGER_REVIEW') data.managerReviewedAt = now;
    if (dto.status === 'MANAGER_APPROVED') data.managerApprovedAt = now;
    if (dto.status === 'DELIVERED_TO_HOSPITAL') data.deliveredAt = now;
    if (dto.status === 'HOSPITAL_REVIEW') data.hospitalReviewedAt = now;
    if (dto.status === 'HOSPITAL_ACCEPTED') data.hospitalAcceptedAt = now;
    if (dto.status === 'COMPLETED') data.completedAt = now;

    const updated = await this.prisma.study.update({
      where: { studyInstanceUid: studyUid },
      data,
      include: {
        patient: true,
        hospital: true,
        assignedRadiologist: true,
      },
    });

    await this.audit.create({
      actorId: user.id,
      actorName: user.role,
      actorRole: user.role,
      action: 'STUDY_STATUS_CHANGED',
      resource: 'STUDY',
      resourceId: study.id,
      metadata: { from: study.status, to: dto.status, studyUid },
    });

    return { data: updated };
  }

  assertCanView(
    study: { hospitalId: string | null; assignedRadiologistId: string | null },
    user?: { id: string; role: UserRole; hospitalId?: string },
  ) {
    if (!user) return;
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) return;
    if (user.role === UserRole.RADIOLOGIST) {
      if (study.assignedRadiologistId === user.id) return;
      throw new ForbiddenException('You do not have access to studies not assigned to you');
    }
    if (user.role === UserRole.HOSPITAL && study.hospitalId && study.hospitalId === user.hospitalId) {
      return;
    }
    throw new ForbiddenException('You do not have access to this study');
  }
}
