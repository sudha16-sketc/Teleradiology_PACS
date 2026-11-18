import type { ImagingAvailability } from "@axis/types";

export const IMAGING_AVAILABILITY_TITLES: Record<ImagingAvailability, string> = {
  AVAILABLE: "Images are available",
  PENDING: "Imaging verification is pending",
  MISSING: "Imaging data is unavailable",
  UNAVAILABLE: "Imaging service is temporarily unavailable",
  INCOMPLETE: "Imaging data is incomplete",
};

export const IMAGING_AVAILABILITY_LABELS: Record<ImagingAvailability, string> = {
  AVAILABLE: "Images verified",
  PENDING: "Imaging verification pending",
  MISSING: "Images missing from Orthanc",
  UNAVAILABLE: "Imaging service unavailable",
  INCOMPLETE: "Imaging data incomplete",
};

export const IMAGING_AVAILABILITY_BADGE_CLASSES: Record<
  ImagingAvailability,
  string
> = {
  AVAILABLE: "border-accent/30 bg-accent/10 text-accent",
  PENDING: "border-warning/30 bg-warning/10 text-warning",
  MISSING: "border-error/30 bg-error/10 text-error",
  UNAVAILABLE: "border-warning/30 bg-warning/10 text-warning",
  INCOMPLETE: "border-error/30 bg-error/10 text-error",
};

export function isAvailabilityRetryable(state: ImagingAvailability): boolean {
  return state === "UNAVAILABLE" || state === "PENDING";
}

export function shouldShowRecoveryPanel(
  state: ImagingAvailability,
): boolean {
  return state === "MISSING" || state === "INCOMPLETE";
}
