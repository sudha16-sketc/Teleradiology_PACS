const FALLBACK = "/worklist";

/**
 * Resolve a post-login destination without allowing an open redirect.
 * Only same-origin, root-relative paths are accepted; protocol-relative URLs,
 * backslash tricks and control characters are rejected.
 */
export function safeReturnTo(value: unknown, fallback = FALLBACK): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;

  try {
    const base = "http://axis.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    if (url.pathname === "/login") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Build the main-app login URL for an expired or missing session. */
export function loginUrl(returnTo?: unknown): string {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
