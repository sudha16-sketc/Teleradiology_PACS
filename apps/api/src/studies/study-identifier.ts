import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type StudyLookupClient = Pick<PrismaClient, 'study'>;

function matchesMrn(patientId: string | null | undefined, suffix: string): boolean {
  const value = (patientId ?? '').trim();
  if (!suffix) return true;
  const last = value.split(':').pop() ?? '';
  return value === suffix || last.toLowerCase() === suffix.toLowerCase();
}

export async function resolveStudyUid(
  prisma: StudyLookupClient,
  identifier: string,
): Promise<string> {
  const raw = identifier.trim();

  const byUid = await prisma.study.findUnique({
    where: { studyInstanceUid: raw },
    select: { studyInstanceUid: true },
  });
  if (byUid) return byUid.studyInstanceUid;

  const separator = raw.indexOf(':');
  const idCandidate = separator > 0 ? raw.slice(0, separator) : raw;
  const byId = await prisma.study.findUnique({
    where: { id: idCandidate },
    select: {
      studyInstanceUid: true,
      patient: { select: { patientId: true } },
    },
  });
  if (byId && (separator < 0 || matchesMrn(byId.patient?.patientId, raw.slice(separator + 1)))) {
    return byId.studyInstanceUid;
  }

  throw new NotFoundException(`Study ${raw} not found`);
}
