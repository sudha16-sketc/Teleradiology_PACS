import { ReportStatus, StudyStatus } from '@prisma/client';
import {
  DEMO_REPORTS,
  DEMO_STUDY_STATUSES,
  assertDemoStatusConsistency,
} from '../prisma/demo-fixtures';

describe('Demo seed fixture consistency', () => {
  it('pairs study-002 with an approved study and a signed report', () => {
    const study = DEMO_STUDY_STATUSES[1];
    const report = DEMO_REPORTS.find((item) => item.reportId === 'rpt-002');

    expect(study).toBe(StudyStatus.MANAGER_APPROVED);
    expect(report?.status).toBe(ReportStatus.SIGNED);
    expect(() =>
      assertDemoStatusConsistency(DEMO_STUDY_STATUSES, DEMO_REPORTS),
    ).not.toThrow();
  });

  it('rejects the legacy contradictory study-002 / rpt-002 pair', () => {
    const studyStatuses = [...DEMO_STUDY_STATUSES];
    studyStatuses[1] = StudyStatus.ASSIGNED;
    const reports = DEMO_REPORTS.map((report) =>
      report.reportId === 'rpt-002'
        ? { ...report, status: ReportStatus.MANAGER_APPROVED }
        : report,
    );

    expect(() => assertDemoStatusConsistency(studyStatuses, reports)).toThrow(
      /MANAGER_APPROVED/,
    );
  });
});
