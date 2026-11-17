/**
 * Centralized runtime / platform abstraction.
 *
 * The Axis frontend ships as two clients from this one codebase:
 *
 *   - the **web client**, served by the Next.js server, and
 *   - the **desktop client** (apps/desktop), a Tauri window that loads this
 *     very same frontend from an Axis deployment.
 *
 * Everything that needs to know "which client am I running in?" or "where does
 * the API live?" goes through this module. Do not scatter
 * `window.__TAURI_INTERNALS__` / `isTauri` checks across the app; add a
 * capability here instead so detection stays in one place and the rest of the
 * app depends on a stable interface.
 *
 * Why the API base is root-relative by default
 * --------------------------------------------
 * Session state is an httpOnly cookie (`axis_session`) issued by the NestJS API
 * with `sameSite: 'lax'`, and the API carries no CSRF token. A root-relative
 * base (`/api`) means the browser only ever talks to its own origin and Next.js
 * proxies `/api/*` to the NestJS API server-side (see next.config.mjs). That
 * keeps the session cookie strictly first-party, so `SameSite=Lax` holds and no
 * CORS or CSRF relaxation is ever required.
 *
 * That property is what lets the desktop client reuse the existing auth
 * unchanged. A desktop build whose API lives on a *different* origin would turn
 * the session cookie into a third-party cookie, which browsers refuse to attach
 * to cross-site requests under `SameSite=Lax`, so the login POST would silently
 * fail. `NEXT_PUBLIC_DESKTOP_API_URL` therefore exists only as an explicit,
 * operator-owned escape hatch: never a default, and a loopback value is
 * refused outright in production.
 */

/** Same-origin prefix Next.js rewrites to the NestJS API. See next.config.mjs. */
export const SAME_ORIGIN_API_PREFIX = "/api";

/** Same-origin prefix Next.js rewrites to the OHIF viewer. See next.config.mjs. */
export const SAME_ORIGIN_OHIF_PREFIX = "/ohif";

export type PlatformKind = "web" | "desktop";

/**
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when it appears as a complete
 * static member expression, so these must be written out literally — never
 * resolved through a computed lookup such as `process.env[name]`.
 *
 * Read lazily (rather than snapshotted at module load) so unit tests can stub
 * them; inlining is a build-time transform, not a runtime lookup.
 */
function readEnv(): { appUrl?: string; desktopApiUrl?: string } {
  return {
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    desktopApiUrl: process.env.NEXT_PUBLIC_DESKTOP_API_URL,
  };
}

/**
 * The single detection point for the Tauri host.
 *
 * Tauri injects `window.__TAURI_INTERNALS__` into the webview before any page
 * script runs, so it is present for the whole lifetime of a desktop window and
 * absent in every browser tab. It is read through `globalThis` (not bare
 * `window`) so this module can also be imported from server components and from
 * unit tests running in Node.
 */
function detectPlatform(): PlatformKind {
  if (typeof globalThis === "undefined") return "web";
  const host = globalThis as Record<string, unknown> | undefined;
  return host?.__TAURI_INTERNALS__ ? "desktop" : "web";
}

let cachedPlatform: PlatformKind | undefined;

/** `"desktop"` inside the Tauri shell, `"web"` in a browser tab. */
export function platformKind(): PlatformKind {
  cachedPlatform ??= detectPlatform();
  return cachedPlatform;
}

export function isDesktop(): boolean {
  return platformKind() === "desktop";
}

export function isWeb(): boolean {
  return platformKind() === "web";
}

/** Absolute origin of the deployment serving this frontend, or "" when relative. */
function appOrigin(): string {
  return readEnv().appUrl?.trim().replace(/\/+$/, "") ?? "";
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\/[^/?#\s]+/i.test(value);
}

function isLoopbackHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      host === "localhost" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost") ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  } catch {
    return false;
  }
}

const warned = { malformed: false, crossOrigin: false, loopback: false };

function warnOnce(kind: keyof typeof warned, message: string): void {
  if (typeof console === "undefined" || warned[kind]) return;
  warned[kind] = true;
  console.warn(`[axis/platform] ${message}`);
}

/** Test seam: clears the memoized platform and the one-shot warning flags. */
export function resetPlatformCacheForTests(): void {
  cachedPlatform = undefined;
  warned.malformed = false;
  warned.crossOrigin = false;
  warned.loopback = false;
}

/**
 * Base URL every API request is built on.
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_DESKTOP_API_URL`, if explicitly set — either a
 *      root-relative path or an absolute http(s) URL.
 *   2. `"/api"`, the same-origin default.
 *
 * The same-origin default is what both web and desktop should use. A loopback
 * value in a production build is a misconfiguration: it would send every request
 * to the end user's own machine, so the build cannot authenticate and could
 * never be fixed on the user's side. That case is refused rather than shipped.
 */
export function apiBaseUrl(): string {
  const configured = readEnv().desktopApiUrl?.trim();

  if (!configured) return SAME_ORIGIN_API_PREFIX;
  if (configured.startsWith("/")) return configured.replace(/\/+$/, "");

  if (!isAbsoluteHttpUrl(configured)) {
    warnOnce(
      "malformed",
      `Ignoring NEXT_PUBLIC_DESKTOP_API_URL="${configured}": expected a root-relative path or an absolute http(s) URL. Falling back to ${SAME_ORIGIN_API_PREFIX}.`,
    );
    return SAME_ORIGIN_API_PREFIX;
  }

  if (isLoopbackHost(configured) && process.env.NODE_ENV === "production") {
    warnOnce(
      "loopback",
      `NEXT_PUBLIC_DESKTOP_API_URL points at a loopback address ("${configured}") in a production build. That build would send every request to the user's own machine and could not authenticate. Falling back to ${SAME_ORIGIN_API_PREFIX}.`,
    );
    return SAME_ORIGIN_API_PREFIX;
  }

  warnOnce(
    "crossOrigin",
    `NEXT_PUBLIC_DESKTOP_API_URL is set to "${configured}", so the session cookie becomes cross-site. The Axis API issues axis_session with sameSite=lax and no CSRF token, so login will fail unless the API is changed to sameSite=none; secure.`,
  );
  return configured.replace(/\/+$/, "");
}

/** Joins a path onto the resolved API base. */
export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

/**
 * Base URL for the OHIF viewer.
 *
 * Always same-origin by design: OHIF calls the DICOMweb proxy with
 * `credentials: "same-origin"`, so it must share an origin with the session
 * cookie. Next.js proxies `/ohif/*` to the viewer container. This deliberately
 * ignores `NEXT_PUBLIC_DESKTOP_API_URL` — pointing the viewer at a third origin
 * would strip the cookie and 401 every study request.
 */
export function ohifBaseUrl(): string {
  const origin = appOrigin();
  return origin
    ? `${origin}${SAME_ORIGIN_OHIF_PREFIX}`
    : SAME_ORIGIN_OHIF_PREFIX;
}

/** Viewer URL for a single study, matching the existing `/ohif` route. */
export function ohifViewerUrl(studyInstanceUid: string): string {
  return `${ohifBaseUrl()}/viewer?StudyInstanceUIDs=${encodeURIComponent(
    studyInstanceUid,
  )}`;
}
