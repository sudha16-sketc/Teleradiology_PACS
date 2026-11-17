import { Injectable } from '@nestjs/common';
import { Prisma, StudyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlaService } from '../sla/sla.service.js';
import type { AuthenticatedUser } from '../auth/auth.constants.js';

function minutesBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.round(ms / 60000));
}

const BACKLOG_STATES: StudyStatus[] = [
  'HOSPITAL_SUBMITTED',
  'RECEIVING',
  'VALIDATING',
  'UNASSIGNED',
  'ASSIGNED',
];

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sla: SlaService,
  ) {}

  /**
   * Study-scope predicate for tenant isolation. MANAGERs only ever see their
   * own hospital's data; ADMIN sees everything. A MANAGER without a hospitalId
   * (a data anomaly) is denied instead of silently given global visibility.
   */
  private scopedStudyWhere(
    user?: AuthenticatedUser,
  ): { where: Prisma.StudyWhereInput; empty: boolean } {
    if (!user || user.role !== 'MANAGER') return { where: {}, empty: false };
    if (!user.hospitalId) return { where: {}, empty: true };
    return { where: { hospitalId: user.hospitalId }, empty: false };
  }

  async overview(user?: AuthenticatedUser) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const { where, empty } = this.scopedStudyWhere(user);

    if (empty) {
      return {
        data: {
          totalStudies: 0,
          studiesToday: 0,
          averageTAT: 0,
          slaComplianceRate: 0,
          backlogCount: 0,
          deliverySuccessRate: 0,
        },
      };
    }

    const hospitalId = where.hospitalId as string | undefined;

    const [totalStudies, studiesToday, backlogCount] = await Promise.all([
      this.prisma.study.count({ where }),
      this.prisma.study.count({ where: { ...where, createdAt: { gte: startOfDay } } }),
      this.prisma.study.count({
        where: { ...where, status: { in: BACKLOG_STATES } },
      }),
    ]);

    const deliveryWhere = hospitalId ? { hospitalId } : {};
    const totalDeliveries = await this.prisma.deliveryAttempt.count({ where: deliveryWhere });
    const successfulDeliveries = await this.prisma.deliveryAttempt.count({
      where: { ...deliveryWhere, status: 'COMPLETED' },
    });
    const deliverySuccessRate =
      totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) * 100 : 100;

    // Server-derived TAT and SLA compliance (never read from unpopulated columns).
    const completed = await this.prisma.study.findMany({
      where: { ...where, status: 'COMPLETED', completedAt: { not: null } },
      select: {
        id: true,
        priority: true,
        receivedAt: true,
        createdAt: true,
        assignedAt: true,
        signedOffAt: true,
        completedAt: true,
      },
    });

    const totalMins = completed
      .map((s) => minutesBetween(s.receivedAt ?? s.createdAt, s.completedAt))
      .filter((v): v is number => v !== null);
    const averageTAT =
      totalMins.length > 0
        ? totalMins.reduce((a, b) => a + b, 0) / totalMins.length
        : 0;

    let onTime = 0;
    for (const s of completed) {
      const threshold = await this.sla.thresholdForPriority(
        s.priority,
      );
      const start = s.receivedAt ?? s.createdAt;
      const dueAt = start.getTime() + threshold * 60000;
      if (s.completedAt!.getTime() <= dueAt) onTime++;
    }
    const slaComplianceRate =
      completed.length > 0 ? (onTime / completed.length) * 100 : 100;

    return {
      data: {
        totalStudies,
        studiesToday,
        averageTAT: Math.round(averageTAT),
        slaComplianceRate: Math.round(slaComplianceRate * 100) / 100,
        backlogCount,
        deliverySuccessRate: Math.round(deliverySuccessRate * 100) / 100,
      },
    };
  }

  async tatDistribution(user?: AuthenticatedUser) {
    const ranges = [
      { label: '< 30 min', min: 0, max: 30 },
      { label: '30-60 min', min: 30, max: 60 },
      { label: '1-2 hours', min: 60, max: 120 },
      { label: '2-4 hours', min: 120, max: 240 },
      { label: '> 4 hours', min: 240, max: Infinity },
    ];

    const { where, empty } = this.scopedStudyWhere(user);
    if (empty) {
      return {
        data: ranges.map((range) => ({ range: range.label, count: 0, percentage: 0 })),
      };
    }

    const completed = await this.prisma.study.findMany({
      where: { ...where, status: 'COMPLETED', completedAt: { not: null } },
      select: { receivedAt: true, createdAt: true, completedAt: true },
    });
    const durations = completed
      .map((s) => minutesBetween(s.receivedAt ?? s.createdAt, s.completedAt))
      .filter((v): v is number => v !== null);

    const total = durations.length || 1;
    const distribution = ranges.map((range) => {
      const count = durations.filter((d) => d >= range.min && d < range.max).length;
      return {
        range: range.label,
        count,
        percentage: Math.round((count / total) * 100 * 100) / 100,
      };
    });

    return { data: distribution };
  }

  async hospitalPerformance(user?: AuthenticatedUser) {
    const { where, empty } = this.scopedStudyWhere(user);

    if (empty) {
      return { data: [] };
    }

    const hospitals = await this.prisma.hospital.findMany({
      where: where.hospitalId ? { id: where.hospitalId as string } : {},
      include: {
        studies: {
          select: {
            status: true,
            priority: true,
            receivedAt: true,
            createdAt: true,
            completedAt: true,
          },
        },
        deliveryAttempts: { select: { status: true } },
      },
    });

    const performance = await Promise.all(
      hospitals.map(async (hospital) => {
        const totalStudies = hospital.studies.length;

        const completed = hospital.studies.filter(
          (s) => s.status === 'COMPLETED' && s.completedAt,
        );
        const totalMins = completed
          .map((s) => minutesBetween(s.receivedAt ?? s.createdAt, s.completedAt))
          .filter((v): v is number => v !== null);
        const averageTAT =
          totalMins.length > 0
            ? totalMins.reduce((a, b) => a + b, 0) / totalMins.length
            : 0;

        let onTime = 0;
        for (const s of completed) {
          const threshold = await this.sla.thresholdForPriority(s.priority);
          const start = s.receivedAt ?? s.createdAt;
          const dueAt = start.getTime() + threshold * 60000;
          if (s.completedAt!.getTime() <= dueAt) onTime++;
        }
        const slaCompliance =
          completed.length > 0 ? (onTime / completed.length) * 100 : 100;

        const deliveries = hospital.deliveryAttempts ?? [];
        const successfulDeliveries = deliveries.filter(
          (d) => d.status === 'COMPLETED',
        ).length;
        const deliverySuccessRate =
          deliveries.length > 0 ? (successfulDeliveries / deliveries.length) * 100 : 100;

        return {
          hospitalId: hospital.id,
          hospitalName: hospital.name,
          totalStudies,
          averageTAT: Math.round(averageTAT),
          slaCompliance: Math.round(slaCompliance),
          deliverySuccessRate: Math.round(deliverySuccessRate * 100) / 100,
        };
      }),
    );

    return { data: performance };
  }
}