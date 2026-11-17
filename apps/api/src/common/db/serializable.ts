import { Prisma, PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

/**
 * Runs `fn` inside a Prisma interactive transaction at SERIALIZABLE isolation.
 *
 * The entire workflow layer historically ran READ COMMITTED with read-then-write
 * patterns, which allowed lost updates / double-claims (assignment races,
 * double-sign, double-transition, double-start of corrections). SERIALIZABLE
 * + a fresh re-read inside the callback turns those races into serialization
 * conflicts, and transient write conflicts (Prisma P2034) are retried a bounded
 * number of times before surfacing as a ConflictException.
 *
 * Business errors thrown inside `fn` (NotFoundException, ConflictException, ...)
 * are NOT retried and propagate unchanged.
 */
export async function runSerializable<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  retries = 1,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034' &&
        attempt < retries
      ) {
        continue;
      }
      throw err;
    }
  }
}

/**
 * Translates a unique-constraint violation (Prisma P2002) into a
 * ConflictException. Used where concurrent operations race to write the same
 * (studyId, version) / (reportId, version) key.
 */
export function assertNoVersionConflict(err: unknown, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictException(message);
  }
  throw err;
}