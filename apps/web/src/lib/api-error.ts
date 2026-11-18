/**
 * Failure classification for the online-only Axis client.
 *
 * # Why this exists
 *
 * Axis is online-only: there is no local database, no cache and no offline
 * queue, so *every* read ultimately depends on a live API and a live PACS. That
 * makes the difference between "the server said no" and "the server is not
 * there" the single most important thing the UI can tell a radiologist, and
 * getting it wrong is actively dangerous — a client that quietly pretends it is
 * working offline would let someone read a stale worklist and believe it is
 * current.
 *
 * So failures are sorted into a small closed set of kinds, each with an
 * explicit user-facing message, and `offline` is never dressed up as success.
 *
 * # Message safety
 *
 * For 4xx the API's own message is used, because NestJS builds those from
 * `HttpException`s that are written to be read by a clinician ("You do not
 * have access to studies from this hospital"). The exception filter replaces
 * anything unexpected with a generic "Internal server error", so no internals
 * reach the client. For 5xx and transport failures we substitute our own text
 * rather than forwarding an upstream body we did not write.
 */

/** Closed set of ways a request can fail. */
export type ApiFailureKind =
  /** The request never reached a server: DNS, refused connection, TLS, airplane mode. */
  | "offline"
  /** The request was abandoned because it exceeded its deadline. */
  | "timeout"
  /** 401 — the session is gone or was revoked. */
  | "unauthenticated"
  /** 403 — authenticated, but not permitted to do this. */
  | "forbidden"
  /** 404 */
  | "not_found"
  /** 409 */
  | "conflict"
  /** 400 / 422 */
  | "validation"
  /** 503 from the imaging backend (Orthanc) — the API is up, images are not. */
  | "imaging_unavailable"
  /** Any other 5xx. */
  | "server"
  /** Any other 4xx. */
  | "client"
  /** A failure we could not classify. */
  | "unknown";

export interface ApiFailure {
  kind: ApiFailureKind;
  /**
   * Short, readable, safe to render. Never a stack trace, an upstream body, or
   * a patient identifier.
   */
  message: string;
  /** HTTP status, absent for transport failures. */
  status?: number;
  /**
   * The API's `x-request-id` for this request. Present whenever a server
   * produced the failure and is the value support needs to find the exact log
   * line, so the UI must surface it rather than discarding it.
   */
  correlationId?: string;
  /** Whether trying the identical request again could plausibly succeed. */
  retryable: boolean;
  /** Whether the user has to sign in again before anything will work. */
  requiresSignIn: boolean;
}

/** Copy for each kind. Deliberately says what is wrong, never why in detail. */
const MESSAGES: Record<ApiFailureKind, string> = {
  offline: "Unable to connect to PACS server.",
  timeout: "The PACS server took too long to respond.",
  unauthenticated: "Your session has ended. Sign in again to continue.",
  forbidden: "You do not have permission to do that.",
  not_found: "That record no longer exists.",
  conflict: "Someone else changed this first. Refresh and try again.",
  validation: "That request was not valid.",
  imaging_unavailable:
    "The imaging backend is temporarily unavailable. Images cannot be loaded right now.",
  server: "The PACS server ran into a problem.",
  client: "The PACS server rejected that request.",
  unknown: "Something went wrong.",
};

/** Kinds where the same request is worth retrying unchanged. */
const RETRYABLE: ReadonlySet<ApiFailureKind> = new Set<ApiFailureKind>([
  "offline",
  "timeout",
  "imaging_unavailable",
  "server",
  "unknown",
]);

/**
 * Kinds whose message is replaced by our own copy.
 *
 * Everything else is a 4xx, where the API authored the message for a human to
 * read; these are the cases where the text originated somewhere other than our
 * own validation, or could not have come from a response at all.
 */
const SERVER_AUTHORED_EXCLUSIONS: ReadonlySet<ApiFailureKind> =
  new Set<ApiFailureKind>([
    "server",
    "imaging_unavailable",
    "offline",
    "timeout",
    "unknown",
  ]);

/**
 * Classify an HTTP response.
 *
 * `serverMessage` is the API's `message` field, used only for the 4xx kinds
 * where it was authored for humans.
 */
export function classifyStatus(
  status: number,
  serverMessage?: string,
  correlationId?: string,
  serverError?: string,
): ApiFailure {
  let kind: ApiFailureKind;
  if (status === 401) kind = "unauthenticated";
  else if (status === 403) kind = "forbidden";
  else if (status === 404) kind = "not_found";
  else if (status === 409) kind = "conflict";
  else if (status === 400 || status === 422) kind = "validation";
  else if (
    status === 503 &&
    serverError === "Imaging Backend Error"
  )
    kind = "imaging_unavailable";
  else if (
    status === 504 &&
    (serverError === "Imaging Backend Error" ||
      /imaging backend/i.test(serverMessage ?? ""))
  )
    kind = "imaging_unavailable";
  else if (status >= 500) kind = "server";
  else if (status >= 400) kind = "client";
  else kind = "unknown";

  // A 4xx message comes from our own API and is written to be read. A 5xx or a
  // 503 message could come from a proxy or the imaging stack, so it is not
  // shown verbatim. Set membership rather than a chain of comparisons, because
  // the transport-only kinds cannot arise from a status code at all.
  const useServerMessage =
    !!serverMessage &&
    typeof serverMessage === "string" &&
    !SERVER_AUTHORED_EXCLUSIONS.has(kind);

  return {
    kind,
    message: useServerMessage ? serverMessage : MESSAGES[kind],
    status,
    ...(correlationId ? { correlationId } : {}),
    retryable: RETRYABLE.has(kind),
    requiresSignIn: kind === "unauthenticated",
  };
}

/** True for a value shaped like a DOMException/Error named "AbortError". */
function isAbortError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const name = (value as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Classify a thrown value from `fetch`.
 *
 * `fetch` rejects with a `TypeError` for every transport problem (offline,
 * DNS failure, connection refused, TLS failure) and an `AbortError` when a
 * deadline fires. Neither carries a status, so they are told apart by name and
 * by the presence of our own marker.
 */
export function classifyThrown(
  value: unknown,
  correlationId?: string,
): ApiFailure {
  if (isAbortError(value)) {
    return {
      kind: "timeout",
      message: MESSAGES.timeout,
      ...(correlationId ? { correlationId } : {}),
      retryable: true,
      requiresSignIn: false,
    };
  }

  return {
    kind: "offline",
    message: MESSAGES.offline,
    ...(correlationId ? { correlationId } : {}),
    retryable: true,
    requiresSignIn: false,
  };
}

/** True when the failure means the app cannot talk to its backend at all. */
export function isConnectivityFailure(failure: ApiFailure): boolean {
  return (
    failure.kind === "offline" ||
    failure.kind === "timeout" ||
    failure.kind === "server"
  );
}

/**
 * Guidance shown under the headline message. Kept separate so the headline can
 * stay short and scannable while the detail tells the user what to do.
 */
export function failureHint(failure: ApiFailure): string | undefined {
  switch (failure.kind) {
    case "offline":
      return "Check your network connection, then try again. Axis does not work offline and no data has been cached on this machine.";
    case "timeout":
      return "The study may be large. Try again, or ask your administrator to check the server.";
    case "unauthenticated":
      return "Your work is not lost. Sign in again to pick up where you left off.";
    case "imaging_unavailable":
      return "Reports and worklists still work. Only image display is affected.";
    case "server":
      return "Try again. If it keeps happening, quote the reference ID to support.";
    default:
      return undefined;
  }
}
