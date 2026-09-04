import 'dotenv/config';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@axisradiology.com')
    .toLowerCase()
    .trim();
  const displayName = process.env.ADMIN_NAME ?? 'Axis Administrator';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error('ADMIN_PASSWORD environment variable is required.');
    console.error(
      'Example: ADMIN_EMAIL=admin@axisradiology.com ADMIN_PASSWORD="Strong#Pass123" pnpm --filter @axis/api db:create-admin',
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (process.env.FORCE_ADMIN_OVERWRITE !== '1') {
      console.error(
        `An administrator already exists for ${email}. Refusing to overwrite its password.`,
      );
      console.error(
        'Re-run with FORCE_ADMIN_OVERWRITE=1 only if you intentionally want to reset the credentials.',
      );
      process.exit(1);
    }
    console.warn(
      'FORCE_ADMIN_OVERWRITE=1 set — resetting existing administrator password.',
    );
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      displayName,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.APPROVED,
      isActive: true,
      organization: process.env.ADMIN_ORG,
    },
    create: {
      email,
      displayName,
      role: UserRole.ADMIN,
      status: UserStatus.APPROVED,
      isActive: true,
      passwordHash,
      phone: process.env.ADMIN_PHONE,
      organization: process.env.ADMIN_ORG,
    },
  });

  console.log(`Administrator ready — ${user.email} (${user.displayName})`);
}

main()
  .catch((e) => {
    console.error('create-admin failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });