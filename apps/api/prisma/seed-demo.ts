import { PrismaClient, Gender, StudyPriority, StudyStatus, Modality, Subspecialty, ReportStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

function dateHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}

async function main() {
  console.log('Seeding demo (synthetic clinical) data...');

  const radiologist = await prisma.user.findUnique({
    where: { email: 'dr.chen@axisradiology.com' },
  });
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@axisradiology.com' },
  });
  const manager = await prisma.user.findUnique({
    where: { email: 'manager@axisradiology.com' },
  });

  if (!radiologist || !admin || !manager) {
    console.error('Demo seed requires accounts from db:seed first. Run: pnpm --filter @axis/api db:seed');
    process.exit(1);
  }

  const radId = radiologist.id;

  // Patients
  const patients = [];
  const genders: Gender[] = ['M', 'F', 'O', 'U'];
  for (let i = 1; i <= 10; i++) {
    const patientId = `AX-SYN-PAT-${String(i).padStart(4, '0')}`;
    const existing = await prisma.patient.findFirst({ where: { patientId } });
    const p =
      existing ??
      (await prisma.patient.create({
        data: {
          id: `pat-00${i}`,
          patientId,
          displayName: `AX-SYN Patient ${i}`,
          dateOfBirth: new Date(1960 + i * 3, (i * 2) % 12, 15),
          gender: genders[i % 4],
          hospitalId: i <= 4 ? 'hosp-001' : i <= 7 ? 'hosp-002' : 'hosp-003',
        },
      }));
    patients.push(p);
  }
  console.log('Demo patients:', patients.length);

  // Studies
  const modalities: Modality[] = ['CT', 'MRI', 'XR', 'US', 'MG'];
  const subspecialties: Subspecialty[] = ['NEURO', 'MSK', 'CHEST', 'ABDOMEN', 'CARDIOVASCULAR'];
  const priorities: StudyPriority[] = ['STAT', 'URGENT', 'ROUTINE'];
  const statuses: StudyStatus[] = ['UNASSIGNED', 'ASSIGNED', 'IN_READING', 'REPORT_DRAFT', 'MANAGER_APPROVED', 'DELIVERED_TO_HOSPITAL'];

  const studies = [];
  for (let i = 1; i <= 10; i++) {
    const mod = modalities[(i - 1) % 5];
    const sub = subspecialties[(i - 1) % 5];
    const pri = priorities[i % 3];
    const status = statuses[(i - 1) % 6];
    const hospIdx = i <= 4 ? 'hosp-001' : i <= 7 ? 'hosp-002' : 'hosp-003';
    const studyDate = new Date(2026, 0, 10 + i, 8 + i, 30);
    const studyInstanceUid = `1.2.840.113619.2.55.3.${1000000 + i}`;

    const existing = await prisma.study.findUnique({ where: { studyInstanceUid } });
    const s =
      existing ??
      (await prisma.study.create({
        data: {
          id: `study-00${i}`,
          studyInstanceUid,
          patientId: patients[i - 1].id,
          accessionNumber: `AX-SYN-ACC-${String(i).padStart(6, '0')}`,
          studyDate,
          studyTime: `${String(8 + i).padStart(2, '0')}:30:00`,
          modality: mod,
          bodyPart: ['Head', 'Knee', 'Chest', 'Abdomen', 'Heart'][(i - 1) % 5],
          hospitalId: hospIdx,
          referringPhysician: `Dr. AX-SYN Referrer ${i}`,
          studyDescription: `AX-SYN ${mod} ${sub} Study ${i}`,
          priority: pri,
          status,
          subspecialty: sub,
          assignedRadiologistId: status !== 'UNASSIGNED' ? radId : null,
          seriesCount: 2 + (i % 4),
          instanceCount: 20 + i * 5,
          slaDeadline: new Date(Date.now() + (4 - (i % 5)) * 3600000),
          receivedAt: new Date(Date.now() - 86400000 + i * 3600000),
          assignedAt: status !== 'UNASSIGNED' ? new Date(Date.now() - 72000000 + i * 3600000) : null,
          reportingStartedAt: status === 'IN_READING' || status === 'REPORT_DRAFT' ? new Date(Date.now() - 50000000) : null,
          signedOffAt: status === 'MANAGER_APPROVED' ? new Date(Date.now() - 36000000) : null,
          managerReviewedAt: status === 'MANAGER_APPROVED' ? new Date(Date.now() - 30000000) : null,
          managerApprovedAt: status === 'MANAGER_APPROVED' ? new Date(Date.now() - 24000000) : null,
          deliveredAt: status === 'DELIVERED_TO_HOSPITAL' ? new Date(Date.now() - 18000000) : null,
        },
      }));
    studies.push(s);
  }
  console.log('Demo studies:', studies.length);

  // Series and Instances
  for (const study of studies) {
    if ((await prisma.series.count({ where: { studyId: study.id } })) > 0) continue;
    for (let si = 1; si <= study.seriesCount; si++) {
      const series = await prisma.series.create({
        data: {
          id: `${study.id}-s${si}`,
          seriesInstanceUid: `${study.studyInstanceUid}.${si}`,
          studyId: study.id,
          modality: study.modality,
          seriesNumber: si,
          seriesDescription: `AX-SYN Series ${si} of ${study.studyInstanceUid}`,
          instanceCount: 5 + si,
          bodyPart: study.bodyPart,
        },
      });
      for (let ii = 1; ii <= 3; ii++) {
        await prisma.instance.create({
          data: {
            id: `${series.id}-i${ii}`,
            sopInstanceUid: `${series.seriesInstanceUid}.${ii}`,
            seriesId: series.id,
            studyId: study.id,
            instanceNumber: ii,
            sopClassUid: `1.2.840.10008.5.1.4.1.1.${2 + si}`,
          },
        });
      }
    }
  }
  console.log('Demo series and instances done');

  // Worklist items
  for (const study of studies) {
    if (study.status === 'HOSPITAL_SUBMITTED') continue;
    if (await prisma.worklistItem.findUnique({ where: { studyId: study.id } })) continue;
    const completedStatuses = ['MANAGER_APPROVED', 'DELIVERED_TO_HOSPITAL', 'COMPLETED'];
    const inProgressStatuses = ['IN_READING', 'REPORT_DRAFT'];
    await prisma.worklistItem.create({
      data: {
        id: `wl-${study.id}`,
        studyId: study.id,
        assignedAt: study.status !== 'UNASSIGNED' ? new Date(Date.now() - 3600000) : null,
        startedAt: inProgressStatuses.includes(study.status) ? new Date(Date.now() - 1800000) : null,
        completedAt: completedStatuses.includes(study.status) ? new Date() : null,
        tatMinutes: completedStatuses.includes(study.status) ? 45 + Math.floor(Math.random() * 60) : null,
        slaRemaining: completedStatuses.includes(study.status) ? null : 120 + Math.floor(Math.random() * 120),
      },
    });
  }
  console.log('Demo worklist items done');

  // Reports
  if (!(await prisma.report.findUnique({ where: { id: 'rpt-001' } }))) {
    await prisma.report.create({
      data: {
        id: 'rpt-001',
        studyId: studies[0].id,
        authorId: radId,
        status: ReportStatus.DRAFT,
        version: 1,
        findings: 'AX-SYN DRAFT: No acute abnormality detected in this synthetic CT head study.',
        impression: 'AX-SYN DRAFT: Normal CT head.',
        criticalFinding: false,
        contentHash: dateHash('draft-findings-impression'),
      },
    });
  }
  if (!(await prisma.report.findUnique({ where: { id: 'rpt-002' } }))) {
    await prisma.report.create({
      data: {
        id: 'rpt-002',
        studyId: studies[1].id,
        authorId: radId,
        status: ReportStatus.MANAGER_APPROVED,
        version: 1,
        findings: 'AX-SYN APPROVED: Small meniscal tear identified in the medial compartment of the left knee.',
        impression: 'AX-SYN APPROVED: Medial meniscal tear, left knee. Recommend orthopedic follow-up.',
        recommendations: 'Orthopedic consultation recommended.',
        criticalFinding: false,
        signedOffBy: radId,
        signedOffAt: new Date(),
        contentHash: dateHash('approved-findings-impression'),
      },
    });
  }
  if (!(await prisma.report.findUnique({ where: { id: 'rpt-003' } }))) {
    await prisma.report.create({
      data: {
        id: 'rpt-003',
        studyId: studies[2].id,
        authorId: radId,
        status: ReportStatus.SIGNED,
        version: 2,
        findings: 'AX-SYN SIGNED v2: Updated findings - 4mm pulmonary nodule identified in the right lower lobe.',
        impression: 'AX-SYN SIGNED v2: Solitary pulmonary nodule, right lower lobe. Recommend PET-CT follow-up.',
        recommendations: 'PET-CT follow-up recommended.',
        criticalFinding: true,
        criticalFindingAcknowledged: true,
        criticalFindingAcknowledgedBy: admin.id,
        criticalFindingAcknowledgedAt: new Date(),
        signedOffBy: radId,
        signedOffAt: new Date(),
        contentHash: dateHash('signed-findings-impression-v2'),
      },
    });
    await prisma.reportVersion.create({
      data: {
        id: 'rptv-001',
        reportId: 'rpt-003',
        version: 1,
        status: ReportStatus.DRAFT,
        findings: 'AX-SYN v1: Small nodule identified in right lower lobe.',
        impression: 'AX-SYN v1: Pulmonary nodule, right lower lobe.',
        recommendations: '',
        authorId: radId,
        contentHash: dateHash('v1-findings-impression'),
      },
    });
  }
  console.log('Demo reports done');

  console.log('Demo seed complete!');
}

main()
  .catch((e) => {
    console.error('Demo seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
