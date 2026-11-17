import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Deterministic test tenants for suites that must not depend on the developer
 * seed (`prisma/seed.ts`). That seed is not run by migrations, so on a clean
 * test database none of its users exist and every login-based test fails.
 *
 * Accounts are upserted with an explicit fixture password so `loginAgent` works
 * against a database that migrations alone created. This is e2e setup only and
 * is never invoked by application code.
 */
export const TEST_PASSWORD = 'AxisE2E123!';

export interface SeededTenant {
  hospitalId: string;
  hospitalCode: string;
  user: { email: string; password: string };
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function seedHospitalUser(
  prisma: PrismaClient,
  opts: { code: string; name: string; email: string; displayName: string },
): Promise<SeededTenant> {
  // Stable, readable fixture id so assertions can reference it directly.
  const hospitalId = `e2e-hosp-${opts.code.toLowerCase()}`;
  const passwordHash = await hashPassword(TEST_PASSWORD);

  await prisma.hospital.upsert({
    where: { id: hospitalId },
    update: { name: opts.name, code: opts.code, isActive: true },
    create: {
      id: hospitalId,
      name: opts.name,
      code: opts.code,
      address: `${opts.name} address`,
      timezone: 'America/Chicago',
      isActive: true,
    },
  });

  // The update branch intentionally never rewrites role, status, or credentials:
  // re-running setup must not silently escalate or re-activate an account.
  await prisma.user.upsert({
    where: { email: opts.email },
    update: {
      displayName: opts.displayName,
      hospitalId,
      organization: opts.name,
    },
    create: {
      email: opts.email,
      displayName: opts.displayName,
      role: UserRole.HOSPITAL,
      status: UserStatus.APPROVED,
      isActive: true,
      passwordHash,
      hospitalId,
      organization: opts.name,
    },
  });

  const existing = await prisma.user.findUnique({
    where: { email: opts.email },
    select: { passwordHash: true },
  });
  if (existing && !(await bcrypt.compare(TEST_PASSWORD, existing.passwordHash))) {
    throw new Error(
      `Seeded test user ${opts.email} does not use the fixture password. ` +
        'Reset or delete it before running the suite.',
    );
  }

  return {
    hospitalId,
    hospitalCode: opts.code,
    user: { email: opts.email, password: TEST_PASSWORD },
  };
}

export const E2E_TENANTS = {
  CGH: {
    code: 'E2ECGH',
    name: 'E2E City General',
    email: 'e2e-registrar@citygeneral.test',
    displayName: 'E2E City General Registrar',
  },
  MMC: {
    code: 'E2EMMC',
    name: 'E2E Metro Medical',
    email: 'e2e-records@metrocenter.test',
    displayName: 'E2E Metro Medical Records',
  },
} as const;

export async function seedE2eTenants(prisma: PrismaClient): Promise<{
  cgh: SeededTenant;
  mmc: SeededTenant;
}> {
  const [cgh, mmc] = await Promise.all([
    seedHospitalUser(prisma, E2E_TENANTS.CGH),
    seedHospitalUser(prisma, E2E_TENANTS.MMC),
  ]);
  return { cgh, mmc };
}
