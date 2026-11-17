import { StudyStatus } from '@prisma/client';

/**
 * Phase 6 — Report Visibility (BUG_REPORT B1, C3).
 *
 * ONE authoritative list of study states in which a hospital may read the
 * report content of a study. Used verbatim by every surface that can return
 * report rows to a hospital actor (study detail, report detail, report list,
 * hospital report list, PDF, AI responses, exports, notifications) so the
 * gate can never diverge between endpoints.
 *
 * A hospital may only ever see report content once the study is actually
 * deliverable to it. Before DELIVERED_TO_HOSPITAL the report must not be
 * exposed regardless of report status (including DRAFT / RADIOLOGIST_SIGNED /
 * MANAGER_REVIEW / MANAGER_APPROVED-not-yet-delivered).
 */
export const HOSPITAL_VISIBLE_STATES: StudyStatus[] = [
  StudyStatus.DELIVERED_TO_HOSPITAL,
  StudyStatus.HOSPITAL_REVIEW,
  StudyStatus.HOSPITAL_ACCEPTED,
  StudyStatus.COMPLETED,
];

const HOSPITAL_VISIBLE_SET: ReadonlySet<string> = new Set(
  HOSPITAL_VISIBLE_STATES.map((s) => s),
);

/**
 * Returns true when the study's current status makes its report visible to
 * the destination hospital. This is the single predicate every endpoint must
 * use; do not re-implement the list inline anywhere else.
 */
export function isHospitalReportVisible(status: string): boolean {
  return HOSPITAL_VISIBLE_SET.has(status);
}
