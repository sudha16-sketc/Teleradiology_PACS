import { describe, expect, it } from "vitest";

import {
  isValidPhone,
  normalizePhone,
  phoneHref,
  phoneInputValue,
  PHONE_VALIDATION_MESSAGE,
} from "./phone";

describe("phone validation", () => {
  it("sends exactly 10 digits in API payloads", () => {
    expect(normalizePhone("9876543210")).toBe("9876543210");
    expect(normalizePhone(" 9876543210 ")).toBe("9876543210");
    expect(isValidPhone("9876543210")).toBe(true);
    expect(normalizePhone("  ")).toBe("");
    expect(PHONE_VALIDATION_MESSAGE).toBe("Phone number must contain exactly 10 digits.");
  });

  it.each([
    "123456789",
    "12345678901",
    "98765a43210",
    "+919876543210",
    "+15551234567",
    "91 98765 43210",
    "9876543210 ext 2",
    "0123456789",
    "987654321/",
  ])("rejects invalid phone number %s", (value) => {
    expect(isValidPhone(value)).toBe(false);
    expect(normalizePhone(value)).toBeNull();
  });

  it("builds telephone links only from usable numbers", () => {
    expect(phoneHref("+919876543210")).toBe("tel:+919876543210");
    expect(phoneHref("9876543210")).toBe("tel:+919876543210");
    expect(phoneHref("+15551234567")).toBe("tel:+15551234567");
    expect(phoneHref("")).toBeNull();
    expect(phoneHref("invalid")).toBeNull();
    expect(phoneInputValue("+919876543210")).toBe("9876543210");
  });
});
