import type { ReportStatus } from "@axis/types";
import { clsx } from "clsx";

const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  DRAFT: "bg-surface text-text-muted",
  SIGNED: "bg-accent/10 text-accent",
  RADIOLOGIST_SIGNED: "bg-accent/10 text-accent",
  MANAGER_REVIEW: "bg-warning/10 text-warning",
  MANAGER_APPROVED: "bg-success/10 text-success",
  HOSPITAL_REVIEW: "bg-warning/10 text-warning",
  CORRECTION_REQUESTED: "bg-error/10 text-error",
};

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: "Draft",
  SIGNED: "Signed",
  RADIOLOGIST_SIGNED: "Signed",
  MANAGER_REVIEW: "Manager Review",
  MANAGER_APPROVED: "Approved",
  HOSPITAL_REVIEW: "Hospital Review",
  CORRECTION_REQUESTED: "Correction Requested",
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
        REPORT_STATUS_STYLES[status],
      )}
    >
      {REPORT_STATUS_LABELS[status]}
    </span>
  );
}
