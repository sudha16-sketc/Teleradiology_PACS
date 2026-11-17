import type { ReportStatus } from "@axis/types";

export function isSignedReportStatus(status: ReportStatus): boolean {
  return status === "SIGNED" || status === "RADIOLOGIST_SIGNED";
}

export function canSaveOrSignReport(status: ReportStatus): boolean {
  return status === "DRAFT";
}

export function canAmendReport(status: ReportStatus): boolean {
  return status === "SIGNED";
}

export function canEditReportContent(
  status: ReportStatus,
  isAssigned: boolean,
  isAmending: boolean,
): boolean {
  if (!isAssigned) return false;
  if (status === "DRAFT") return true;
  return isAmending && isSignedReportStatus(status);
}
