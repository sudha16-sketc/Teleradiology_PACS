import type { ApiError } from "@axis/types";
import { apiBaseUrl } from "@/lib/platform";
import {
  classifyStatus,
  classifyThrown,
  type ApiFailure,
} from "@/lib/api-error";

interface RequestOptions extends Omit<RequestInit, "method" | "body"> {
  params?: Record<string, string | number | boolean | undefined>;
  /**
   * Milliseconds before the request is abandoned. Defaults to
   * {@link DEFAULT_TIMEOUT_MS}. A DICOM upload is a whole study and legitimately
   * takes minutes, so it passes a much larger budget rather than being exempt.
   */
  timeoutMs?: number;
  /**
   * Correlation ID to send as `x-request-id`. The API echoes it and returns it
   * on errors, which is what lets a user quote one value to support and have it
   * matched to a server log line. Generated per request when omitted.
   */
  correlationId?: string;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A failed request.
 *
 * Extends `Error` so the many `catch` blocks that read `err.message` work, and
 * additionally carries the fields a UI needs to react properly rather than
 * showing the same text for every failure.
 *
 * The API's own fields (`statusCode`, `error`, `timestamp`, `path`) are kept so
 * existing consumers that read them keep working.
 */
export class ApiRequestError extends Error {
  readonly failure: ApiFailure;
  readonly statusCode?: number;
  readonly error?: string;
  readonly timestamp: string;
  readonly path: string;
  readonly correlationId?: string;
  readonly body?: ApiError;

  constructor(failure: ApiFailure, path: string, body?: ApiError) {
    super(failure.message);
    this.name = "ApiRequestError";
    this.failure = failure;
    this.path = path;
    this.body = body;
    if (failure.status !== undefined) this.statusCode = failure.status;
    if (failure.correlationId !== undefined) this.correlationId = failure.correlationId;
    if (body) {
      this.error = body.error;
      this.timestamp = body.timestamp;
    } else {
      this.timestamp = new Date().toISOString();
    }
  }

  get kind(): ApiFailure["kind"] {
    return this.failure.kind;
  }

  get retryable(): boolean {
    return this.failure.retryable;
  }

  get requiresSignIn(): boolean {
    return this.failure.requiresSignIn;
  }
}

/** True when a value is one of our request errors. */
export function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError;
}

/**
 * Reduce any throwable to the failure shape the UI renders.
 *
 * Every error surface goes through this rather than reading `err.message`
 * directly. That is the single reason a raw status code, an upstream response
 * body or a rejected `Error` from an unrelated promise can never reach a user:
 * anything unrecognised is classified as an opaque `unknown`.
 */
export function failureOf(error: unknown): ApiFailure {
  if (isApiRequestError(error)) return error.failure;
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return classifyThrown(error);
  }
  return {
    kind: "unknown",
    message: "Something went wrong.",
    retryable: false,
    requiresSignIn: false,
  };
}

function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  const query = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        query.set(key, String(value));
      }
    }
  }
  const qs = query.toString();
  return `${apiBaseUrl()}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * A short random request ID.
 *
 * Sent as `x-request-id`, which `CorrelationMiddleware` already accepts and
 * echoes. The value is opaque and carries nothing about the user, the study or
 * the session.
 */
function newCorrelationId(): string {
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Raised by the abort controller when our own deadline fires. */
class DeadlineError extends Error {
  constructor() {
    super("Request deadline exceeded");
    this.name = "TimeoutError";
  }
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions & { body?: unknown } = {},
  parseResponse: (response: Response) => Promise<T> = async (response) => {
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  },
): Promise<T> {
  const {
    params,
    body,
    headers: customHeaders,
    timeoutMs,
    correlationId,
    ...rest
  } = options;

  const isFormData = body instanceof FormData;
  // Generated before the request so it can be attached to a transport failure
  // too — a network error with no ID is the one case support cannot trace.
  const requestId = correlationId ?? newCorrelationId();

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    "x-request-id": requestId,
    ...Object.fromEntries(
      Object.entries(customHeaders ?? {}).map(([k, v]) => [k, v as string]),
    ),
  };

  const controller = new AbortController();
  const budget = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(new DeadlineError()), budget);

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      body:
        body !== undefined
          ? isFormData
            ? (body as FormData)
            : JSON.stringify(body)
          : undefined,
      credentials: "include",
      signal: controller.signal,
      ...rest,
    });
  } catch (error) {
    // `abort(reason)` surfaces our DeadlineError; a caller-supplied signal
    // surfaces whatever it aborted with.
    const reason =
      controller.signal.reason instanceof DeadlineError
        ? controller.signal.reason
        : error;
    throw new ApiRequestError(
      classifyThrown(reason, requestId),
      path,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let body: ApiError | undefined;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      body = undefined;
    }
    // Prefer the ID the server actually used, so the value the user is shown
    // is the one in the server log rather than the one we hoped for.
    const serverId =
      response.headers.get("x-request-id") ?? body?.correlationId ?? requestId;
    throw new ApiRequestError(
      classifyStatus(response.status, body?.message, serverId, body?.error),
      path,
      body,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return parseResponse(response);
}

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("GET", path, options);
  },

  getBlob(path: string, options?: RequestOptions): Promise<Blob> {
    return request<Blob>("GET", path, options, (response) => response.blob());
  },

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("POST", path, { ...options, body });
  },

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("PUT", path, { ...options, body });
  },

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("PATCH", path, { ...options, body });
  },

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("DELETE", path, options);
  },
};
