import { PrismaClient, UserRole, UserStatus, Modality, Subspecialty } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { normalizePhoneOrThrow } from '../src/common/validators/phone.js';

const prisma = new PrismaClient();

function isProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.AXIS_ENV === 'production'
  );
}

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
  const phone = normalizePhoneOrThrow(input.phone);
  return prisma.user.upsert({
    where: { email: input.email },
    // Security: the update branch must NOT reset credentials, role, or
    // approval state. Re-running seed against an existing database must never
    // hijack an admin account (password reset / role upgrade). Only contact and
    // assignment metadata is refreshed.
    update: {
      displayName: input.displayName,
      hospitalId: input.hospitalId,
      subspecialty: input.subspecialty,
      licenseNumber: input.licenseNumber,
      organization: input.organization,
      phone,
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
      phone,
    },
  });
}

async function upsertReportTemplate(input: {
  id: string;
  name: string;
  description?: string;
  modality?: Modality;
  subspecialty?: Subspecialty;
  bodyPart?: string;
  clinicalHistory?: string;
  findings?: string;
  impression?: string;
  technique?: string;
  comparison?: string;
  recommendations?: string;
  isActive?: boolean;
  createdById: string;
}) {
  return prisma.reportTemplate.upsert({
    where: { id: input.id },
    update: {
      name: input.name,
      description: input.description,
      modality: input.modality,
      subspecialty: input.subspecialty,
      bodyPart: input.bodyPart,
      clinicalHistory: input.clinicalHistory ?? '',
      findings: input.findings ?? '',
      impression: input.impression ?? '',
      technique: input.technique ?? '',
      comparison: input.comparison ?? '',
      recommendations: input.recommendations ?? '',
      isActive: input.isActive ?? true,
    },
    create: {
      id: input.id,
      name: input.name,
      description: input.description,
      modality: input.modality,
      subspecialty: input.subspecialty,
      bodyPart: input.bodyPart,
      clinicalHistory: input.clinicalHistory ?? '',
      findings: input.findings ?? '',
      impression: input.impression ?? '',
      technique: input.technique ?? '',
      comparison: input.comparison ?? '',
      recommendations: input.recommendations ?? '',
      isActive: input.isActive ?? true,
      createdById: input.createdById,
    },
  });
}

async function main() {
  // Never allow the known-credential developer seed to touch a production DB.
  // Use prisma/create-admin.ts for production administrator creation.
  if (isProduction()) {
    throw new Error(
      'Refusing to run developer seed in a production environment. ' +
        'Create administrators with prisma/create-admin.ts instead.',
    );
  }

  console.log('Seeding accounts and hospitals...');
  const seedHash = await hashPassword(process.env.AXIS_SEED_USERS_PASSWORD ?? 'AxisDev123!');
  const adminHash = await hashPassword(process.env.AXIS_SEED_ADMIN_PASSWORD ?? 'Admin@123456');

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
    email: 'manager@axisradiology.com',
    displayName: 'Alex Manager',
    role: UserRole.MANAGER,
    passwordHash: seedHash,
    organization: 'Axis Radiology',
    phone: '5550100001',
  });

  await upsertUser({
    email: 'dr.chen@axisradiology.com',
    displayName: 'Dr. Sarah Chen',
    role: UserRole.RADIOLOGIST,
    passwordHash: seedHash,
    subspecialty: 'NEURO',
    licenseNumber: 'MCI-778899',
    organization: 'Axis Radiology',
    phone: '5550100101',
  });

  await upsertUser({
    email: 'dr.patel@axisradiology.com',
    displayName: 'Dr. Anish Patel',
    role: UserRole.RADIOLOGIST,
    passwordHash: seedHash,
    subspecialty: 'CHEST',
    licenseNumber: 'MCI-885522',
    organization: 'Axis Radiology',
    phone: '5550100102',
  });

  await upsertUser({
    email: 'registrar@citygeneral.com',
    displayName: 'Maria Registrar',
    role: UserRole.HOSPITAL,
    passwordHash: seedHash,
    hospitalId: hospitals.cgh.id,
    organization: hospitals.cgh.name,
    phone: '5550100201',
  });

  await upsertUser({
    email: 'records@metrocenter.com',
    displayName: 'James Records',
    role: UserRole.HOSPITAL,
    passwordHash: seedHash,
    hospitalId: hospitals.mmc.id,
    organization: hospitals.mmc.name,
    phone: '5550100202',
  });

  await upsertUser({
    email: 'rad@regionaltrauma.com',
    displayName: 'Elena Imaging Lead',
    role: UserRole.HOSPITAL,
    passwordHash: seedHash,
    hospitalId: hospitals.rtc.id,
    organization: hospitals.rtc.name,
    phone: '5550100203',
  });

  // Get admin user for template creation
  const adminUser = await prisma.user.findUnique({
    where: { email: 'admin@axisradiology.com' },
    select: { id: true },
  });
  if (!adminUser) {
    throw new Error('Admin user not found for template creation');
  }
  const adminUserId = adminUser.id;

  console.log('Accounts ready');

  // Seed default report templates
  console.log('Seeding report templates...');
  
  await upsertReportTemplate({
    id: 'template-mri-brain',
    name: 'MRI Brain',
    description: 'Standard MRI Brain protocol template',
    modality: 'MRI',
    subspecialty: 'NEURO',
    bodyPart: 'Brain',
    clinicalHistory: 'Clinical indication for MRI Brain',
    findings: '',
    impression: '',
    technique: 'Multiplanar multi-sequence MRI of the brain without and with contrast.',
    comparison: 'None',
    recommendations: '',
    isActive: true,
    createdById: adminUserId,
  });

  await upsertReportTemplate({
    id: 'template-mri-spine',
    name: 'MRI Spine',
    description: 'Standard MRI Spine protocol template',
    modality: 'MRI',
    subspecialty: 'NEURO',
    bodyPart: 'Spine',
    clinicalHistory: 'Clinical indication for MRI Spine',
    findings: '',
    impression: '',
    technique: 'Multiplanar multi-sequence MRI of the cervical/thoracic/lumbar spine without and with contrast.',
    comparison: 'None',
    recommendations: '',
    isActive: true,
    createdById: adminUserId,
  });

  await upsertReportTemplate({
    id: 'template-ct-head',
    name: 'CT Head',
    description: 'Standard CT Head protocol template',
    modality: 'CT',
    subspecialty: 'NEURO',
    bodyPart: 'Head',
    clinicalHistory: 'Clinical indication for CT Head',
    findings: '',
    impression: '',
    technique: 'Non-contrast CT of the head. 5mm axial sections.',
    comparison: 'None',
    recommendations: '',
    isActive: true,
    createdById: adminUserId,
  });

  await upsertReportTemplate({
    id: 'template-ct-chest',
    name: 'CT Chest',
    description: 'Standard CT Chest protocol template',
    modality: 'CT',
    subspecialty: 'CHEST',
    bodyPart: 'Chest',
    clinicalHistory: 'Clinical indication for CT Chest',
    findings: '',
    impression: '',
    technique: 'Contrast-enhanced CT of the chest with lung and mediastinal windows.',
    comparison: 'None',
    recommendations: '',
    isActive: true,
    createdById: adminUserId,
  });

  await upsertReportTemplate({
    id: 'template-xr-chest',
    name: 'XR Chest',
    description: 'Standard Chest X-ray template',
    modality: 'XR',
    subspecialty: 'CHEST',
    bodyPart: 'Chest',
    clinicalHistory: 'Clinical indication for Chest X-ray',
    findings: '',
    impression: '',
    technique: 'PA and lateral chest radiographs.',
    comparison: 'None',
    recommendations: '',
    isActive: true,
    createdById: adminUserId,
  });

  console.log('Report templates ready: 5');

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
