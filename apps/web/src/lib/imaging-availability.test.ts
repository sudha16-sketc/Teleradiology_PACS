import { describe, expect, it } from "vitest";

import {
  IMAGING_AVAILABILITY_BADGE_CLASSES,
  IMAGING_AVAILABILITY_LABELS,
  IMAGING_AVAILABILITY_TITLES,
  isAvailabilityRetryable,
  shouldShowRecoveryPanel,
} from "./imaging-availability";

describe("imaging availability UI contract", () => {
  it("unlocks the viewer after recovery verification succeeds", () => {
    expect(shouldShowRecoveryPanel("AVAILABLE")).toBe(false);
    expect(isAvailabilityRetryable("AVAILABLE")).toBe(false);
    expect(IMAGING_AVAILABILITY_TITLES.AVAILABLE).toBe("Images are available");
    expect(IMAGING_AVAILABILITY_LABELS.AVAILABLE).toBe("Images verified");
  });

  it("shows original-file recovery for missing or incomplete studies", () => {
    expect(shouldShowRecoveryPanel("MISSING")).toBe(true);
    expect(shouldShowRecoveryPanel("INCOMPLETE")).toBe(true);
    expect(isAvailabilityRetryable("MISSING")).toBe(false);
    expect(isAvailabilityRetryable("INCOMPLETE")).toBe(false);
  });

  it("offers retry without recovery upload for transient states", () => {
    expect(isAvailabilityRetryable("UNAVAILABLE")).toBe(true);
    expect(isAvailabilityRetryable("PENDING")).toBe(true);
    expect(shouldShowRecoveryPanel("UNAVAILABLE")).toBe(false);
    expect(shouldShowRecoveryPanel("PENDING")).toBe(false);
  });

  it("provides a visible badge for every state", () => {
    for (const state of [
      "AVAILABLE",
      "PENDING",
      "MISSING",
      "UNAVAILABLE",
      "INCOMPLETE",
    ] as const) {
      expect(IMAGING_AVAILABILITY_LABELS[state]).toBeTruthy();
      expect(IMAGING_AVAILABILITY_BADGE_CLASSES[state]).toBeTruthy();
    }
  });
});
