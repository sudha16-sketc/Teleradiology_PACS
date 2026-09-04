import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlaService } from '../sla/sla.service.js';

function minutesBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.round(ms / 60000));
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sla: SlaService,
  ) {}

  async overview() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalStudies, studiesToday, backlogCount] = await Promise.all([
      this.prisma.study.count(),
      this.prisma.study.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.study.count({
        where: {
          status: {
            in: ['HOSPITAL_SUBMITTED', 'RECEIVING', 'VALIDATING', 'UNASSIGNED', 'ASSIGNED'],
          },
        },
      }),
    ]);

    const totalDeliveries = await this.prisma.deliveryAttempt.count();
    const successfulDeliveries = await this.prisma.deliveryAttempt.count({
      where: { status: 'COMPLETED' },
    });
    const deliverySuccessRate =
      totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) * 100 : 100;

    // Server-derived TAT and SLA compliance (never read from unpopulated columns).
    const completed = await this.prisma.study.findMany({
      where: { status: 'COMPLETED', completedAt: { not: null } },
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

  async tatDistribution() {
    const ranges = [
      { label: '< 30 min', min: 0, max: 30 },
      { label: '30-60 min', min: 30, max: 60 },
      { label: '1-2 hours', min: 60, max: 120 },
      { label: '2-4 hours', min: 120, max: 240 },
      { label: '> 4 hours', min: 240, max: Infinity },
    ];

    const completed = await this.prisma.study.findMany({
      where: { status: 'COMPLETED', completedAt: { not: null } },
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

  async hospitalPerformance() {
    const hospitals = await this.prisma.hospital.findMany({
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
