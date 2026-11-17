import { ReportStatus, StudyStatus } from '@prisma/client';

/**
 * Intended demo-study states. Only the first three studies have seeded reports,
 * so the rest stay in pre-report states. This keeps every report-dependent
 * status paired with a real report.
 */
export const DEMO_STUDY_STATUSES: StudyStatus[] = [
  StudyStatus.REPORT_DRAFT,
  StudyStatus.MANAGER_APPROVED,
  StudyStatus.RADIOLOGIST_SIGNED,
  StudyStatus.IN_READING,
  StudyStatus.ASSIGNED,
  StudyStatus.UNASSIGNED,
  StudyStatus.IN_READING,
  StudyStatus.ASSIGNED,
  StudyStatus.UNASSIGNED,
  StudyStatus.ASSIGNED,
];

export interface DemoReportFixture {
  reportId: string;
  studyIndex: number;
  status: ReportStatus;
}

export const DEMO_REPORTS: readonly DemoReportFixture[] = [
  { reportId: 'rpt-001', studyIndex: 0, status: ReportStatus.DRAFT },
  { reportId: 'rpt-002', studyIndex: 1, status: ReportStatus.SIGNED },
  { reportId: 'rpt-003', studyIndex: 2, status: ReportStatus.SIGNED },
];

const SIGNED_REPORT_STUDY_STATUSES: StudyStatus[] = [
  StudyStatus.RADIOLOGIST_SIGNED,
  StudyStatus.MANAGER_REVIEW,
  StudyStatus.MANAGER_APPROVED,
  StudyStatus.DELIVERED_TO_HOSPITAL,
  StudyStatus.HOSPITAL_REVIEW,
  StudyStatus.HOSPITAL_ACCEPTED,
  StudyStatus.COMPLETED,
];

const REPORT_REQUIRED_STUDY_STATUSES: StudyStatus[] = [
  StudyStatus.REPORT_DRAFT,
  ...SIGNED_REPORT_STUDY_STATUSES,
];

export function getDemoReportStatus(reportId: string): ReportStatus {
  const fixture = DEMO_REPORTS.find((report) => report.reportId === reportId);
  if (!fixture) {
    throw new Error(`Unknown demo report fixture: ${reportId}`);
  }
  return fixture.status;
}

/**
 * Validates the intended fixture set before any database writes. This checks
 * the relationship between seeded studies and reports without reading or
 * rewriting existing rows.
 */
export function assertDemoStatusConsistency(
  studyStatuses: readonly StudyStatus[],
  reports: readonly DemoReportFixture[],
): void {
  if (studyStatuses.length !== 10) {
    throw new Error(`Expected 10 demo studies, received ${studyStatuses.length}`);
  }

  const reportsByStudy = new Map<number, DemoReportFixture[]>();
  for (const report of reports) {
    const studyStatus = studyStatuses[report.studyIndex];
    if (!studyStatus) {
      throw new Error(
        `Demo report ${report.reportId} references missing study index ${report.studyIndex}`,
      );
    }

    if (report.status === ReportStatus.MANAGER_APPROVED) {
      throw new Error(
        `Demo report ${report.reportId} uses MANAGER_APPROVED; manager approval is represented on Study.status while the report remains SIGNED`,
      );
    }
    if (report.status === ReportStatus.DRAFT && studyStatus !== StudyStatus.REPORT_DRAFT) {
      throw new Error(
        `Demo report ${report.reportId} is DRAFT but its study is ${studyStatus}, expected REPORT_DRAFT`,
      );
    }
    if (
      report.status === ReportStatus.SIGNED &&
      !SIGNED_REPORT_STUDY_STATUSES.includes(studyStatus)
    ) {
      throw new Error(
        `Demo report ${report.reportId} is SIGNED but its study is ${studyStatus}, expected a signed-or-later state`,
      );
    }

    const studyReports = reportsByStudy.get(report.studyIndex) ?? [];
    studyReports.push(report);
    reportsByStudy.set(report.studyIndex, studyReports);
  }

  for (let index = 0; index < studyStatuses.length; index++) {
    const studyStatus = studyStatuses[index];
    if (!REPORT_REQUIRED_STUDY_STATUSES.includes(studyStatus)) continue;

    const studyReports = reportsByStudy.get(index) ?? [];
    const hasRequiredReport = SIGNED_REPORT_STUDY_STATUSES.includes(studyStatus)
      ? studyReports.some((report) => report.status === ReportStatus.SIGNED)
      : studyReports.some((report) => report.status === ReportStatus.DRAFT);

    if (!hasRequiredReport) {
      throw new Error(
        `Demo study index ${index} is ${studyStatus} but has no matching seeded report`,
      );
    }
  }
}
