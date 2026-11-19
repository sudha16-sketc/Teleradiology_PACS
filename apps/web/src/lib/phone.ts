export const PHONE_VALIDATION_MESSAGE =
  "Phone number must contain exactly 10 digits.";

export const PHONE_INPUT_PATTERN = /^[0-9]{10}$/;

/**
 * Returns exactly ten numeric digits for API payloads. Canonical storage and
 * telephone links are derived by the backend and `phoneHref()` respectively.
 */
export function normalizePhone(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (!PHONE_INPUT_PATTERN.test(trimmed) || trimmed.startsWith("0")) return null;
  return trimmed;
}

export function isValidPhone(value: unknown): boolean {
  return normalizePhone(value) !== null;
}

/** Converts a stored canonical or legacy phone value back to a 10-digit input. */
export function phoneInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (/^91\d{10}$/.test(digits)) return digits.slice(2);
  return /^\d{10}$/.test(digits) ? digits : "";
}

/** Returns a safe telephone link, or null for empty/malformed values. */
export function phoneHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (/^91\d{10}$/.test(digits)) return `tel:+${digits}`;
  if (/^\d{10}$/.test(digits)) return `tel:+91${digits}`;
  if (/^[1-9]\d{7,14}$/.test(digits)) return `tel:+${digits}`;
  return null;
}
