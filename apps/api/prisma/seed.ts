import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

async function upsertHospital(input: {
  id: string;
  name: string;
  code: string;
  address: string;
  timezone: string;
}) {
  return prisma.hospital.upsert({
    where: { id: input.id },
    update: {
      name: input.name,
      code: input.code,
      address: input.address,
      timezone: input.timezone,
    },
    create: input,
  });
}

async function upsertUser(input: {
  email: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  hospitalId?: string;
  subspecialty?: string;
  licenseNumber?: string;
  organization?: string;
  phone?: string;
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      displayName: input.displayName,
      role: input.role,
      status: UserStatus.APPROVED,
      isActive: true,
      passwordHash: input.passwordHash,
      hospitalId: input.hospitalId,
      subspecialty: input.subspecialty,
      licenseNumber: input.licenseNumber,
      organization: input.organization,
      phone: input.phone,
    },
    create: {
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      status: UserStatus.APPROVED,
      isActive: true,
      passwordHash: input.passwordHash,
      hospitalId: input.hospitalId,
      subspecialty: input.subspecialty,
      licenseNumber: input.licenseNumber,
      organization: input.organization,
      phone: input.phone,
    },
  });
}

async function main() {
  console.log('Seeding accounts and hospitals...');
  const seedHash = await hashPassword('AxisDev123!');
  const adminHash = await hashPassword('Admin@123456');

  const hospitals = {
    cgh: await upsertHospital({
      id: 'hosp-001',
      name: 'City General Hospital',
      code: 'CGH',
      address: '100 General Way, Springfield, IL 62701',
      timezone: 'America/Chicago',
    }),
    mmc: await upsertHospital({
      id: 'hosp-002',
      name: 'Metro Medical Center',
      code: 'MMC',
      address: '200 Metro Blvd, Chicago, IL 60601',
      timezone: 'America/Chicago',
    }),
    rtc: await upsertHospital({
      id: 'hosp-003',
      name: 'Regional Trauma Center',
      code: 'RTC',
      address: '300 Trauma Ave, St. Louis, MO 63101',
      timezone: 'America/Chicago',
    }),
  };
  console.log('Hospitals ready:', Object.keys(hospitals).length);

  await prisma.site.upsert({
    where: { id: 'site-001' },
    update: { hospitalId: hospitals.cgh.id, name: 'Main Campus', code: 'CGH-MC', isActive: true },
    create: { id: 'site-001', hospitalId: hospitals.cgh.id, name: 'Main Campus', code: 'CGH-MC', isActive: true },
  });
  await prisma.site.upsert({
    where: { id: 'site-002' },
    update: { hospitalId: hospitals.cgh.id, name: 'East Wing', code: 'CGH-EW', isActive: true },
    create: { id: 'site-002', hospitalId: hospitals.cgh.id, name: 'East Wing', code: 'CGH-EW', isActive: true },
  });
  await prisma.site.upsert({
    where: { id: 'site-003' },
    update: { hospitalId: hospitals.mmc.id, name: 'Radiology Dept', code: 'MMC-RD', isActive: true },
    create: { id: 'site-003', hospitalId: hospitals.mmc.id, name: 'Radiology Dept', code: 'MMC-RD', isActive: true },
  });
  await prisma.site.upsert({
    where: { id: 'site-004' },
    update: { hospitalId: hospitals.rtc.id, name: 'Emergency Wing', code: 'RTC-EW', isActive: true },
    create: { id: 'site-004', hospitalId: hospitals.rtc.id, name: 'Emergency Wing', code: 'RTC-EW', isActive: true },
  });
  console.log('Sites ready: 4');

  await upsertUser({
    email: 'admin@axisradiology.com',
    displayName: 'Axis Administrator',
    role: UserRole.ADMIN,
    passwordHash: adminHash,
    organization: 'Axis Radiology',
  });

  await upsertUser({
    email: 'coordinator@axisradiology.com',
    displayName: 'Alex Coordinator',
    role: UserRole.COORDINATOR,
    passwordHash: seedHash,
    organization: 'Axis Radiology',
    phone: '+1 555 010 0001',
  });

  await upsertUser({
    email: 'dr.chen@axisradiology.com',
    displayName: 'Dr. Sarah Chen',
    role: UserRole.RADIOLOGIST,
    passwordHash: seedHash,
    subspecialty: 'NEURO',
    licenseNumber: 'MCI-778899',
    organization: 'Axis Radiology',
    phone: '+1 555 010 0101',
  });

  await upsertUser({
    email: 'dr.patel@axisradiology.com',
    displayName: 'Dr. Anish Patel',
    role: UserRole.RADIOLOGIST,
    passwordHash: seedHash,
    subspecialty: 'CHEST',
    licenseNumber: 'MCI-885522',
    organization: 'Axis Radiology',
    phone: '+1 555 010 0102',
  });

  await upsertUser({
    email: 'tech@axisradiology.com',
    displayName: 'Priya Technician',
    role: UserRole.TECHNICIAN,
    passwordHash: seedHash,
    organization: 'Axis Radiology',
    phone: '+1 555 010 0300',
  });

  await upsertUser({
    email: 'registrar@citygeneral.com',
    displayName: 'Maria Registrar',
    role: UserRole.HOSPITAL_USER,
    passwordHash: seedHash,
    hospitalId: hospitals.cgh.id,
    organization: hospitals.cgh.name,
    phone: '+1 555 010 0201',
  });

  await upsertUser({
    email: 'records@metrocenter.com',
    displayName: 'James Records',
    role: UserRole.HOSPITAL_USER,
    passwordHash: seedHash,
    hospitalId: hospitals.mmc.id,
    organization: hospitals.mmc.name,
    phone: '+1 555 010 0202',
  });

  await upsertUser({
    email: 'rad@regionaltrauma.com',
    displayName: 'Elena Imaging Lead',
    role: UserRole.HOSPITAL_USER,
    passwordHash: seedHash,
    hospitalId: hospitals.rtc.id,
    organization: hospitals.rtc.name,
    phone: '+1 555 010 0203',
  });

  console.log('Accounts ready');
  console.log('Seeding complete! (accounts-only; run db:seed-demo for synthetic clinical data)');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
