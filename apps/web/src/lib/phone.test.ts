import { describe, expect, it } from "vitest";

import {
  isValidPhone,
  normalizePhone,
  PHONE_VALIDATION_MESSAGE,
} from "./phone";

describe("phone validation", () => {
  it("normalizes supported phone numbers", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("+919876543210")).toBe("+919876543210");
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
    expect(normalizePhone("  ")).toBe("");
  });

  it("rejects letters, spaces, wrong lengths, and malformed country codes", () => {
    for (const value of [
      "12345",
      "12345678901",
      "98765a43210",
      "+91 9876543210",
      "+91987654321012",
      "+0123456789",
    ]) {
      expect(isValidPhone(value)).toBe(false);
      expect(normalizePhone(value)).toBeNull();
    }
    expect(PHONE_VALIDATION_MESSAGE).toContain("10 digits");
  });
});
