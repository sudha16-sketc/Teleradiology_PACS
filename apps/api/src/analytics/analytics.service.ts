import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalStudies, studiesToday, backlogCount, completedStudies, totalWithTat] =
      await Promise.all([
        this.prisma.study.count(),
        this.prisma.study.count({ where: { createdAt: { gte: startOfDay } } }),
        this.prisma.study.count({
          where: { status: { in: ['NEW', 'VALIDATED', 'UNASSIGNED', 'ASSIGNED'] } },
        }),
        this.prisma.worklistItem.findMany({
          where: { tatMinutes: { not: null } },
          select: { tatMinutes: true },
        }),
        this.prisma.worklistItem.count({ where: { tatMinutes: { not: null } } }),
      ]);

    const averageTAT =
      totalWithTat > 0
        ? completedStudies.reduce((sum, w) => sum + (w.tatMinutes || 0), 0) / totalWithTat
        : 0;

    const totalDeliveries = await this.prisma.deliveryAttempt.count();
    const successfulDeliveries = await this.prisma.deliveryAttempt.count({
      where: { status: 'COMPLETED' },
    });
    const deliverySuccessRate = totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) * 100 : 100;

    const finalizedWithSla = await this.prisma.study.findMany({
      where: { status: 'FINAL', finalizedAt: { not: null }, slaDeadline: { not: null } },
      select: { finalizedAt: true, slaDeadline: true },
    });
    const finalizedOnTime = finalizedWithSla.filter(
      (s) => s.finalizedAt! <= s.slaDeadline!,
    ).length;
    const slaComplianceRate =
      finalizedWithSla.length > 0
        ? (finalizedOnTime / finalizedWithSla.length) * 100
        : 100;

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

    const items = await this.prisma.worklistItem.findMany({
      where: { tatMinutes: { not: null } },
      select: { tatMinutes: true },
    });

    const total = items.length || 1;
    const distribution = ranges.map((range) => {
      const count = items.filter(
        (w) => (w.tatMinutes ?? 0) >= range.min && (w.tatMinutes ?? 0) < range.max,
      ).length;
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
          include: {
            worklistItem: true,
            deliveryAttempts: true,
          },
        },
        deliveryAttempts: true,
      },
    });

    const performance = await Promise.all(
      hospitals.map(async (hospital) => {
        const totalStudies = hospital.studies.length;
        const withTat = hospital.studies.filter((s) => s.worklistItem?.tatMinutes);
        const averageTAT =
          withTat.length > 0
            ? withTat.reduce((sum, s) => sum + (s.worklistItem?.tatMinutes || 0), 0) /
              withTat.length
            : 0;

        const deliveries = hospital.deliveryAttempts ?? [];
        const totalDeliveries = deliveries.length;
        const successfulDeliveries = deliveries.filter(
          (d) => d.status === 'COMPLETED',
        ).length;
        const deliverySuccessRate =
          totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) * 100 : 100;

        const finalWithSla = hospital.studies.filter(
          (s) => s.status === 'FINAL' && s.slaDeadline,
        );
        const onTimeStudies = finalWithSla.filter(
          (s) => s.finalizedAt && s.finalizedAt <= s.slaDeadline!,
        );
        const slaCompliance =
          finalWithSla.length > 0 ? (onTimeStudies.length / finalWithSla.length) * 100 : 100;

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
