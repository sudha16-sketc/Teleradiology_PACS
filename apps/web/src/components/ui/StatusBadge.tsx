import type { StudyStatus } from "@axis/types";
import { clsx } from "clsx";

const STATUS_STYLES: Record<StudyStatus, string> = {
  HOSPITAL_SUBMITTED: "bg-surface text-text-muted",
  RECEIVING: "bg-surface text-text-muted",
  VALIDATING: "bg-surface text-text-muted",
  UNASSIGNED: "bg-surface text-text-muted",
  ASSIGNED: "bg-accent/10 text-accent",
  IN_READING: "bg-accent/10 text-accent",
  REPORT_DRAFT: "bg-accent/10 text-accent",
  RADIOLOGIST_SIGNED: "bg-accent/10 text-accent",
  MANAGER_REVIEW: "bg-warning/10 text-warning",
  MANAGER_APPROVED: "bg-success/10 text-success",
  DELIVERED_TO_HOSPITAL: "bg-success/10 text-success",
  HOSPITAL_REVIEW: "bg-warning/10 text-warning",
  HOSPITAL_ACCEPTED: "bg-success/10 text-success",
  COMPLETED: "bg-success/10 text-success",
  CORRECTION_REQUESTED: "bg-error/10 text-error",
  HOSPITAL_CHANGE_REQUESTED: "bg-error/10 text-error",
  CANCELLED: "bg-error/10 text-error",
};

const STATUS_LABELS: Record<StudyStatus, string> = {
  HOSPITAL_SUBMITTED: "Submitted",
  RECEIVING: "Receiving",
  VALIDATING: "Validating",
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Assigned",
  IN_READING: "In Reading",
  REPORT_DRAFT: "Draft",
  RADIOLOGIST_SIGNED: "Signed",
  MANAGER_REVIEW: "Manager Review",
  MANAGER_APPROVED: "Approved",
  DELIVERED_TO_HOSPITAL: "Delivered",
  HOSPITAL_REVIEW: "Hospital Review",
  HOSPITAL_ACCEPTED: "Accepted",
  COMPLETED: "Completed",
  CORRECTION_REQUESTED: "Correction Requested",
  HOSPITAL_CHANGE_REQUESTED: "Change Requested",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: StudyStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
