import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StudyStatus, UserRole } from '@prisma/client';

/**
 * States in which an already-active reading/reporting workflow has begun.
 * Reassigning a study in any of these states is rejected for Phase 3; if
 * reassignment of an in-progress case is required later it must be added as an
 * explicit, documented, audited workflow operation.
 */
const CLINICALLY_ACTIVE_STATES: StudyStatus[] = [
  StudyStatus.IN_READING,
  StudyStatus.REPORT_DRAFT,
  StudyStatus.RADIOLOGIST_SIGNED,
  StudyStatus.MANAGER_REVIEW,
  StudyStatus.MANAGER_APPROVED,
  StudyStatus.DELIVERED_TO_HOSPITAL,
  StudyStatus.HOSPITAL_REVIEW,
  StudyStatus.HOSPITAL_ACCEPTED,
  StudyStatus.COMPLETED,
  StudyStatus.CORRECTION_REQUESTED,
  StudyStatus.HOSPITAL_CHANGE_REQUESTED,
  StudyStatus.CANCELLED,
];

/**
 * States from which a (re)assignment is permitted.
 */
const ASSIGNABLE_STATES: StudyStatus[] = [
  StudyStatus.HOSPITAL_SUBMITTED,
  StudyStatus.RECEIVING,
  StudyStatus.VALIDATING,
  StudyStatus.UNASSIGNED,
  StudyStatus.ASSIGNED,
];

@Injectable()
export class WorklistService {
  private readonly logger = new Logger(WorklistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: Record<string, string | undefined>, user?: { id: string; role: UserRole; hospitalId?: string }) {
    const where: Record<string, unknown> = {};

    if (user?.role === UserRole.RADIOLOGIST) {
      where.study = { assignedRadiologistId: user.id };
    }

    if (filters.status) {
      where.study = { ...(where.study as Record<string, unknown>), status: filters.status };
    }
    if (filters.hospitalId && (user?.role === UserRole.ADMIN || user?.role === UserRole.MANAGER)) {
      where.study = { ...(where.study as Record<string, unknown>), hospitalId: filters.hospitalId };
    }
    if (filters.priority) {
      where.study = { ...(where.study as Record<string, unknown>), priority: filters.priority };
    }
    if (filters.modality) {
      where.study = { ...(where.study as Record<string, unknown>), modality: filters.modality };
    }
    if (filters.search) {
      where.study = {
        ...(where.study as Record<string, unknown>),
        OR: [
          { accessionNumber: { contains: filters.search, mode: 'insensitive' } },
          { patient: { displayName: { contains: filters.search, mode: 'insensitive' } } },
        ],
      };
    }

    const items = await this.prisma.worklistItem.findMany({
      where,
      include: {
        study: {
          include: {
            patient: true,
            hospital: true,
            assignedRadiologist: true,
          },
        },
      },
    });

    return { data: items };
  }

  async my(userId: string, userRole: UserRole, hospitalId?: string) {
    if (userRole === UserRole.HOSPITAL) {
      if (!hospitalId) {
        throw new ForbiddenException('Your account is not linked to a hospital');
      }
      const studies = await this.prisma.study.findMany({
        where: {
          hospitalId,
          status: {
            in: [
              'DELIVERED_TO_HOSPITAL',
              'HOSPITAL_REVIEW',
              'HOSPITAL_ACCEPTED',
              'COMPLETED',
            ],
          },
        },
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
        orderBy: { createdAt: 'desc' },
      });

      const items = studies.map((s) => ({
        id: s.id,
        study: s,
        assignedAt: s.assignedAt,
        startedAt: s.reportingStartedAt,
        completedAt: s.completedAt,
        assignedRadiologistId: s.assignedRadiologistId,
      }));

      return { data: items };
    }

    if (userRole === UserRole.RADIOLOGIST) {
      const studies = await this.prisma.study.findMany({
        where: {
          assignedRadiologistId: userId,
          status: { in: ['ASSIGNED', 'IN_READING', 'REPORT_DRAFT', 'CORRECTION_REQUESTED'] },
          orthancStudyId: { not: null },
        },
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
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      });

      const items = studies.map((s) => ({
        id: s.id,
        study: s,
        assignedAt: s.assignedAt,
        startedAt: s.reportingStartedAt,
        completedAt: s.completedAt,
        assignedRadiologistId: s.assignedRadiologistId,
      }));

      return { data: items };
    }

    // ADMIN / MANAGER — incoming queue + Phase 5 review & delivery queues.
    const studies = await this.prisma.study.findMany({
      where: {
        status: {
          in: [
            'HOSPITAL_SUBMITTED',
            'RECEIVING',
            'VALIDATING',
            'UNASSIGNED',
            'RADIOLOGIST_SIGNED',
            'MANAGER_REVIEW',
            'MANAGER_APPROVED',
          ],
        },
      },
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
      orderBy: { createdAt: 'desc' },
    });

    const items = studies.map((s) => ({
      id: s.id,
      study: s,
      assignedAt: s.assignedAt,
      startedAt: s.reportingStartedAt,
      completedAt: s.completedAt,
      assignedRadiologistId: s.assignedRadiologistId,
    }));

    return { data: items };
  }

  async radiologists() {
    const radiologists = await this.prisma.user.findMany({
      where: { role: 'RADIOLOGIST', isActive: true, status: 'APPROVED' },
      select: {
        id: true,
        displayName: true,
        email: true,
        subspecialty: true,
        licenseNumber: true,
        assignedStudies: {
          select: { status: true },
        },
      },
      orderBy: { displayName: 'asc' },
    });

    const data = radiologists.map((rad) => {
      const assigned = rad.assignedStudies.filter(
        (s) => ['ASSIGNED', 'IN_READING', 'REPORT_DRAFT', 'CORRECTION_REQUESTED'].includes(s.status),
      ).length;
      const inProgress = rad.assignedStudies.filter(
        (s) => ['IN_READING', 'REPORT_DRAFT'].includes(s.status),
      ).length;
      const pending = rad.assignedStudies.filter(
        (s) => s.status === 'ASSIGNED',
      ).length;
      return {
        id: rad.id,
        displayName: rad.displayName,
        email: rad.email,
        subspecialty: rad.subspecialty,
        licenseNumber: rad.licenseNumber,
        workload: { assigned, inProgress, pending },
      };
    });

    return { data };
  }

  /**
   * Canonical, authoritative assignment operation.
   *
   * Every transition into ASSIGNED must flow through this method so that the
   * Assignment history is always updated and a STUDY_ASSIGNED / STUDY_REASSIGNED
   * audit event is always emitted. The whole mutation is wrapped in a transaction
   * so the study can never be left partially-assigned.
   *
   * The actor (assignedBy) and any scope decisions are always derived from the
   * authenticated user, never from the request payload.
   */
  async assign(
    studyUid: string,
    radiologistId: string,
    actor: { id: string; role: UserRole; displayName?: string },
  ) {
    if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only a manager or admin can assign studies');
    }

    const existing = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      select: { id: true, status: true, assignedRadiologistId: true, orthancStudyId: true },
    });
    if (!existing) {
      throw new NotFoundException(`Study ${studyUid} not found`);
    }

    if (!ASSIGNABLE_STATES.includes(existing.status)) {
      throw new ConflictException(
        `Study is in ${existing.status} state and cannot be assigned. Only ${ASSIGNABLE_STATES.join(', ')} studies may be assigned.`,
      );
    }
    if (CLINICALLY_ACTIVE_STATES.includes(existing.status)) {
      throw new ConflictException(
        `Reassignment is not allowed while the study is in ${existing.status} state.`,
      );
    }
    // A study need not have DICOM uploaded to be assigned: studies created via
    // the manual submission form (or the demo seed) carry no orthancStudyId and
    // should still flow through the reading/reporting pipeline (the report is
    // authored against study metadata; imaging may be attached/loaded later).
    if (!existing.orthancStudyId) {
      this.logger.warn(
        `assign study=${existing.id} status=${existing.status} has no DICOM (orthancStudyId) yet; assigning metadata-only study`,
      );
    }

    const radiologist = await this.prisma.user.findUnique({
      where: { id: radiologistId },
      select: { id: true, role: true, isActive: true, status: true, displayName: true },
    });
    if (!radiologist || radiologist.role !== 'RADIOLOGIST') {
      throw new BadRequestException('Selected user is not a radiologist');
    }
    if (!radiologist.isActive || radiologist.status !== 'APPROVED') {
      throw new BadRequestException('Radiologist is not active or approved');
    }

    const previousRadiologistId = existing.assignedRadiologistId;
    const isReassignment = Boolean(previousRadiologistId);
    const assignedAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      // If this is a reassignment (to a different radiologist), deactivate the
      // currently active Assignment row — history is preserved, never deleted.
      if (previousRadiologistId && previousRadiologistId !== radiologistId) {
        await tx.assignment.updateMany({
          where: { studyId: existing.id, isActive: true },
          data: { isActive: false, unassignedAt: assignedAt, reason: 'Reassigned' },
        });
      }

      const study = await tx.study.update({
        where: { studyInstanceUid: studyUid },
        data: {
          status: 'ASSIGNED',
          assignedRadiologistId: radiologistId,
          assignedBy: actor.id,
          assignedAt,
        },
      });

      await tx.assignment.create({
        data: {
          studyId: existing.id,
          radiologistId,
          assignedById: actor.id,
          isActive: true,
          reason: isReassignment ? 'Reassigned' : 'Assigned',
        },
      });

      await tx.worklistItem.upsert({
        where: { studyId: existing.id },
        update: { assignedAt },
        create: { studyId: existing.id, assignedAt },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.role,
          actorRole: actor.role,
          action: isReassignment ? 'STUDY_REASSIGNED' : 'STUDY_ASSIGNED',
          resource: 'ASSIGNMENT',
          resourceId: existing.id,
          metadata: {
            studyUid,
            radiologistId,
            radiologistName: radiologist.displayName,
            assignedBy: actor.id,
            previousRadiologistId: previousRadiologistId || null,
            assignedAt: assignedAt.toISOString(),
          },
        },
      });

      return study;
    });

    return { data: updated };
  }
}
