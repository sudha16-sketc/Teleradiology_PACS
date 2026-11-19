import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';

export async function assertSuccessfulDelivery(
  prisma: PrismaService,
  studyId: string,
  hospitalId: string | null | undefined,
  reportId?: string,
): Promise<void> {
  if (!hospitalId) {
    throw new ForbiddenException('You do not have access to studies from this hospital');
  }
  const attempt = await prisma.deliveryAttempt.findFirst({
    where: {
      studyId,
      hospitalId,
      status: 'COMPLETED',
      ...(reportId ? { reportId } : {}),
    },
    select: { id: true },
  });
  if (!attempt) {
    throw new ForbiddenException('The final report has not been delivered to this hospital.');
  }
}
