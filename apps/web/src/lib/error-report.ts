/**
 * Desktop error capture: what we record, what we deliberately refuse to.
 *
 * # The rule
 *
 * A support engineer needs enough to find the matching server-side log line and
 * nothing more. That is: a version, an OS, an error type, a stack, a timestamp
 * and a correlation ID. Everything else is either a secret or patient data, and
 * both are refused here rather than trusted to callers.
 *
 * Nothing in this module ever records: passwords, session cookies, bearer or
 * access tokens, JWTs, API keys, or a patient name, accession number, study UID
 * or DICOM attribute. There is no "debug" mode that widens this — the
 * redaction below is not a filter over optional fields, it is applied to every
 * string that can reach a report.
 *
 * # Where reports go
 *
 * Reports are held in a bounded in-memory ring and shown in the error UI, which
 * is enough for the user to copy a reference ID into a support ticket. The
 * correlation ID is the join key against the API's structured log, so nothing
 * needs to leave the machine for the common case. Wiring an external sink is a
 * configuration change, not a code change; see `docs/DESKTOP.md`.
 */

import type { ApiFailure, ApiFailureKind } from "@/lib/api-error";

/** Longest retained stack, in characters. A full WebView2 stack can be huge. */
const MAX_STACK_CHARS = 4000;

/** How many reports are retained for the error UI. */
const MAX_REPORTS = 50;

/** A captured error, safe to log or display. */
export interface ErrorReport {
  /** Short, quotable, and derived from nothing sensitive. */
  referenceId: string;
  /** ISO-8601, client clock. */
  timestamp: string;
  /** Desktop app version, or the web build's version. */
  appVersion: string;
  /** `web` or `desktop`. */
  client: "web" | "desktop";
  /** OS name and version, e.g. `windows 10.0.19045`. Empty on the web client. */
  os: string;
  /** Coarse failure classification, not a raw message. */
  kind: ApiFailureKind;
  /** Short type label, e.g. `TypeError`. Never a stack. */
  errorType: string;
  /** Redacted, single-line summary. */
  message: string;
  /** Redacted stack, when one exists. */
  stack?: string;
  /** The API's request ID, so this maps to one server-side log entry. */
  correlationId?: string;
  /** Route the user was on, path only — no query string. */
  route?: string;
  /** Where it was caught: `window.onerror`, a React boundary, a route boundary. */
  context?: string;
  /** Redacted provenance: component stack, or file and line. */
  source?: string;
}

/**
 * Patterns replaced before anything is stored or displayed.
 *
 * Ordered: the credential shapes run first so that a token embedded in a longer
 * line is removed before the generic long-blob rule can mangle the rest.
 */
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // `Authorization: Bearer x`, `token=...`, `password: ...`, `cookie: ...` …
  [
    /\b(bearer|basic|token|access[_-]?token|refresh[_-]?token|id[_-]?token|jwt|authorization|cookie|set-cookie|password|passwd|pwd|secret|api[_-]?key|client[_-]?secret|axis_session)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;)}\]]+)/gi,
    "$1=[redacted]",
  ],
  // Bare JWTs, wherever they appear.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[redacted-jwt]"],
  // DICOM UIDs and numeric identifiers.
  [/\b\d{1,18}(?:\.\d{1,18}){2,}\b/g, "[redacted-uid]"],
  [/\b\d{6,}\b/g, "[redacted-id]"],
  [/\b[0-9a-f]{32,}\b/gi, "[redacted-hex]"],
  // Email addresses: staff identifiers are still personal data.
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[redacted-email]"],
];

/**
 * Absolute URLs, keeping origin and path but dropping the query string, which
 * routinely carries identifiers and occasionally tokens.
 *
 * Applied after {@link REDACTIONS} rather than as an entry in it because the
 * replacement has to rebuild the match from its capture groups.
 */
const ABSOLUTE_URL = /\bhttps?:\/\/([^\s/?#]+)(\/[^\s?#]*)?(\?[^\s#]*)?/gi;

/**
 * Strip secrets, tokens and identifiers from a string.
 *
 * Exported for tests; used internally on every free-text field.
 */
export function redact(input: string): string {
  let out = input;
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(ABSOLUTE_URL, (_match, origin: string, path?: string) => {
    return `${origin}${path ?? ""}`;
  });
  return out;
}

/** Collapse to a single bounded line. */
function oneLine(input: string, max = 300): string {
  return redact(input).replace(/\s+/g, " ").trim().slice(0, max);
}

const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford-ish: no I, L, O, U.

/**
 * A short reference the user can read aloud, e.g. `K3M-7QF-29XD`.
 *
 * Derived from the clock and `crypto.getRandomValues` only — never from the
 * error itself — so a reference ID cannot leak the content it describes.
 */
export function newReferenceId(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(2, 14); // yymmddHHMMSS
  const bytes = new Uint8Array(9);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Only reachable on an exotic host; a reference ID need not be
    // cryptographic, only unguessable enough to avoid collisions in a log.
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let random = "";
  for (const byte of bytes) {
    random += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return `${stamp.slice(0, 6)}-${random.slice(0, 3)}-${random.slice(3, 6)}-${random.slice(6, 9)}`;
}

/** Runtime facts injected by the desktop bridge, or empty on the web client. */
export interface RuntimeInfo {
  appVersion?: string;
  os?: string;
}

let runtimeInfo: RuntimeInfo = {};
const reports: ErrorReport[] = [];

/** Supplied once at startup by the desktop bridge. */
export function setRuntimeInfo(info: RuntimeInfo): void {
  runtimeInfo = { ...runtimeInfo, ...info };
}

/** Test seam. */
export function resetErrorReportingForTests(): void {
  runtimeInfo = {};
  reports.length = 0;
}

/** Retained reports, newest first. */
export function recentReports(): readonly ErrorReport[] {
  return [...reports].reverse();
}

export interface CaptureInput {
  error: unknown;
  failure?: ApiFailure;
  /** Route path, no query string. */
  route?: string;
  /** Overrides the generated reference; used when a correlation ID exists. */
  referenceId?: string;
  /**
   * Where the fault was caught: `window.onerror`, `unhandledrejection`, a React
   * boundary, a route boundary.
   *
   * Distinguishes "the app crashed" from "this one request failed", which is the
   * difference between a bug report and a support ticket.
   */
  context?: string;
  /**
   * Extra provenance: a component stack, or a file name and line. Redacted and
   * truncated, because both routinely embed absolute build paths.
   */
  source?: string;
}

/**
 * Record an error and return its report.
 *
 * Safe to call from a `catch` with anything, including a thrown string or a
 * rejected non-Error promise.
 */
export function captureError(input: CaptureInput): ErrorReport {
  const { error, failure, route, context, source } = input;

  const errorType =
    error instanceof Error
      ? error.constructor.name || "Error"
      : typeof error === "object" && error !== null
        ? "Object"
        : typeof error;

  const stackFrames =
    error instanceof Error && error.stack
      ? error.stack
          .split(/\r?\n/)
          .filter((line) => /^\s*at\s/.test(line) || /^[^\s]+@/.test(line))
          .join("\n")
      : undefined;
  const safeMessage = failure
    ? `${failure.kind}${failure.status ? ` (HTTP ${failure.status})` : ""}`
    : "Application error";
  const routeCategory = route?.split(/[?#]/, 1)[0]?.split("/").filter(Boolean)[0];

  const report: ErrorReport = {
    referenceId: input.referenceId ?? newReferenceId(),
    timestamp: new Date().toISOString(),
    appVersion: runtimeInfo.appVersion ?? "unknown",
    client: runtimeInfo.os ? "desktop" : "web",
    os: runtimeInfo.os ?? "",
    kind: failure?.kind ?? "unknown",
    errorType: oneLine(errorType, 80),
    message: safeMessage,
    ...(stackFrames
      ? { stack: redact(stackFrames).slice(0, MAX_STACK_CHARS) }
      : {}),
    ...(failure?.correlationId ? { correlationId: failure.correlationId } : {}),
    ...(routeCategory ? { route: redact(routeCategory) } : {}),
    ...(context ? { context: oneLine(context, 60) } : {}),
    ...(source ? { source: redact(source).slice(0, MAX_STACK_CHARS) } : {}),
  };

  reports.push(report);
  if (reports.length > MAX_REPORTS) reports.shift();

  // Single structured line, matching the API logger's shape so the two are
  // greppable the same way. Redaction has already happened above.
  if (typeof console !== "undefined") {
    console.error(
      `[axis/error] ${JSON.stringify({
        referenceId: report.referenceId,
        timestamp: report.timestamp,
        appVersion: report.appVersion,
        client: report.client,
        os: report.os,
        kind: report.kind,
        errorType: report.errorType,
        message: report.message,
        correlationId: report.correlationId,
        route: report.route,
        context: report.context,
      })}`,
    );
  }

  return report;
}

/**
 * The technical block shown behind "Show technical details".
 *
 * Returns text that is already redacted, and deliberately omits the stack
 * unless the caller asks: a stack is useful to support pasted into a ticket,
 * and useless (and alarming) to a radiologist mid-read.
 */
export function technicalDetails(
  report: ErrorReport,
  options: { includeStack?: boolean } = {},
): string {
  const lines = [
    `Reference: ${report.referenceId}`,
    `Time: ${report.timestamp}`,
    `Client: ${report.client}${report.appVersion !== "unknown" ? ` ${report.appVersion}` : ""}`,
    ...(report.os ? [`OS: ${report.os}`] : []),
    `Type: ${report.errorType} (${report.kind})`,
    `Message: ${report.message}`,
    ...(report.context ? [`Caught by: ${report.context}`] : []),
    ...(report.route ? [`Route: ${report.route}`] : []),
    ...(report.correlationId ? [`Server request ID: ${report.correlationId}`] : []),
  ];
  if (options.includeStack && report.stack) lines.push("", report.stack);
  if (options.includeStack && report.source) {
    lines.push("", report.source);
  }
  return lines.join("\n");
}
