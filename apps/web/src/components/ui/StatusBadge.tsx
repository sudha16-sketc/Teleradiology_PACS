import type { StudyStatus } from "@axis/types";
import { clsx } from "clsx";

const STATUS_STYLES: Record<StudyStatus, string> = {
  NEW: "bg-surface text-text-muted",
  SUBMITTED: "bg-surface text-text-muted",
  VALIDATED: "bg-surface text-text-muted",
  UNASSIGNED: "bg-surface text-text-muted",
  ASSIGNED: "bg-accent/10 text-accent",
  IN_READING: "bg-accent/10 text-accent",
  DRAFT_REPORT: "bg-accent/10 text-accent",
  FINAL: "bg-success/10 text-success",
  AMENDED: "bg-warning/10 text-warning",
  DELIVERED: "bg-success/10 text-success",
  CANCELLED: "bg-error/10 text-error",
};

const STATUS_LABELS: Record<StudyStatus, string> = {
  NEW: "New",
  SUBMITTED: "Submitted",
  VALIDATED: "Validated",
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Assigned",
  IN_READING: "In Reading",
  DRAFT_REPORT: "Draft",
  FINAL: "Final",
  AMENDED: "Amended",
  DELIVERED: "Delivered",
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
