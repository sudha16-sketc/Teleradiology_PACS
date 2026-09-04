import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlaPriority, AuditAction, AuditResource } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import type { OperationalOverview, SlaBreachItem, StudySlaComputation } from '@axis/types';

/**
 * Fallback SLA thresholds (minutes) applied when no SlaConfig row exists for a
 * study's priority. Actual thresholds are configurable via SlaConfig (persisted)
 * and are always applied server-side.
 */
const DEFAULT_SLA_MINUTES: Record<SlaPriority, number> = {
  [SlaPriority.STAT]: 60,
  [SlaPriority.URGENT]: 240,
  [SlaPriority.ROUTINE]: 1440,
};

interface StudyLike {
  id: string;
  studyInstanceUid: string;
  accessionNumber: string;
  status: string;
  priority: string;
  modality: string;
  receivedAt: Date | null;
  createdAt: Date;
  assignedAt: Date | null;
  signedOffAt: Date | null;
  managerApprovedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  hospitalId?: string;
  patient?: { displayName?: string } | null;
  hospital?: { name?: string } | null;
}

function minutesBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.round(ms / 60000));
}

@Injectable()
export class SlaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async thresholdForPriority(priority: string): Promise<number> {
    const p = (Object.values(SlaPriority) as string[]).includes(priority)
      ? (priority as SlaPriority)
      : SlaPriority.ROUTINE;
    const row = await this.prisma.slaConfig.findUnique({
      where: { priority: p },
    });
    if (row && row.isActive) return row.minutes;
    return DEFAULT_SLA_MINUTES[p];
  }

  /** Effective start time for SLA clock: actual receipt, else creation. */
  private startTime(study: StudyLike): Date {
    return study.receivedAt ?? study.createdAt;
  }

  async computeForStudy(
    study: StudyLike,
    threshold?: number,
  ): Promise<StudySlaComputation> {
    const slaMinutes = threshold ?? (await this.thresholdForPriority(study.priority));
    const start = this.startTime(study);
    const dueAt = new Date(start.getTime() + slaMinutes * 60000);
    const now = new Date();
    const terminal = ['COMPLETED', 'CANCELLED'].includes(study.status);
    // A study that has already completed within SLA is not a breach.
    const completedWithin =
      terminal && study.completedAt && study.completedAt.getTime() <= dueAt.getTime();
    const breached =
      !completedWithin && study.completedAt
        ? study.completedAt.getTime() > dueAt.getTime()
        : !terminal && now.getTime() > dueAt.getTime();

    const remainingMinutes =
      terminal && study.completedAt
        ? null
        : Math.max(0, Math.round((dueAt.getTime() - now.getTime()) / 60000));

    return {
      studyId: study.id,
      studyInstanceUid: study.studyInstanceUid,
      accessionNumber: study.accessionNumber,
      patientName: study.patient?.displayName ?? '',
      hospitalName: study.hospital?.name ?? '',
      modality: study.modality,
      priority: study.priority,
      status: study.status,
      dueAt: dueAt.toISOString(),
      remainingMinutes,
      breached,
      unassignedMinutes: minutesBetween(start, study.assignedAt),
      reportingMinutes: minutesBetween(study.assignedAt, study.signedOffAt),
      reviewMinutes: minutesBetween(study.signedOffAt, study.managerApprovedAt),
      deliveryMinutes: minutesBetween(study.managerApprovedAt, study.deliveredAt),
      totalMinutes: minutesBetween(start, study.completedAt),
    };
  }

  /**
   * Operational overview for the manager/admin dashboard. All counts and
   * averages are derived from real database rows and actual server timestamps —
   * never from client-supplied values.
   */
  async operationalOverview(): Promise<{ data: OperationalOverview }> {
    const all = await this.prisma.study.findMany({
      select: {
        id: true,
        studyInstanceUid: true,
        accessionNumber: true,
        status: true,
        priority: true,
        modality: true,
        receivedAt: true,
        createdAt: true,
        assignedAt: true,
        signedOffAt: true,
        managerApprovedAt: true,
        deliveredAt: true,
        completedAt: true,
        hospital: { select: { name: true } },
        patient: { select: { displayName: true } },
      },
    });

    const inState = (states: string[]) =>
      all.filter((s) => states.includes(s.status)).length;

    const counts = {
      unassigned: inState(['HOSPITAL_SUBMITTED', 'RECEIVING', 'VALIDATING', 'UNASSIGNED']),
      assigned: inState(['ASSIGNED', 'IN_READING']),
      inReading: inState(['IN_READING', 'REPORT_DRAFT']),
      reportDraft: inState(['REPORT_DRAFT']),
      awaitingReview: inState(['RADIOLOGIST_SIGNED', 'MANAGER_REVIEW']),
      awaitingDelivery: inState(['MANAGER_APPROVED']),
      hospitalReview: inState(['DELIVERED_TO_HOSPITAL', 'HOSPITAL_REVIEW']),
      correctionQueue: inState(['CORRECTION_REQUESTED', 'HOSPITAL_CHANGE_REQUESTED']),
      completed: inState(['COMPLETED']),
      total: all.length,
    };

    // Average reporting TAT = signedOffAt - assignedAt across signed studies.
    const reportingMins = all
      .map((s) => minutesBetween(s.assignedAt, s.signedOffAt))
      .filter((v): v is number => v !== null);
    const averageReportingMinutes =
      reportingMins.length > 0
        ? Math.round(reportingMins.reduce((a, b) => a + b, 0) / reportingMins.length)
        : 0;

    // Average total TAT = completedAt - received/created across completed studies.
    const totalMins = all
      .filter((s) => s.status === 'COMPLETED' && s.completedAt)
      .map((s) => minutesBetween(s.receivedAt ?? s.createdAt, s.completedAt))
      .filter((v): v is number => v !== null);
    const averageTotalMinutes =
      totalMins.length > 0
        ? Math.round(totalMins.reduce((a, b) => a + b, 0) / totalMins.length)
        : 0;

    // SLA breaches computed server-side.
    const breaches: SlaBreachItem[] = [];
    for (const study of all) {
      if (['COMPLETED', 'CANCELLED'].includes(study.status)) continue;
      const comp = await this.computeForStudy(study);
      if (comp.breached) {
        const start = study.receivedAt ?? study.createdAt;
        const threshold = await this.thresholdForPriority(
          (Object.values(SlaPriority) as string[]).includes(study.priority)
            ? study.priority
            : 'ROUTINE',
        );
        const dueAt = start.getTime() + threshold * 60000;
        breaches.push({
          studyId: study.id,
          studyInstanceUid: study.studyInstanceUid,
          patientName: study.patient?.displayName ?? '',
          modality: study.modality,
          hospitalName: study.hospital?.name ?? '',
          priority: study.priority,
          status: study.status,
          slaDeadline: new Date(dueAt).toISOString(),
          overdueMinutes: Math.max(0, Math.round((Date.now() - dueAt) / 60000)),
        });
      }
    }

    const totalTracked = all.filter(
      (s) => !['COMPLETED', 'CANCELLED'].includes(s.status),
    ).length;

    return {
      data: {
        counts,
        tat: { averageReportingMinutes, averageTotalMinutes },
        sla: {
          breachCount: breaches.length,
          totalTracked,
          breachPercentage:
            totalTracked > 0 ? Math.round((breaches.length / totalTracked) * 10000) / 100 : 0,
          breaches,
        },
      },
    };
  }

  async getConfig() {
    const rows = await this.prisma.slaConfig.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return {
      data: rows,
      defaults: DEFAULT_SLA_MINUTES,
    };
  }

  async saveConfig(priority: string, minutes: number, actorId: string, actorName: string) {
    const p = (Object.values(SlaPriority) as string[]).includes(priority)
      ? (priority as SlaPriority)
      : SlaPriority.ROUTINE;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new BadRequestException('SLA minutes must be a positive number');
    }
    const row = await this.prisma.slaConfig.upsert({
      where: { priority: p },
      update: { minutes, isActive: true, updatedBy: actorId },
      create: { priority: p, minutes, updatedBy: actorId },
    });
    await this.audit.create({
      actorId,
      actorName,
      actorRole: 'ADMIN',
      action: AuditAction.SLA_CONFIG_CHANGED,
      resource: AuditResource.WORKLIST,
      resourceId: row.id,
      metadata: { config: 'sla', priority: p, minutes },
    });
    return { data: row };
  }
}
