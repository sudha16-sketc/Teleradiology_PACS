import { describe, expect, it } from "vitest";

import {
  knownNotificationTypes,
  notificationTitle,
  notifyWorkflowEvent,
  toastCopyIsSafe,
} from "./notification-events";

describe("native notification event copy", () => {
  it("provides only short, PHI-free copy for known event types", () => {
    const types = knownNotificationTypes();

    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      const copy = notifyWorkflowEvent(type);
      expect(copy).toBeDefined();
      expect(toastCopyIsSafe(copy)).toBe(true);
      expect(copy?.title).not.toMatch(/\d{6,}|\bpatient\b|\bMRN\b/i);
      expect(copy?.body).not.toMatch(/\d{6,}|\bpatient\b|\bMRN\b/i);
    }
  });

  it("does not echo unknown or server-supplied notification text", () => {
    const unknownType = "PATIENT Jane Doe MRN 123456789";

    expect(notifyWorkflowEvent(unknownType)).toBeUndefined();
    expect(notificationTitle(unknownType)).toBeUndefined();
  });
});