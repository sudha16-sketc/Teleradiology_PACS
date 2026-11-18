export const PHONE_VALIDATION_MESSAGE =
  "Enter digits only with an optional leading +. Indian numbers: 10 digits, or +91 followed by 10 digits.";

export function normalizePhone(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (!/^\+?\d+$/.test(trimmed)) return null;

  const hasCountryCode = trimmed.startsWith("+");
  const digits = hasCountryCode ? trimmed.slice(1) : trimmed;
  if (/^0/.test(digits)) return null;

  if (!hasCountryCode) {
    return digits.length === 10 ? `+91${digits}` : null;
  }
  if (digits.startsWith("91")) {
    return digits.length === 12 ? `+${digits}` : null;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export function isValidPhone(value: unknown): boolean {
  return normalizePhone(value) !== null;
}
