import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ReviewsService, HOSPITAL_VISIBLE_STATES } from '../reviews/reviews.service.js';
import { StudiesService, ALLOWED_TRANSITIONS, TRANSITION_ACTORS } from '../studies/studies.service.js';
import { resolveStudyUid } from '../studies/study-identifier.js';
import { assertSuccessfulDelivery } from '../common/visibility/hospital-delivery.js';
import { CorrectionsService } from '../corrections/corrections.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { htmlToPlainText, sanitizeReportHtml } from '../common/html.js';
import {
  contentHash,
  hasRequiredReportContent,
  type ReportContent,
} from '../common/reports/report-content.js';
import type { AuditAction, AuditResource } from '@axis/types';
import type { Response } from 'express';
import type { UserRole } from '@prisma/client';
import { Prisma, ReportStatus, StudyStatus } from '@prisma/client';

export type { ReportContent } from '../common/reports/report-content.js';
export { contentHash } from '../common/reports/report-content.js';

// States in which a draft may be created / edited.
const DRAFTABLE_STATES: StudyStatus[] = [
  StudyStatus.ASSIGNED,
  StudyStatus.IN_READING,
  StudyStatus.REPORT_DRAFT,
];

interface Actor {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly studies: StudiesService,
    private readonly reviews: ReviewsService,
    private readonly corrections: CorrectionsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async auditLog(
    actor: Actor,
    action: AuditAction,
    resource: AuditResource,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.audit.create({
      actorId: actor.id,
      actorName: actor.displayName ?? actor.role,
      actorRole: actor.role,
      action,
      resource,
      resourceId,
      metadata,
    });
  }

  private assertCanAccessStudy(
    actor: Actor,
    study: { id: string; hospitalId: string; assignedRadiologistId: string | null; status: string },
    allowManagement = false,
  ) {
    if (actor.role === 'HOSPITAL') {
      if (study.hospitalId !== actor.hospitalId) {
        throw new ForbiddenException('You do not have access to studies from this hospital');
      }
      return;
    }
    if (actor.role === 'RADIOLOGIST') {
      if (study.assignedRadiologistId !== actor.id) {
        throw new ForbiddenException('You do not have access to studies not assigned to you');
      }
      return;
    }
    if (!allowManagement && !['ADMIN', 'MANAGER'].includes(actor.role)) {
      throw new ForbiddenException('You do not have permission to access this record');
    }
  }

  private async getStudy(studyUid: string) {
    const uid = await resolveStudyUid(this.prisma, studyUid);
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: uid },
    });
    if (!study) throw new NotFoundException(`Study ${uid} not found`);
    return study;
  }

  /**
   * Phase 5 — report-visibility gate for HOSPITAL users.
   *
   * A hospital must not see a clinical report merely because it exists in the
   * database and belongs to their hospital. The final report is only exposed to
   * the hospital once it has been delivered (DELIVERED_TO_HOSPITAL and later).
   * This prevents a hospital from reading the report during RADIOLOGIST_SIGNED /
   * MANAGER_REVIEW / MANAGER_APPROVED.
   */
  private assertHospitalReportVisibility(
    study: { status: string; hospitalId: string | null },
    actor: Actor,
  ) {
    if (actor.role !== 'HOSPITAL') return;
    if (!study.hospitalId || study.hospitalId !== actor.hospitalId) {
      throw new ForbiddenException('You do not have access to studies from this hospital');
    }
    if (!HOSPITAL_VISIBLE_STATES.includes(study.status as any)) {
      throw new ForbiddenException(
        'The final report is not yet available for this study.',
      );
    }
  }

  private async getLatestReport(studyId: string) {
    return this.prisma.report.findFirst({
      where: { studyId },
      include: { author: true },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Confirms the authenticated actor is the assigned radiologist for the study.
   * The actor identity always comes from the authenticated session, never from
   * submitted client fields.
   */
  private assertAssignedRadiologist(
    study: { assignedRadiologistId: string | null },
    actor: Actor,
  ) {
    if (actor.role !== 'RADIOLOGIST') {
      throw new ForbiddenException('Only the assigned radiologist can create or edit the clinical report');
    }
    if (!study.assignedRadiologistId || study.assignedRadiologistId !== actor.id) {
      throw new ForbiddenException('Only the assigned radiologist can create or edit this report');
    }
  }

  /**
   * Applies a workflow transition to the study for a draft create/edit.
   *
   * Drafting is a reading activity: when the assigned radiologist starts a draft
   * while the study is still ASSIGNED or IN_READING, we advance it to REPORT_DRAFT
   * through the authoritative workflow transition mechanism (StudiesService), so
   * the state-machine actor rules and STUDY_STATUS_CHANGED audit remain the
   * single source of truth.
   */
  /**
   * Advancing to REPORT_DRAFT goes through the authoritative workflow
   * state machine (StudiesService.updateStatus), preserving transition rules
   * and emitting the STUDY_STATUS_CHANGED audit. From ASSIGNED the legal chain
   * is ASSIGNED -> IN_READING -> REPORT_DRAFT; from IN_READING it is a single
   * transition to REPORT_DRAFT. REPORT_DRAFT is left untouched.
   */
  private async ensureDraftState(study: { studyInstanceUid: string; status: StudyStatus }, actor: Actor) {
    if (study.status === StudyStatus.REPORT_DRAFT) return;
    if (study.status === StudyStatus.ASSIGNED) {
      await this.studies.updateStatus(study.studyInstanceUid, { status: 'IN_READING' as StudyStatus }, actor);
    }
    if (study.status === StudyStatus.ASSIGNED || study.status === StudyStatus.IN_READING) {
      await this.studies.updateStatus(study.studyInstanceUid, { status: 'REPORT_DRAFT' as StudyStatus }, actor);
    }
  }

  async list(user: Actor, query: { page?: string; pageSize?: string } = {}) {
    const page = Math.max(parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(query.pageSize ?? '20', 10) || 20, 1), 100);
    const take = pageSize;
    const skip = (page - 1) * pageSize;
    const where: Record<string, unknown> = {};
    if (user.role === 'HOSPITAL') {
      // A HOSPITAL account with no linked hospital must never fall through to
      // an unscoped query (which would expose every hospital's reports).
      if (!user.hospitalId) {
        throw new ForbiddenException('Your account is not linked to a hospital');
      }
      where.study = {
        hospitalId: user.hospitalId,
        status: { in: [...HOSPITAL_VISIBLE_STATES] },
        deliveryAttempts: {
          some: { hospitalId: user.hospitalId, status: 'COMPLETED' },
        },
      };
    } else if (user.role === 'RADIOLOGIST') {
      where.study = { assignedRadiologistId: user.id };
    }

    const [total, reports] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        include: {
          study: {
            include: { patient: true, hospital: true },
          },
          author: true,
        },
        orderBy: { updatedAt: 'desc' },
        take,
        skip,
      }),
    ]);
    return {
      data: reports,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async hospitalReports(user: Actor, query: { page?: string; pageSize?: string } = {}) {
    const page = Math.max(parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(query.pageSize ?? '20', 10) || 20, 1), 100);
    const take = pageSize;
    const skip = (page - 1) * pageSize;
    if (user.role === 'HOSPITAL' && !user.hospitalId) {
      throw new ForbiddenException('Your account is not linked to a hospital');
    }

    const where: Record<string, unknown> = {
      status: { in: ['SIGNED', 'MANAGER_APPROVED'] },
      deliveryAttempts: {
        some: { hospitalId: user.hospitalId!, status: 'COMPLETED' },
      },
      study: {
        hospitalId: user.hospitalId!,
        status: { in: HOSPITAL_VISIBLE_STATES },
      },
    };

    const [total, reports] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        include: {
          study: {
            include: { patient: true, hospital: true },
          },
          author: true,
        },
        orderBy: { updatedAt: 'desc' },
        take,
        skip,
      }),
    ]);
    return {
      data: reports,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getByStudy(studyUid: string, user?: Actor) {
    const study = await this.getStudy(studyUid);
    if (user) {
      this.assertCanAccessStudy(user, study, true);
      this.assertHospitalReportVisibility(study, user);
    }

    const include = { author: true, versions: true, changeRequests: true };

    // Radiologists need the newest active row for editing (including a fresh
    // amendment draft). Reviewers and hospital users must never be shown that
    // draft as the current report, so prefer the newest signed/approved row.
    const finalReport =
      user?.role === 'RADIOLOGIST'
        ? null
        : await this.prisma.report.findFirst({
            where: {
              studyId: study.id,
              status: { in: [ReportStatus.SIGNED, ReportStatus.MANAGER_APPROVED] },
            },
            include,
            orderBy: { version: 'desc' },
          });

    const report =
      finalReport ??
      (await this.prisma.report.findFirst({
        where: { studyId: study.id },
        include,
        orderBy: { version: 'desc' },
      }));
    if (user?.role === 'HOSPITAL' && report) {
      await assertSuccessfulDelivery(this.prisma, study.id, user.hospitalId, report.id);
    }

    return { data: report };
  }

  /**
   * Retrieve the immutable version history for a study's report(s).
   * Authorization mirrors the existing service-level scope rules.
   */
  async getVersions(studyUid: string, user: Actor) {
    const study = await this.getStudy(studyUid);
    this.assertCanAccessStudy(user, study, true);
    this.assertHospitalReportVisibility(study, user);

    if (user.role === 'HOSPITAL') {
      const signed = await this.getLatestReport(study.id);
      if (signed) {
        await assertSuccessfulDelivery(this.prisma, study.id, user.hospitalId, signed.id);
      }
    }

    const versions = await this.prisma.reportVersion.findMany({
      where: { report: { studyId: study.id } },
      include: { author: true },
      orderBy: [{ version: 'asc' }, { createdAt: 'asc' }],
    });

    return { data: versions };
  }

  /**
   * Idempotent draft save. Creating a draft repeatedly does NOT create duplicate
   * active drafts: an existing DRAFT is updated in place. When the study has no
   * report yet, a new v1 DRAFT is created and the study advances to REPORT_DRAFT
   * through the workflow state machine.
   */
  async saveDraft(
    studyUid: string,
    dto: ReportContent,
    actor: Actor,
  ) {
    const study = await this.getStudy(studyUid);
    this.assertAssignedRadiologist(study, actor);

    const content: ReportContent = {
      clinicalHistory: dto.clinicalHistory ?? '',
      findings: dto.findings ?? '',
      impression: dto.impression ?? '',
      technique: dto.technique ?? '',
      comparison: dto.comparison ?? '',
      recommendations: dto.recommendations ?? '',
      criticalFinding: dto.criticalFinding ?? false,
    };
    if (dto.contentHtml !== undefined) {
      content.contentHtml = sanitizeReportHtml(dto.contentHtml ?? '');
    }
    const hash = contentHash(content);

    // Serialize draft creation per study. Without this lock, two concurrent
    // first-save requests can both observe "no report" and create duplicate v1
    // drafts. The unique (studyId, version) constraint is the final backstop.
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Study" WHERE id = ${study.id} FOR UPDATE`;

      const existing = await tx.report.findFirst({
        where: { studyId: study.id },
        orderBy: { version: 'desc' },
      });

      // Immutability: once a report is signed (or otherwise final), no metadata
      // or content mutations are permitted.
      if (existing && existing.status !== 'DRAFT') {
        throw new ConflictException(
          `The report is ${existing.status} and can no longer be edited. Corrections require the correction workflow.`,
        );
      }

      if (!DRAFTABLE_STATES.includes(study.status)) {
        throw new BadRequestException(
          `A report draft can only be saved while the study is in ${DRAFTABLE_STATES.join(', ')} (currently ${study.status}).`,
        );
      }

      if (existing) {
        // Preserve any field the caller did not send. Rich-editor saves only
        // send contentHtml + criticalFinding; structured/legacy saves only send
        // the individual fields. Neither path may blank the other.
        const effectiveContent: ReportContent = {
          clinicalHistory: dto.clinicalHistory ?? existing.clinicalHistory,
          findings: dto.findings ?? existing.findings,
          impression: dto.impression ?? existing.impression,
          technique: dto.technique ?? existing.technique,
          comparison: dto.comparison ?? existing.comparison,
          recommendations: dto.recommendations ?? existing.recommendations,
          criticalFinding: dto.criticalFinding ?? existing.criticalFinding,
          contentHtml:
            dto.contentHtml !== undefined
              ? content.contentHtml
              : existing.contentHtml ?? undefined,
        };
        const report = await tx.report.update({
          where: { id: existing.id },
          data: {
            ...effectiveContent,
            contentHash: contentHash(effectiveContent),
          },
          include: { author: true },
        });
        return { report, created: false };
      }

      const report = await tx.report.create({
        data: {
          studyId: study.id,
          authorId: actor.id,
          status: 'DRAFT',
          version: 1,
          ...content,
          contentHash: hash,
        },
        include: { author: true },
      });
      return { report, created: true };
    });

    // A draft save is the recovery path for a study left in IN_READING (for
    // example by an interrupted amendment), so advance the workflow for both
    // newly created and existing drafts.
    if (study.status !== StudyStatus.REPORT_DRAFT) {
      await this.ensureDraftState(study, actor);
    }

    // A draft can be created/edited while the study is ASSIGNED, IN_READING or
    // REPORT_DRAFT. The workflow state must be normalised to REPORT_DRAFT on
    // EVERY save (not just the first draft creation): if the study was moved
    // back out of REPORT_DRAFT (reassignment, correction, etc.) while a draft
    // already existed, leaving it in ASSIGNED/IN_READING would keep sign-off
    // permanently disabled. ensureDraftState is idempotent and early-returns
    // when the study is already REPORT_DRAFT.
    await this.ensureDraftState(
      { studyInstanceUid: study.studyInstanceUid, status: study.status },
      actor,
    );

    await this.auditLog(
      actor,
      saved.created ? 'REPORT_CREATED' : 'REPORT_EDITED',
      'REPORT',
      saved.report.id,
      {
        studyUid,
        studyStatus: saved.created ? study.status : undefined,
        version: saved.report.version,
      },
    );

    return { data: saved.report };
  }

  /**
   * Alias kept for API ergonomics: POST /reports/:studyUid saves the draft
   * (find-or-update). Identical authorization and idempotency semantics.
   */
  createOrUpdate(studyUid: string, dto: ReportContent, actor: Actor) {
    return this.saveDraft(studyUid, dto, actor);
  }

  /**
   * Sign / finalize a report. Fully transactional:
   *   - validates the actor is the assigned radiologist
   *   - validates the report exists, is a draft, and is complete
   *   - validates the study can transition to RADIOLOGIST_SIGNED
   *   - guards against double signing
   *   - persists an immutable ReportVersion snapshot with the server-side hash
   *   - marks the Report signed (signedBy/signedAt), transitions the study,
   *     and writes audit rows -- all in a single Prisma transaction.
   */
  async signOff(studyUid: string, actor: Actor) {
    const uid = await resolveStudyUid(this.prisma, studyUid);
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: uid },
    });
    if (!study) throw new NotFoundException(`Study ${uid} not found`);
    this.assertAssignedRadiologist(study, actor);

    const report = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      orderBy: { version: 'desc' },
    });
    if (!report) throw new NotFoundException(`No report found for study ${studyUid}`);
    if (report.status === 'SIGNED' || report.signedOffAt) {
      throw new ConflictException('This report has already been signed and cannot be signed again');
    }
    if (report.status !== 'DRAFT') {
      throw new BadRequestException(`Only a draft report can be signed (current status: ${report.status})`);
    }
    if (!hasRequiredReportContent(report)) {
      throw new BadRequestException(
        'The report must have findings and impression (or rich report content) before it can be signed',
      );
    }

    // Honor the authoritative workflow transition rules: REPORT_DRAFT -> RADIOLOGIST_SIGNED (actor: RADIOLOGIST).
    const allowed = ALLOWED_TRANSITIONS[study.status as StudyStatus] || [];
    if (!allowed.includes(StudyStatus.RADIOLOGIST_SIGNED)) {
      throw new BadRequestException(
        `Cannot sign a report while the study is in ${study.status}. The study must be in REPORT_DRAFT (or a valid pre-signing state).`,
      );
    }
    const actors = TRANSITION_ACTORS[StudyStatus.RADIOLOGIST_SIGNED] || [];
    if (!actors.includes(actor.role)) {
      throw new ForbiddenException(`Your role (${actor.role}) is not authorized to sign reports into RADIOLOGIST_SIGNED`);
    }

    const now = new Date();
    const signed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Study" WHERE id = ${study.id} FOR UPDATE`;
      const currentStudy = await tx.study.findUnique({
        where: { id: study.id },
      });
      if (!currentStudy) throw new NotFoundException(`Study ${uid} not found`);

      const latest = await tx.report.findFirst({
        where: { studyId: study.id },
        orderBy: { version: 'desc' },
      });
      if (!latest) throw new NotFoundException(`No report found for study ${studyUid}`);
      if (latest.status === 'SIGNED' || latest.signedOffAt) {
        throw new ConflictException('This report has already been signed and cannot be signed again');
      }
      if (latest.status !== 'DRAFT') {
        throw new BadRequestException(`Only a draft report can be signed (current status: ${latest.status})`);
      }
      if (!hasRequiredReportContent(latest)) {
        throw new BadRequestException(
          'The report must have findings and impression (or rich report content) before it can be signed',
        );
      }
      if (!ALLOWED_TRANSITIONS[currentStudy.status]?.includes(StudyStatus.RADIOLOGIST_SIGNED)) {
        throw new BadRequestException(
          `Cannot sign a report while the study is in ${currentStudy.status}. The study must be in REPORT_DRAFT (or a valid pre-signing state).`,
        );
      }

      const updated = await tx.report.update({
        where: { id: latest.id },
        data: {
          status: 'SIGNED',
          signedOffBy: actor.id,
          signedOffAt: now,
          contentHash: latest.contentHash,
        },
      });

      let createdVersion;
      try {
        createdVersion = await tx.reportVersion.create({
          data: {
            reportId: latest.id,
            version: latest.version,
            status: 'SIGNED',
            clinicalHistory: latest.clinicalHistory,
            findings: latest.findings,
            impression: latest.impression,
            technique: latest.technique,
            comparison: latest.comparison,
            recommendations: latest.recommendations,
            contentHtml: latest.contentHtml,
            authorId: latest.authorId,
            contentHash: latest.contentHash,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('This report version was already signed');
        }
        throw error;
      }

      // If this signing finalizes an approved correction, link the new immutable
      // version as the correction's lineage (newReportVersionId) and resolve the
      // correction — all within this transaction. The original signed version is
      // never modified.
      const correctionRequestId = await this.corrections.finalizeTx(
        tx,
        study.id,
        createdVersion.id,
        actor,
      );

      const updatedStudy = await tx.study.update({
        where: { id: study.id },
        data: { status: 'RADIOLOGIST_SIGNED', signedOffAt: now },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.role,
          actorRole: actor.role,
          action: 'REPORT_SIGNED',
          resource: 'REPORT',
          resourceId: latest.id,
          metadata: {
            studyUid,
            studyId: study.id,
            reportId: latest.id,
            version: latest.version,
            versionId: createdVersion.id,
            contentHash: latest.contentHash,
            signedBy: actor.id,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.role,
          actorRole: actor.role,
          action: 'STUDY_STATUS_CHANGED',
          resource: 'STUDY',
          resourceId: study.id,
          metadata: { from: currentStudy.status, to: 'RADIOLOGIST_SIGNED', studyUid },
        },
      });

      return { updated, updatedStudy, correctionRequestId };
    });

    // Notify the operational reviewer that a corrected report awaits review.
    if (signed.correctionRequestId) {
      await this.corrections.notifyCorrectedSigned(study.id);
    }

    return { data: signed.updated };
  }

  async amend(
    studyUid: string,
    dto: ReportContent & { reason: string },
    actor: Actor,
  ) {
    const uid = await resolveStudyUid(this.prisma, studyUid);
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: uid },
    });
    if (!study) throw new NotFoundException(`Study ${uid} not found`);
    this.assertAssignedRadiologist(study, actor);

    const reason = dto.reason?.trim() ?? '';
    if (!reason) {
      throw new BadRequestException('An amendment reason is required');
    }

    if (study.status !== StudyStatus.RADIOLOGIST_SIGNED) {
      throw new BadRequestException(
        `An amendment can only be initiated while the study is in RADIOLOGIST_SIGNED (currently ${study.status}).`,
      );
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Study" WHERE id = ${study.id} FOR UPDATE`;
      const currentStudy = await tx.study.findUnique({
        where: { id: study.id },
      });
      if (!currentStudy) throw new NotFoundException(`Study ${uid} not found`);
      if (currentStudy.status !== StudyStatus.RADIOLOGIST_SIGNED) {
        throw new ConflictException(
          `An amendment can only be initiated while the study is in RADIOLOGIST_SIGNED (currently ${currentStudy.status}).`,
        );
      }

      let transitionFrom: StudyStatus = currentStudy.status;
      for (const target of [StudyStatus.IN_READING, StudyStatus.REPORT_DRAFT]) {
        if (!ALLOWED_TRANSITIONS[transitionFrom]?.includes(target)) {
          throw new BadRequestException(
            `Invalid status transition ${transitionFrom} -> ${target}`,
          );
        }
        if (!TRANSITION_ACTORS[target]?.includes(actor.role)) {
          throw new ForbiddenException(
            `Your role (${actor.role}) is not authorized to transition to ${target}`,
          );
        }
        transitionFrom = target;
      }

      const previous = await tx.report.findFirst({
        where: { studyId: study.id },
        orderBy: { version: 'desc' },
      });

      if (!previous) {
        throw new NotFoundException(`No report found for study ${studyUid}`);
      }

      if (previous.status !== 'SIGNED' || !previous.signedOffBy || !previous.signedOffAt) {
        throw new BadRequestException(
          `Only a signed report can be amended (current status: ${previous.status})`,
        );
      }

      const signedVersion = await tx.reportVersion.findFirst({
        where: { reportId: previous.id, version: previous.version },
      });
      if (!signedVersion) {
        await tx.reportVersion.create({
          data: {
            reportId: previous.id,
            version: previous.version,
            status: previous.status,
            clinicalHistory: previous.clinicalHistory,
            findings: previous.findings,
            impression: previous.impression,
            technique: previous.technique,
            comparison: previous.comparison,
            recommendations: previous.recommendations,
            contentHtml: previous.contentHtml,
            authorId: previous.authorId,
            contentHash: previous.contentHash,
          },
        });
      }

      const content: ReportContent = {
        clinicalHistory: dto.clinicalHistory ?? previous.clinicalHistory ?? '',
        findings: dto.findings ?? previous.findings ?? '',
        impression: dto.impression ?? previous.impression ?? '',
        technique: dto.technique ?? previous.technique ?? '',
        comparison: dto.comparison ?? previous.comparison ?? '',
        recommendations: dto.recommendations ?? previous.recommendations ?? '',
        criticalFinding: dto.criticalFinding ?? previous.criticalFinding ?? false,
        contentHtml:
          dto.contentHtml !== undefined
            ? sanitizeReportHtml(dto.contentHtml ?? '')
            : previous.contentHtml ?? undefined,
      };
      const newVersion = previous.version + 1;
      const hash = contentHash(content);

      const created = await tx.report.create({
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

      await tx.study.update({
        where: { id: study.id },
        data: { status: StudyStatus.IN_READING, reportingStartedAt: now },
      });
      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: 'STUDY_STATUS_CHANGED',
        resource: 'STUDY',
        resourceId: study.id,
        metadata: { from: currentStudy.status, to: StudyStatus.IN_READING, studyUid },
      });

      await tx.study.update({
        where: { id: study.id },
        data: { status: StudyStatus.REPORT_DRAFT },
      });
      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: 'STUDY_STATUS_CHANGED',
        resource: 'STUDY',
        resourceId: study.id,
        metadata: { from: StudyStatus.IN_READING, to: StudyStatus.REPORT_DRAFT, studyUid },
      });

      await this.audit.createTx(tx, {
        actorId: actor.id,
        actorName: actor.displayName ?? actor.role,
        actorRole: actor.role,
        action: 'REPORT_AMENDED',
        resource: 'REPORT',
        resourceId: created.id,
        metadata: {
          studyUid,
          amendmentReason: reason,
          amendedBy: actor.id,
          amendedAt: now.toISOString(),
          previousReportId: previous.id,
          previousVersion: previous.version,
          newReportId: created.id,
          newVersion: created.version,
        },
      });

      return { created, previous };
    });

    return { data: result.created };
  }

  /**
   * RADIOLOGIST_SIGNED -> MANAGER_REVIEW (ADMIN/MANAGER).
   * Delegates to the authoritative ReviewsService lifecycle (transactional +
   * audited + prerequisite-validated) so no status bypass is possible.
   */
  async verify(studyUid: string, actor: Actor) {
    return this.reviews.review(studyUid, actor);
  }

  /**
   * MANAGER_REVIEW -> MANAGER_APPROVED (ADMIN/MANAGER).
   * Delegates to ReviewsService.approve.
   */
  async release(studyUid: string, actor: Actor) {
    return this.reviews.approve(studyUid, actor);
  }

  /**
   * MANAGER_APPROVED -> DELIVERED_TO_HOSPITAL (ADMIN/MANAGER).
   * Delegates to ReviewsService.deliver which records a DeliveryAttempt and
   * delivers to the authoritative study.hospitalId.
   */
  async deliver(studyUid: string, actor: Actor) {
    return this.reviews.deliver(studyUid, actor);
  }

  async validate(
    studyUid: string,
    dto: { status: 'SIGNED' | 'DRAFT'; reason?: string },
    actor: Actor,
  ) {
    if (!['ADMIN', 'MANAGER'].includes(actor.role)) {
      throw new ForbiddenException('Only admin or manager can validate reports');
    }
    if (dto.status === 'DRAFT') {
      throw new BadRequestException(
        'A signed report cannot be reverted to DRAFT. Use the amendment or correction workflow.',
      );
    }
    return this.verify(studyUid, actor);
  }

  async changeRequests(user: Actor) {
    const where: Record<string, unknown> = {};
    if (user.role === 'RADIOLOGIST') {
      where.assignedToId = user.id;
    }

    const requests = await this.prisma.changeRequest.findMany({
      where,
      include: {
        study: { include: { patient: true, hospital: true } },
        report: true,
        requestedBy: { select: { id: true, displayName: true, role: true } },
        assignedTo: { select: { id: true, displayName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: requests };
  }

  async requestChange(studyUid: string, dto: { reason: string }, actor: Actor) {
    if (!['ADMIN', 'MANAGER'].includes(actor.role)) {
      throw new ForbiddenException('Only admin or manager can request report changes');
    }
    const study = await this.getStudy(studyUid);
    if (!study.assignedRadiologistId) {
      throw new BadRequestException('Study has no radiologist assigned to receive the change request');
    }
    const report = await this.getLatestReport(study.id);
    if (!report) throw new NotFoundException(`No report found for study ${studyUid}`);

    const changeRequest = await this.prisma.changeRequest.create({
      data: {
        studyId: study.id,
        reportId: report.id,
        requestedById: actor.id,
        assignedToId: study.assignedRadiologistId,
        reason: dto.reason,
        status: 'OPEN',
      },
      include: {
        study: true,
        requestedBy: { select: { id: true, displayName: true, role: true } },
      },
    });

    await this.prisma.report.update({ where: { id: report.id }, data: { status: 'CORRECTION_REQUESTED' } });
    await this.prisma.study.update({ where: { id: study.id }, data: { status: 'CORRECTION_REQUESTED' } });

    await this.auditLog(actor, 'CHANGE_REQUESTED', 'CHANGE_REQUEST', changeRequest.id, { studyUid, reportId: report.id, result: 'request_created' });

    try {
      await this.notifications.notifyRadiologist(changeRequest.assignedToId, {
        type: 'REPORT_RETURNED',
        title: 'Report returned',
        message: 'A report was returned to you for revision.',
        studyId: study.id,
      });
    } catch {
      this.logger.warn('Could not persist report-return notification.');
    }

    return { data: changeRequest };
  }

  async respondChangeRequest(id: string, dto: { resolution: string }, actor: Actor) {
    const changeRequest = await this.prisma.changeRequest.findUnique({
      where: { id },
      include: { study: true },
    });
    if (!changeRequest) throw new NotFoundException(`Change request ${id} not found`);
    if (changeRequest.assignedToId !== actor.id) {
      throw new ForbiddenException('This change request is assigned to another user');
    }

    const updated = await this.prisma.changeRequest.update({
      where: { id },
      data: { status: 'RESOLVED', resolution: dto.resolution, resolvedAt: new Date() },
    });

    await this.prisma.study.update({ where: { id: changeRequest.studyId }, data: { status: 'IN_READING' } });

    await this.auditLog(actor, 'REPORT_REVISED', 'CHANGE_REQUEST', changeRequest.id, { studyUid: changeRequest.study.studyInstanceUid, result: 'responded' });

    return { data: updated };
  }

  async hospitalPdf(studyUid: string, user: Actor, res: Response) {
    const uid = await resolveStudyUid(this.prisma, studyUid);
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: uid },
      include: { patient: true, hospital: true },
    });
    if (!study) throw new NotFoundException(`Study ${uid} not found`);

    if (user.role === 'HOSPITAL' && study.hospitalId !== user.hospitalId) {
      throw new ForbiddenException('You do not have access to studies from this hospital');
    }
    if (!HOSPITAL_VISIBLE_STATES.includes(study.status)) {
      throw new NotFoundException('Final report is not yet available for this study');
    }

    const report = await this.prisma.report.findFirst({
      where: { studyId: study.id, status: { in: ['SIGNED', 'MANAGER_APPROVED'] } },
      orderBy: { version: 'desc' },
      include: { author: true },
    });
    if (!report) throw new NotFoundException(`No final report found for study ${studyUid}`);
    if (user.role === 'HOSPITAL') {
      await assertSuccessfulDelivery(this.prisma, study.id, user.hospitalId, report.id);
    }

    const company = await this.prisma.companySettings.findUnique({
      where: { id: 'default' },
    });
    const pdf = this.buildPdf({ study, report, company });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${study.accessionNumber}.pdf"`);
    res.setHeader('Content-Length', Buffer.byteLength(pdf));
    res.send(Buffer.from(pdf, 'binary'));
  }

  private escapePdfText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  /**
   * Code 128-B bar positions for the report identifier. Kept as rectangles in
   * the PDF content stream so the hospital PDF carries the same scannable
   * identifier as the on-screen/print preview (no external barcode library).
   */
  private code128Bars(value: string): Array<{ x: number; width: number }> {
    const patterns = [
      '212222', '222122', '222221', '121223', '121322', '131222', '122213',
      '122312', '132212', '221213', '221312', '231212', '112232', '122132',
      '122231', '113222', '123122', '123221', '223211', '221132', '221231',
      '213212', '223112', '312131', '311222', '321122', '321221', '312212',
      '322112', '322211', '212123', '212321', '232121', '111323', '131123',
      '131321', '112313', '132113', '132311', '211313', '231113', '231311',
      '112133', '112331', '132131', '113123', '113321', '133121', '313121',
      '211331', '231131', '213113', '213311', '213131', '311123', '311321',
      '331121', '312113', '312311', '332111', '314111', '221411', '431111',
      '111224', '111422', '121124', '121421', '141122', '141221', '112214',
      '112412', '122114', '122411', '142112', '142211', '241211', '221114',
      '413111', '241112', '134111', '111242', '121142', '121241', '114212',
      '124112', '124211', '411212', '421112', '421211', '212141', '214121',
      '412121', '111143', '111341', '131141', '114113', '114311', '411113',
      '411311', '113141', '114131', '311141', '411131', '211412', '211214',
      '211232', '2331112',
    ];
    const clean = value.replace(/[^\x20-\x7E]/g, '');
    if (!clean) return [];
    const codes: number[] = [];
    let checksum = 104;
    for (let i = 0; i < clean.length; i += 1) {
      const code = clean.charCodeAt(i) - 32;
      codes.push(code);
      checksum += code * (i + 1);
    }
    const sequence = [104, ...codes, checksum % 103, 106];
    const bars: Array<{ x: number; width: number }> = [];
    let x = 0;
    for (const code of sequence) {
      const pattern = patterns[code];
      if (!pattern) continue;
      for (let i = 0; i < pattern.length; i += 1) {
        const width = Number(pattern[i]);
        if (i % 2 === 0) bars.push({ x, width });
        x += width;
      }
    }
    return bars;
  }

  private buildPdf(opts: { study: any; report: any; company?: any }): string {
    const { study, report, company } = opts;

    const lines: string[] = [];
    const push = (text: string) => lines.push(text);
    const pushKey = (key: string, value: string) => push(`${key}: ${value}`);

    push('AXIS RADIOLOGY PACS - FINAL RADIOLOGY REPORT');
    push('---------------------------------------------');
    push('');
    pushKey('Accession #', study.accessionNumber);
    pushKey('Study UID', study.studyInstanceUid);
    pushKey('Study Date', study.studyDate ? new Date(study.studyDate).toISOString().slice(0, 10) : '');
    pushKey('Modality', study.modality);
    pushKey('Body Part', study.bodyPart);
    pushKey('Study Description', study.studyDescription);
    pushKey('Referring Physician', study.referringPhysician);
    pushKey('Hospital', study.hospital?.name ?? '');
    push('');
    push('PATIENT');
    push('-------');
    pushKey('Name', study.patient?.displayName ?? '');
    pushKey('Patient ID', study.patient?.patientId ?? '');
    pushKey('DOB', study.patient?.dateOfBirth ? new Date(study.patient.dateOfBirth).toISOString().slice(0, 10) : '');
    pushKey('Gender', study.patient?.gender ?? '');
    push('');
    push('CLINICAL HISTORY');
    push('----------------');
    push(report.clinicalHistory || study.clinicalHistory || 'N/A');
    push('');
    push('TECHNIQUE');
    push('---------');
    push(report.technique || 'N/A');
    push('');
    push('COMPARISON / PRIORS');
    push('-------------------');
    push(report.comparison || 'N/A');

    if (htmlToPlainText(report.contentHtml)) {
      push('');
      push('REPORT BODY');
      push('-----------');
      for (const line of htmlToPlainText(report.contentHtml).split('\n')) {
        push(line);
      }
    } else {
      push('');
      push('FINDINGS');
      push('--------');
      push(report.findings || 'N/A');
      push('');
      push('IMPRESSION');
      push('----------');
      push(report.impression || 'N/A');
      if (report.recommendations) {
        push('');
        push('RECOMMENDATIONS');
        push('---------------');
        push(report.recommendations);
      }
    }
    if (report.criticalFinding) {
      push('');
      push('*** CRITICAL FINDING - ACTION REQUIRED ***');
    }
    push('');
    push('------------------------------------------------');
    pushKey('Report Status', report.status);
    pushKey('SIGNED OFF BY', report.signedOffBy ?? '');
    if (report.signedOffAt) pushKey('Signed Off At', new Date(report.signedOffAt).toISOString());
    pushKey('Report Version', String(report.version));
    pushKey('Report ID', report.id);
    pushKey('Content Hash', report.contentHash ?? '');
    push('');
    push('------------------------------------------------');
    push('REPORT FOOTER');
    push('-------------');
    pushKey(
      'Company',
      company?.name || study.hospital?.name || '[Company name not configured]',
    );
    pushKey('Phone', company?.phone || '[Company phone not configured]');
    pushKey('Email', company?.email || '[Company email not configured]');
    pushKey(
      'About',
      company?.description || '[Company description not configured]',
    );
    push(
      company?.disclaimer ||
        '[Report disclaimer not configured - contact your administrator]',
    );
    push(`Barcode: ${report.id}`);

    const contentLines = lines.map((l) => this.escapePdfText(l));

    let pdf = '%PDF-1.4\n';
    const objects: string[] = [];

    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');

    let contentStream = 'BT /F1 11 Tf 50 790 Td 16 TL\n';
    for (const l of contentLines) {
      contentStream += `(${l}) Tj T*\n`;
    }
    contentStream += 'ET\n';

    // Scannable report identifier in the lower-right footer area.
    const barcodeBars = this.code128Bars(String(report.id));
    if (barcodeBars.length > 0) {
      const unit = 0.42;
      const startX = 400;
      const baseY = 30;
      const barHeight = 40;
      contentStream += 'q 0 0 0 rg\n';
      for (const bar of barcodeBars) {
        contentStream += `${(startX + bar.x * unit).toFixed(2)} ${baseY} ${(bar.width * unit).toFixed(2)} ${barHeight} re f\n`;
      }
      contentStream += 'Q\n';
    }

    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
    objects.push(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    const offsets: number[] = [0];
    let byteLength = Buffer.byteLength(pdf, 'binary');

    for (let i = 0; i < objects.length; i++) {
      offsets.push(byteLength);
      const obj = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
      pdf += obj;
      byteLength += Buffer.byteLength(obj, 'binary');
    }

    const xrefStart = byteLength;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return pdf;
  }
}
