import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StudyStatus, UserRole, ChangeRequestStatus } from '@prisma/client';
import { contentHash } from '../reports/reports.service.js';
import type { Prisma } from '@prisma/client';

interface Actor {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

/**
 * States from which a hospital/manager may request a correction. This mirrors
 * "delivered / accepted / completed" per the workflow policy.
 */
export const CORRECTION_ELIGIBLE_STATES: StudyStatus[] = [
  StudyStatus.DELIVERED_TO_HOSPITAL,
  StudyStatus.HOSPITAL_REVIEW,
  StudyStatus.HOSPITAL_ACCEPTED,
  StudyStatus.COMPLETED,
];

const ACTIVE_CORRECTION_STATUSES: ChangeRequestStatus[] = [
  ChangeRequestStatus.OPEN,
  ChangeRequestStatus.ACKNOWLEDGED,
  ChangeRequestStatus.APPROVED,
  ChangeRequestStatus.IN_PROGRESS,
];

/**
 * Phase 6 — Corrections.
 *
 * A correction NEVER mutates a signed report/version. It creates a NEW draft
 * (new ReportVersion after signing) that flows through the normal Phase 4 sign
 * + Phase 5 review/delivery lifecycle. The original signed version remains
 * immutable and is linked as the correction's parent (lineage).
 *
 * All sensitive study transitions in this service are performed directly (the
 * correction endpoint is the authorized operation) with explicit audit rows, so
 * the generic status PATCH can never drive correction workflow.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async audit(
    actor: Actor,
    entry: {
      action: 'CORRECTION_REQUESTED' | 'CORRECTION_APPROVED' | 'CORRECTION_REJECTED' | 'CORRECTION_STARTED' | 'CORRECTED_REPORT_SIGNED' | 'CORRECTION_RESOLVED';
    } & { resourceId: string; metadata?: Record<string, unknown> },
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: entry.action,
        resource: 'CHANGE_REQUEST',
        resourceId: entry.resourceId,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async auditTx(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: 'CORRECTION_REQUESTED' | 'CORRECTION_APPROVED' | 'CORRECTION_REJECTED' | 'CORRECTION_STARTED' | 'CORRECTED_REPORT_SIGNED' | 'CORRECTION_RESOLVED',
    resourceId: string,
    metadata?: Record<string, unknown>,
  ) {
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action,
        resource: 'CHANGE_REQUEST',
        resourceId,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async getStudy(studyUid: string) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);
    return study;
  }

  private async findActiveCorrection(studyId: string) {
    return this.prisma.changeRequest.findFirst({
      where: { studyId, status: { in: ACTIVE_CORRECTION_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private assertHospitalScope(
    study: { hospitalId: string | null },
    actor: Actor,
  ) {
    if (actor.role === UserRole.HOSPITAL) {
      if (!study.hospitalId || study.hospitalId !== actor.hospitalId) {
        throw new ForbiddenException('You do not have access to studies from this hospital');
      }
    }
  }

  /**
   * POST — request a correction for a signed report. HOSPITAL (own) or
   * MANAGER/ADMIN. Creates an OPEN CorrectionRequest and moves the study to
   * CORRECTION_REQUESTED.
   */
  async request(studyUid: string, reason: string, actor: Actor) {
    if (actor.role === 'RADIOLOGIST') {
      throw new ForbiddenException('A radiologist cannot directly request a correction. The request must come from the hospital or a manager.');
    }

    const study = await this.getStudy(studyUid);
    this.assertHospitalScope(study, actor);

    // Guard against duplicate ACTIVE corrections before validating state so a
    // repeated request returns a clear 409 even after the first one has already
    // transitioned the study to CORRECTION_REQUESTED.
    const active = await this.findActiveCorrection(study.id);
    if (active) {
      throw new ConflictException(
        `A correction for this study is already ${active.status} and cannot be duplicated.`,
      );
    }

    if (!CORRECTION_ELIGIBLE_STATES.includes(study.status)) {
      throw new BadRequestException(
        `A correction can only be requested while the study is in ${CORRECTION_ELIGIBLE_STATES.join(', ')} (currently ${study.status}).`,
      );
    }

    // Must reference a signed report/version.
    const signedReport = await this.prisma.report.findFirst({
      where: { studyId: study.id, status: 'SIGNED' },
      orderBy: { version: 'desc' },
      include: { versions: true },
    });
    if (!signedReport) {
      throw new BadRequestException('No signed report exists to request a correction for.');
    }

    const sourceStatus = study.status;
    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const cr = await tx.changeRequest.create({
        data: {
          studyId: study.id,
          reportId: signedReport.id,
          requestedById: actor.id,
          requestedByRole: actor.role,
          assignedToId: study.assignedRadiologistId ?? '',
          reason,
          status: 'OPEN',
          sourceStatus,
          parentReportVersionId:
            signedReport.versions[signedReport.versions.length - 1]?.id ?? null,
        },
        include: { study: true, requestedBy: true, assignedTo: true },
      });

      await tx.study.update({
        where: { id: study.id },
        data: { status: 'CORRECTION_REQUESTED' },
      });

      await this.auditTx(tx, actor, 'CORRECTION_REQUESTED', cr.id, {
        studyUid,
        studyId: study.id,
        correctionRequestId: cr.id,
        reportId: signedReport.id,
        from: sourceStatus,
        to: 'CORRECTION_REQUESTED',
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.role,
          actorRole: actor.role,
          action: 'STUDY_STATUS_CHANGED',
          resource: 'STUDY',
          resourceId: study.id,
          metadata: {
            from: sourceStatus,
            to: 'CORRECTION_REQUESTED',
            studyUid,
            correctionRequestId: cr.id,
          } as Prisma.InputJsonValue,
        },
      });

      return cr;
    });

    await this.notifications.notifyManagers({
      type: 'CORRECTION_REQUESTED',
      title: 'Correction requested',
      message: `A correction was requested (${reason})`,
      studyId: study.id,
      correctionRequestId: created.id,
    });

    return { data: created };
  }

  /**
   * GET — correction queue. Manager/ADMIN see all; RADIOLOGIST sees their own
   * assigned active corrections; HOSPITAL sees corrections for their own studies.
   */
  async list(actor: Actor) {
    let where: Prisma.ChangeRequestWhereInput = {};
    if (actor.role === 'RADIOLOGIST') {
      where = { assignedToId: actor.id };
    } else if (actor.role === 'HOSPITAL') {
      if (!actor.hospitalId) {
        throw new ForbiddenException('Your account is not linked to a hospital');
      }
      where = { study: { hospitalId: actor.hospitalId } };
    }

    const items = await this.prisma.changeRequest.findMany({
      where,
      include: {
        study: {
          include: {
            patient: true,
            hospital: true,
            assignedRadiologist: { select: { id: true, displayName: true } },
          },
        },
        report: true,
        requestedBy: { select: { id: true, displayName: true, role: true } },
        assignedTo: { select: { id: true, displayName: true, role: true } },
        reviewedBy: { select: { id: true, displayName: true, role: true } },
        parentReportVersion: true,
        newReportVersion: true,
      },
      orderBy: [
        { status: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    return { data: items };
  }

  /**
   * POST — manager/ADMIN approves an OPEN correction request. The study moves
   * from CORRECTION_REQUESTED to IN_READING so the assigned radiologist can
   * begin the corrected version.
   */
  async approve(id: string, actor: Actor) {
    if (actor.role !== UserRole.MANAGER && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only a manager or admin can approve correction requests');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cr = await tx.changeRequest.findUnique({ where: { id }, include: { study: true } });
      if (!cr) throw new NotFoundException(`Correction request ${id} not found`);
      if (cr.status !== ChangeRequestStatus.OPEN && cr.status !== ChangeRequestStatus.ACKNOWLEDGED) {
        throw new ConflictException(`Correction request is already ${cr.status} and cannot be approved`);
      }
      if (!cr.assignedToId || cr.assignedToId.length === 0) {
        throw new BadRequestException('This study has no radiologist assigned to perform the correction');
      }
      if (cr.study.status !== StudyStatus.CORRECTION_REQUESTED) {
        throw new ConflictException(
          `The study must be in CORRECTION_REQUESTED to be approved (currently ${cr.study.status}).`,
        );
      }

      const res = await tx.changeRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date() },
      });

      await tx.study.update({
        where: { id: cr.studyId },
        data: {
          status: 'IN_READING',
          reportingStartedAt: cr.study.reportingStartedAt ?? new Date(),
        },
      });

      await this.auditTx(tx, actor, 'CORRECTION_APPROVED', cr.id, {
        studyUid: cr.study.studyInstanceUid,
        studyId: cr.studyId,
        correctionRequestId: cr.id,
        correctionStatus: 'APPROVED',
        from: 'CORRECTION_REQUESTED',
        to: 'IN_READING',
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.role,
          actorRole: actor.role,
          action: 'STUDY_STATUS_CHANGED',
          resource: 'STUDY',
          resourceId: cr.studyId,
          metadata: {
            from: 'CORRECTION_REQUESTED',
            to: 'IN_READING',
            studyUid: cr.study.studyInstanceUid,
            correctionRequestId: cr.id,
          } as Prisma.InputJsonValue,
        },
      });

      return res;
    });

    const cr = await this.prisma.changeRequest.findUnique({
      where: { id },
      select: { assignedToId: true, studyId: true, assignedTo: { select: { id: true } } },
    });
    if (cr?.assignedToId) {
      await this.notifications.notifyRadiologist(cr.assignedToId, {
        type: 'CORRECTION_APPROVED',
        title: 'Correction approved',
        message: `Your correction has been approved and is ready to start`,
        studyId: cr.studyId,
        correctionRequestId: id,
      });
    }

    return { data: updated };
  }

  /**
   * POST — manager/ADMIN rejects an OPEN correction request. The study returns
   * to its pre-correction source status (defaulting to COMPLETED). The requester
   * is notified.
   */
  async reject(id: string, resolution: string, actor: Actor) {
    if (actor.role !== UserRole.MANAGER && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only a manager or admin can reject correction requests');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cr = await tx.changeRequest.findUnique({ where: { id }, include: { study: true } });
      if (!cr) throw new NotFoundException(`Correction request ${id} not found`);
      if (cr.status === ChangeRequestStatus.REJECTED) {
        throw new ConflictException('This correction request has already been rejected');
      }
      if (cr.status !== ChangeRequestStatus.OPEN && cr.status !== ChangeRequestStatus.ACKNOWLEDGED) {
        throw new ConflictException(`Correction request is already ${cr.status} and cannot be rejected now`);
      }

      const res = await tx.changeRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          resolution,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          resolvedAt: new Date(),
        },
      });

      const revertTo = cr.sourceStatus ?? StudyStatus.COMPLETED;
      await tx.study.update({
        where: { id: cr.studyId },
        data: { status: revertTo },
      });

      await this.auditTx(tx, actor, 'CORRECTION_REJECTED', cr.id, {
        studyUid: cr.study.studyInstanceUid,
        studyId: cr.studyId,
        correctionRequestId: cr.id,
        correctionStatus: 'REJECTED',
        resolution,
        from: 'CORRECTION_REQUESTED',
        to: revertTo,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.role,
          actorRole: actor.role,
          action: 'STUDY_STATUS_CHANGED',
          resource: 'STUDY',
          resourceId: cr.studyId,
          metadata: {
            from: 'CORRECTION_REQUESTED',
            to: revertTo,
            studyUid: cr.study.studyInstanceUid,
            correctionRequestId: cr.id,
          } as Prisma.InputJsonValue,
        },
      });

      return res;
    });

    const requesterId = updated.requestedById;
    if (requesterId) {
      await this.notifications.create({
        recipientUserId: requesterId,
        type: 'CORRECTION_REJECTED',
        title: 'Correction rejected',
        message: 'Your correction request was rejected',
        studyId: updated.studyId,
        correctionRequestId: id,
      });
    }

    return { data: updated };
  }

  /**
   * POST — assigned radiologist begins an approved correction. Creates a NEW
   * DRAFT report (version N+1, content seeded from the original signed version)
   * and links the correction lineage (parentReportVersionId). The study moves to
   * REPORT_DRAFT.
   */
  async begin(studyUid: string, actor: Actor) {
    const study = await this.getStudy(studyUid);
    if (actor.role !== UserRole.RADIOLOGIST || study.assignedRadiologistId !== actor.id) {
      throw new ForbiddenException('Only the assigned radiologist can begin a correction');
    }

    const cr = await this.findActiveCorrection(study.id);
    if (!cr) {
      throw new NotFoundException('No pending correction request found for this study');
    }
    if (cr.status !== ChangeRequestStatus.APPROVED) {
      throw new ConflictException(`Correction cannot be started until approved (currently ${cr.status})`);
    }
    if (cr.assignedToId !== actor.id) {
      throw new ForbiddenException('This correction is assigned to another radiologist');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.changeRequest.findUnique({ where: { id: cr.id }, include: { study: true } });
      if (!locked || locked.status !== ChangeRequestStatus.APPROVED) {
        throw new ConflictException('Correction is no longer in an approved state (double-start guard)');
      }

      // Parent signed snapshot for seeding + lineage.
      const parent = await tx.reportVersion.findFirst({
        where: { report: { studyId: study.id } },
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      });

      const maxVersion = await tx.report.aggregate({
        where: { studyId: study.id },
        _max: { version: true },
      });
      const newVersion = (maxVersion._max.version ?? 0) + 1;

      const content = {
        clinicalHistory: parent?.clinicalHistory ?? '',
        findings: parent?.findings ?? '',
        impression: parent?.impression ?? '',
        technique: parent?.technique ?? '',
        comparison: parent?.comparison ?? '',
        recommendations: parent?.recommendations ?? '',
        criticalFinding: false,
      };
      const hash = contentHash(content);

      const newReport = await tx.report.create({
        data: {
          studyId: study.id,
          authorId: actor.id,
          status: 'DRAFT',
          version: newVersion,
          ...content,
          contentHash: hash,
        },
        include: { author: true },
      });

      await tx.changeRequest.update({
        where: { id: cr.id },
        data: {
          status: 'IN_PROGRESS',
          parentReportVersionId: parent?.id ?? cr.parentReportVersionId,
        },
      });

      if (locked.study.status !== 'REPORT_DRAFT') {
        await tx.study.update({
          where: { id: study.id },
          data: { status: 'REPORT_DRAFT' },
        });
      }

      await this.auditTx(tx, actor, 'CORRECTION_STARTED', cr.id, {
        studyUid,
        studyId: study.id,
        correctionRequestId: cr.id,
        newReportId: newReport.id,
        newVersion,
        from: locked.study.status,
        to: 'REPORT_DRAFT',
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.role,
          actorRole: actor.role,
          action: 'STUDY_STATUS_CHANGED',
          resource: 'STUDY',
          resourceId: study.id,
          metadata: {
            from: locked.study.status,
            to: 'REPORT_DRAFT',
            studyUid,
            correctionRequestId: cr.id,
          } as Prisma.InputJsonValue,
        },
      });

      return { newReport, correctionRequestId: cr.id };
    });

    await this.notifications.notifyManagers({
      type: 'CORRECTION_STARTED',
      title: 'Correction in progress',
      message: `A radiologist has started the corrected report`,
      studyId: study.id,
      correctionRequestId: result.correctionRequestId,
    });

    return { data: result.newReport };
  }

  /**
   * Called from within the signing transaction (ReportsService.signOff) after the
   * new ReportVersion is created. Resolves the correction (lineage + audit).
   */
  async finalizeTx(
    tx: Prisma.TransactionClient,
    studyId: string,
    reportVersionId: string,
    actor: Actor,
  ) {
    const cr = await tx.changeRequest.findFirst({
      where: {
        studyId,
        status: { in: [ChangeRequestStatus.APPROVED, ChangeRequestStatus.IN_PROGRESS] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!cr) return null;

    await tx.changeRequest.update({
      where: { id: cr.id },
      data: {
        status: 'RESOLVED',
        newReportVersionId: reportVersionId,
        resolvedAt: new Date(),
      },
    });

    await this.auditTx(tx, actor, 'CORRECTED_REPORT_SIGNED', cr.id, {
      studyId,
      correctionRequestId: cr.id,
      newReportVersionId: reportVersionId,
    });
    await this.auditTx(tx, actor, 'CORRECTION_RESOLVED', cr.id, {
      studyId,
      correctionRequestId: cr.id,
      newReportVersionId: reportVersionId,
      correctionStatus: 'RESOLVED',
    });

    return cr.id;
  }

  /**
   * After a corrected report is signed, notify the operational reviewer
   * (manager) that it awaits review.
   */
  async notifyCorrectedSigned(studyId: string) {
    await this.notifications.notifyManagers({
      type: 'CORRECTED_REPORT_SIGNED',
      title: 'Corrected report awaiting review',
      message: 'A corrected report was signed and is ready for manager review',
      studyId,
    });
  }
}
