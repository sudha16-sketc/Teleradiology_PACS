import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ReviewsService, HOSPITAL_VISIBLE_STATES } from '../reviews/reviews.service.js';
import { StudiesService, ALLOWED_TRANSITIONS, TRANSITION_ACTORS } from '../studies/studies.service.js';
import { CorrectionsService } from '../corrections/corrections.service.js';
import type { AuditAction, AuditResource } from '@axis/types';
import { createHash } from 'crypto';
import type { Response } from 'express';
import type { UserRole, ReportStatus } from '@prisma/client';
import { StudyStatus } from '@prisma/client';

/**
 * Fields that make up the authoritative clinical report content. Every one of
 * these contributes to the deterministic content hash. Additional structured
 * fields can be added here in the future without changing the reporting
 * architecture.
 */
export interface ReportContent {
  clinicalHistory?: string;
  findings?: string;
  impression?: string;
  technique?: string;
  comparison?: string;
  recommendations?: string;
  criticalFinding?: boolean;
}

/**
 * Deterministic full 64-char SHA-256 content hash computed server-side over
 * every clinical content field. Never trust a client-submitted hash.
 */
export function contentHash(c: ReportContent = {}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        c.clinicalHistory ?? '',
        c.findings ?? '',
        c.impression ?? '',
        c.technique ?? '',
        c.comparison ?? '',
        c.recommendations ?? '',
        c.criticalFinding ? 'critical' : 'normal',
      ]),
    )
    .digest('hex');
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly studies: StudiesService,
    private readonly reviews: ReviewsService,
    private readonly corrections: CorrectionsService,
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
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);
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

  async list(user: Actor) {
    const where: Record<string, unknown> = {};
    if (user.role === 'HOSPITAL' && user.hospitalId) {
      where.study = {
        hospitalId: user.hospitalId,
        status: { in: ['MANAGER_APPROVED', 'DELIVERED_TO_HOSPITAL', 'HOSPITAL_REVIEW', 'HOSPITAL_ACCEPTED', 'COMPLETED'] },
      };
    } else if (user.role === 'RADIOLOGIST') {
      where.study = { assignedRadiologistId: user.id };
    }

    const reports = await this.prisma.report.findMany({
      where,
      include: {
        study: {
          include: { patient: true, hospital: true },
        },
        author: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { data: reports };
  }

  async hospitalReports(user: Actor) {
    if (user.role === 'HOSPITAL' && !user.hospitalId) {
      throw new ForbiddenException('Your account is not linked to a hospital');
    }

    const where: Record<string, unknown> = {
      status: { in: ['SIGNED', 'MANAGER_APPROVED', 'MANAGER_REVIEW'] },
      study: {
        hospitalId: user.hospitalId!,
        status: { in: ['MANAGER_APPROVED', 'DELIVERED_TO_HOSPITAL', 'HOSPITAL_REVIEW', 'HOSPITAL_ACCEPTED', 'COMPLETED'] },
      },
    };

    const reports = await this.prisma.report.findMany({
      where,
      include: {
        study: {
          include: { patient: true, hospital: true },
        },
        author: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { data: reports };
  }

  async getByStudy(studyUid: string, user?: Actor) {
    const study = await this.getStudy(studyUid);
    if (user) {
      this.assertCanAccessStudy(user, study, true);
      this.assertHospitalReportVisibility(study, user);
    }

    const report = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      include: { author: true, versions: true, changeRequests: true },
      orderBy: { version: 'desc' },
    });

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

    const existing = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      orderBy: { version: 'desc' },
    });

    // Immutability: once a report is signed (or otherwise final), no metadata or
    // content mutations are permitted. Corrections are a later-phase workflow.
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

    const content: ReportContent = {
      clinicalHistory: dto.clinicalHistory ?? '',
      findings: dto.findings ?? '',
      impression: dto.impression ?? '',
      technique: dto.technique ?? '',
      comparison: dto.comparison ?? '',
      recommendations: dto.recommendations ?? '',
      criticalFinding: dto.criticalFinding ?? false,
    };
    const hash = contentHash(content);

    let report;
    if (existing) {
      report = await this.prisma.report.update({
        where: { id: existing.id },
        data: { ...content, contentHash: hash },
        include: { author: true },
      });
    } else {
      report = await this.prisma.report.create({
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
      // First draft created -> advance the study workflow to REPORT_DRAFT.
      if (study.status !== StudyStatus.REPORT_DRAFT) {
        await this.ensureDraftState(study, actor);
      }
    }

    await this.auditLog(
      actor,
      existing ? 'REPORT_EDITED' : 'REPORT_CREATED',
      'REPORT',
      report.id,
      { studyUid, studyStatus: existing ? undefined : study.status, version: report.version },
    );

    return { data: report };
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
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);
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
    if (!report.findings.trim() || !report.impression.trim()) {
      throw new BadRequestException('The report must have findings and impression before it can be signed');
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
      const latest = await tx.report.findFirst({
        where: { studyId: study.id },
        orderBy: { version: 'desc' },
      });
      if (!latest) throw new NotFoundException(`No report found for study ${studyUid}`);
      // Double-sign guard inside the transaction: only the first request wins.
      if (latest.status === 'SIGNED' || latest.signedOffAt) {
        throw new ConflictException('This report has already been signed and cannot be signed again');
      }
      if (latest.status !== 'DRAFT') {
        throw new BadRequestException(`Only a draft report can be signed (current status: ${latest.status})`);
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

      const createdVersion = await tx.reportVersion.create({
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
          authorId: latest.authorId,
          contentHash: latest.contentHash,
        },
      });

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
          metadata: { from: study.status, to: 'RADIOLOGIST_SIGNED', studyUid },
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
    dto: ReportContent,
    actor: Actor,
  ) {
    const study = await this.getStudy(studyUid);
    this.assertAssignedRadiologist(study, actor);

    const previous = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      orderBy: { version: 'desc' },
    });

    const content: ReportContent = {
      clinicalHistory: dto.clinicalHistory ?? '',
      findings: dto.findings ?? '',
      impression: dto.impression ?? '',
      technique: dto.technique ?? '',
      comparison: dto.comparison ?? '',
      recommendations: dto.recommendations ?? '',
      criticalFinding: dto.criticalFinding ?? false,
    };
    const newVersion = previous ? previous.version + 1 : 1;
    const hash = contentHash(content);

    const created = await this.prisma.report.create({
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

    if (previous && previous.status === 'SIGNED') {
      const existingVersion = await this.prisma.reportVersion.findFirst({
        where: { reportId: previous.id, version: previous.version },
      });
      if (!existingVersion) {
        await this.prisma.reportVersion.create({
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
            authorId: previous.authorId,
            contentHash: previous.contentHash,
          },
        });
      }
    }

    await this.auditLog(actor, 'REPORT_AMENDED', 'REPORT', created.id, { studyUid });

    return { data: created };
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
    const study = await this.getStudy(studyUid);
    const report = await this.getLatestReport(study.id);
    if (!report) throw new NotFoundException(`No report found for study ${studyUid}`);

    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: { status: dto.status },
      include: { author: true },
    });
    if (dto.status === 'SIGNED') {
      await this.prisma.study.update({ where: { id: study.id }, data: { status: 'MANAGER_REVIEW' } });
    }

    await this.auditLog(actor, 'REPORT_VERIFIED', 'REPORT', report.id, { studyUid, reportStatus: dto.status });

    return { data: updated, ...(dto.reason ? { reason: dto.reason } : {}) };
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
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      include: { patient: true, hospital: true },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    if (user.role === 'HOSPITAL' && study.hospitalId !== user.hospitalId) {
      throw new ForbiddenException('You do not have access to studies from this hospital');
    }
    if (!['MANAGER_APPROVED', 'DELIVERED_TO_HOSPITAL', 'HOSPITAL_REVIEW', 'HOSPITAL_ACCEPTED', 'COMPLETED'].includes(study.status)) {
      throw new NotFoundException('Final report is not yet available for this study');
    }

    const report = await this.prisma.report.findFirst({
      where: { studyId: study.id, status: { in: ['SIGNED', 'MANAGER_APPROVED'] } },
      orderBy: { version: 'desc' },
      include: { author: true },
    });
    if (!report) throw new NotFoundException(`No final report found for study ${studyUid}`);

    const pdf = this.buildPdf({ study, report });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${study.accessionNumber}.pdf"`);
    res.setHeader('Content-Length', Buffer.byteLength(pdf));
    res.send(Buffer.from(pdf, 'binary'));
  }

  private escapePdfText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  private buildPdf(opts: { study: any; report: any }): string {
    const { study, report } = opts;

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

    const contentLines = lines.map((l) => this.escapePdfText(l));

    let pdf = '%PDF-1.4\n';
    const objects: string[] = [];

    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');

    let contentStream = 'BT /F1 11 Tf 50 790 Td 16 TL\n';
    for (const l of contentLines) {
      contentStream += `(${l}) Tj T*\n`;
    }
    contentStream += 'ET';

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
