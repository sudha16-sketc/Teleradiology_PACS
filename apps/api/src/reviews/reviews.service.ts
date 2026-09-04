import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StudyStatus, UserRole } from '@prisma/client';
import type { AuditAction } from '@axis/types';

interface Actor {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

/**
 * The states in which a study is considered delivered to (and visible to) its
 * destination hospital. A hospital may only access report content in these
 * states; before DELIVERED_TO_HOSPITAL the report must not be exposed.
 */
export const HOSPITAL_VISIBLE_STATES: StudyStatus[] = [
  StudyStatus.DELIVERED_TO_HOSPITAL,
  StudyStatus.HOSPITAL_REVIEW,
  StudyStatus.HOSPITAL_ACCEPTED,
  StudyStatus.COMPLETED,
];

/**
 * Phase 5 — Review & Hospital Delivery.
 *
 * Single source of truth for the review / delivery / acceptance lifecycle. All
 * sensitive workflow mutations flow through this service (via the controller)
 * so that:
 *   - the correct actor + prerequisite checks are enforced,
 *   - the transition + audit + (for delivery) the DeliveryAttempt are written
 *     in a single transaction to prevent double-approval / double-acceptance,
 *   - the destination hospital always comes from study.hospitalId, never the
 *     client,
 *   - every transition emits STUDY_STATUS_CHANGED plus an operation-specific
 *     audit event.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertActorRole(actor: Actor, roles: UserRole[], action: string) {
    if (!roles.includes(actor.role)) {
      throw new ForbiddenException(
        `Only ${roles.join(' or ')} can ${action} reports`,
      );
    }
  }

  private async getStudy(studyUid: string) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);
    return study;
  }

  private assertHospitalScope(
    study: { hospitalId: string | null },
    actor: Actor,
  ) {
    if (actor.role === UserRole.HOSPITAL) {
      if (!study.hospitalId || study.hospitalId !== actor.hospitalId) {
        throw new ForbiddenException(
          'You do not have access to studies from this hospital',
        );
      }
    }
  }

  /**
   * RADIOLOGIST_SIGNED -> MANAGER_REVIEW (ADMIN/MANAGER).
   * The manager explicitly opens the review stage for a signed report.
   */
  async review(studyUid: string, actor: Actor) {
    this.assertActorRole(actor, [UserRole.ADMIN, UserRole.MANAGER], 'review');
    return this.transition(studyUid, actor, StudyStatus.MANAGER_REVIEW, {
      action: 'REPORT_VERIFIED',
      resource: 'REPORT',
      resourceId: undefined,
      set: { managerReviewedAt: new Date() },
    });
  }

  /**
   * MANAGER_REVIEW -> MANAGER_APPROVED (ADMIN/MANAGER).
   * Manager quality approves the signed report.
   */
  async approve(studyUid: string, actor: Actor) {
    this.assertActorRole(actor, [UserRole.ADMIN, UserRole.MANAGER], 'approve');
    return this.transition(studyUid, actor, StudyStatus.MANAGER_APPROVED, {
      action: 'REPORT_RELEASED',
      resource: 'REPORT',
      resourceId: undefined,
      set: { managerApprovedAt: new Date() },
    });
  }

  /**
   * MANAGER_APPROVED -> DELIVERED_TO_HOSPITAL (ADMIN/MANAGER).
   * Delivers the approved report to the study's authoritative destination
   * hospital (study.hospitalId). Records a DeliveryAttempt.
   */
  async deliver(studyUid: string, actor: Actor) {
    this.assertActorRole(actor, [UserRole.ADMIN, UserRole.MANAGER], 'deliver');
    const study = await this.getStudy(studyUid);

    const deliverTx = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.study.findUnique({
        where: { studyInstanceUid: studyUid },
      });
      if (!latest) throw new NotFoundException(`Study ${studyUid} not found`);

      if (latest.status !== StudyStatus.MANAGER_APPROVED) {
        throw new ConflictException(
          `A report can only be delivered while the study is MANAGER_APPROVED (currently ${latest.status}).`,
        );
      }
      if (!latest.managerApprovedAt) {
        throw new ConflictException(
          'The report must be manager-approved before it can be delivered.',
        );
      }
      const report = await tx.report.findFirst({
        where: { studyId: latest.id, status: 'SIGNED' },
        orderBy: { version: 'desc' },
      });
      if (!report) {
        throw new ConflictException(
          'No signed report exists to deliver to the hospital.',
        );
      }
      if (!latest.hospitalId) {
        throw new BadRequestException(
          'The study is not linked to a destination hospital.',
        );
      }

      const now = new Date();
      const attemptNumber =
        (await tx.deliveryAttempt.count({ where: { studyId: latest.id } })) + 1;

      const updated = await tx.study.update({
        where: { id: latest.id },
        data: { status: 'DELIVERED_TO_HOSPITAL', deliveredAt: now },
      });

      await tx.deliveryAttempt.create({
        data: {
          studyId: latest.id,
          reportId: report.id,
          hospitalId: latest.hospitalId,
          status: 'COMPLETED',
          attemptNumber,
          deliveredAt: now,
          metadata: { deliveredBy: actor.id, studyUid },
        },
      });

      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: 'DELIVERY_COMPLETED',
        resource: 'DELIVERY',
        resourceId: latest.id,
        metadata: {
          studyUid,
          studyId: latest.id,
          reportId: report.id,
          hospitalId: latest.hospitalId,
          deliveredBy: actor.id,
          attemptNumber,
        },
      });

      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: 'STUDY_STATUS_CHANGED',
        resource: 'STUDY',
        resourceId: latest.id,
        metadata: { from: latest.status, to: 'DELIVERED_TO_HOSPITAL', studyUid },
      });

      return updated;
    });

    // Notify the destination hospital that a (possibly corrected) report has
    // been delivered for their review.
    const isCorrection = await this.isCorrectedStudy(study.id);
    if (isCorrection && study.hospitalId) {
      await this.notifications.notifyHospital(study.hospitalId, {
        type: 'CORRECTED_REPORT_DELIVERED',
        title: 'Corrected report delivered',
        message: 'A corrected report has been delivered to your hospital for review',
        studyId: study.id,
      });
    }

    return { data: deliverTx };
  }

  /**
   * DELIVERED_TO_HOSPITAL -> HOSPITAL_REVIEW (HOSPITAL).
   * The destination hospital marks the delivered report as under review.
   */
  async hospitalReview(studyUid: string, actor: Actor) {
    const study = await this.getStudy(studyUid);
    this.assertHospitalScope(study, actor);
    return this.transition(studyUid, actor, StudyStatus.HOSPITAL_REVIEW, {
      action: 'REPORT_VIEWED',
      resource: 'REPORT',
      resourceId: undefined,
      set: { hospitalReviewedAt: new Date() },
    });
  }

  /**
   * HOSPITAL_REVIEW -> HOSPITAL_ACCEPTED (HOSPITAL).
   * The destination hospital accepts the delivered report.
   */
  async accept(studyUid: string, actor: Actor) {
    const study = await this.getStudy(studyUid);
    this.assertHospitalScope(study, actor);

    const acceptTx = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.study.findUnique({
        where: { studyInstanceUid: studyUid },
      });
      if (!latest) throw new NotFoundException(`Study ${studyUid} not found`);

      if (latest.status === StudyStatus.HOSPITAL_ACCEPTED) {
        throw new ConflictException(
          'This report has already been accepted by the hospital.',
        );
      }
      if (latest.status !== StudyStatus.HOSPITAL_REVIEW) {
        throw new ConflictException(
          `A report can only be accepted once it has entered HOSPITAL_REVIEW (currently ${latest.status}).`,
        );
      }
      if (!latest.managerApprovedAt || !latest.deliveredAt) {
        throw new ConflictException(
          'The report must be manager-approved and delivered before it can be accepted.',
        );
      }
      if (!latest.hospitalId || latest.hospitalId !== actor.hospitalId) {
        throw new ForbiddenException(
          'You do not have access to studies from this hospital',
        );
      }
      const report = await tx.report.findFirst({
        where: { studyId: latest.id, status: 'SIGNED' },
        orderBy: { version: 'desc' },
      });
      if (!report) {
        throw new ConflictException('No signed report exists to accept.');
      }

      const now = new Date();
      const updated = await tx.study.update({
        where: { id: latest.id },
        data: { status: 'HOSPITAL_ACCEPTED', hospitalAcceptedAt: now },
      });

      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: 'HOSPITAL_ACCEPTED',
        resource: 'STUDY',
        resourceId: latest.id,
        metadata: {
          studyUid,
          studyId: latest.id,
          reportId: report.id,
          hospitalId: latest.hospitalId,
        },
      });

      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: 'STUDY_STATUS_CHANGED',
        resource: 'STUDY',
        resourceId: latest.id,
        metadata: { from: latest.status, to: 'HOSPITAL_ACCEPTED', studyUid },
      });

      return updated;
    });

    // Notify operational reviewers that the (possibly corrected) report was
    // accepted by the hospital.
    const isCorrection = await this.isCorrectedStudy(study.id);
    if (isCorrection) {
      await this.notifications.notifyManagers({
        type: 'CORRECTION_HOSPITAL_ACCEPTED',
        title: 'Corrected report accepted',
        message: 'The hospital accepted the corrected report',
        studyId: study.id,
      });
    }

    return { data: acceptTx };
  }

  /**
   * HOSPITAL_ACCEPTED -> COMPLETED (ADMIN/MANAGER).
   * A study that has been accepted by the hospital is archived as COMPLETED.
   * Hospital users cannot set COMPLETED directly.
   */
  async complete(studyUid: string, actor: Actor) {
    this.assertActorRole(actor, [UserRole.ADMIN, UserRole.MANAGER], 'complete');
    return this.transition(studyUid, actor, StudyStatus.COMPLETED, {
      action: 'REPORT_FINALIZED',
      resource: 'REPORT',
      resourceId: undefined,
      set: { completedAt: new Date() },
    });
  }

  /**
   * Loads the latest signed report id for a study (for audit resourceId).
   */
  private async reportIdFor(studyId: string): Promise<string | undefined> {
    const report = await this.prisma.report.findFirst({
      where: { studyId, status: 'SIGNED' },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    return report?.id;
  }

  /**
   * True when the study's latest signed report is the product of a correction
   * (a ChangeRequest has produced a new resolved signed version). Used to scope
   * corrected-report delivery/acceptance notifications.
   */
  private async isCorrectedStudy(studyId: string): Promise<boolean> {
    const correction = await this.prisma.changeRequest.findFirst({
      where: { studyId, newReportVersionId: { not: null } },
      select: { id: true },
    });
    return Boolean(correction);
  }

  /**
   * Generic transactional transition used by review/approve/complete.
   */
  private async transition(
    studyUid: string,
    actor: Actor,
    target: StudyStatus,
    opts: {
      action: AuditAction;
      resource: 'REPORT' | 'STUDY';
      resourceId?: string;
      set: Record<string, Date>;
    },
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.study.findUnique({
        where: { studyInstanceUid: studyUid },
      });
      if (!latest) throw new NotFoundException(`Study ${studyUid} not found`);

      if (latest.status === target) {
        throw new ConflictException(
          `The study is already in ${target} state.`,
        );
      }

      const predecessors: Record<string, StudyStatus[]> = {
        [StudyStatus.MANAGER_REVIEW]: [StudyStatus.RADIOLOGIST_SIGNED],
        [StudyStatus.MANAGER_APPROVED]: [StudyStatus.MANAGER_REVIEW],
        [StudyStatus.HOSPITAL_REVIEW]: [StudyStatus.DELIVERED_TO_HOSPITAL],
        [StudyStatus.COMPLETED]: [StudyStatus.HOSPITAL_ACCEPTED],
      };
      if (
        predecessors[target] &&
        !predecessors[target].includes(latest.status)
      ) {
        throw new ConflictException(
          `Cannot move the study to ${target} from ${latest.status}. Expected ${predecessors[target].join(' or ')}.`,
        );
      }

      if (target === StudyStatus.COMPLETED && !latest.hospitalAcceptedAt) {
        throw new ConflictException(
          'The study must be accepted by the hospital before it can be completed.',
        );
      }

      const report = await tx.report.findFirst({
        where: { studyId: latest.id, status: 'SIGNED' },
        orderBy: { version: 'desc' },
      });
      if (!report) {
        throw new ConflictException('No signed report exists for this study.');
      }

      const realReportId =
        opts.resourceId ?? report?.id ?? (await this.reportIdFor(latest.id));

      const updated = await tx.study.update({
        where: { id: latest.id },
        data: { status: target, ...opts.set },
      });

      const auditResourceId =
        opts.resource === 'REPORT' ? (realReportId ?? latest.id) : latest.id;

      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: opts.action,
        resource: opts.resource,
        resourceId: auditResourceId,
        metadata: {
          studyUid,
          studyId: latest.id,
          reportId: realReportId ?? null,
          to: target,
          from: latest.status,
        },
      });

      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: 'STUDY_STATUS_CHANGED',
        resource: 'STUDY',
        resourceId: latest.id,
        metadata: { from: latest.status, to: target, studyUid },
      });

      return updated;
    });

    return { data: updated };
  }
}
