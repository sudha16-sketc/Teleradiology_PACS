"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "clsx";
import { failureHint, type ApiFailure } from "@/lib/api-error";
import { captureError, technicalDetails, type ErrorReport } from "@/lib/error-report";

/**
 * The one error surface for the whole client.
 *
 * # What a radiologist should see
 *
 * A short sentence saying what is wrong, a hint saying what to do, and a
 * retry button when retrying could plausibly help. No stack, no HTTP status, no
 * upstream response body. Someone reading a study at 3am needs to know whether
 * to try again, sign in, or call somebody — not what a promise rejected with.
 *
 * # What support should see
 *
 * A reference ID, quotable over the phone, plus an optional "technical details"
 * disclosure carrying the redacted report. The server's correlation ID is shown
 * separately because that is the value that actually matches a log line, and
 * the client reference is the value the user can read out.
 */
export interface ErrorPanelProps {
  failure: ApiFailure;
  /** Re-attempt whatever failed. Omitted when retrying cannot help. */
  onRetry?: () => void;
  /** Free-text context shown above the message, e.g. "Could not load worklist". */
  title?: string;
  /** The original throwable, captured for the report so a stack is available. */
  cause?: unknown;
  className?: string;
}

export function ErrorPanel({
  failure,
  onRetry,
  title,
  cause,
  className,
}: ErrorPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  // Captured once per failure so the reference ID is stable across re-renders:
  // a user reading it out must not see it change under them.
  const [report] = useState<ErrorReport>(() =>
    captureError({ error: cause ?? new Error(failure.message), failure }),
  );

  const hint = failureHint(failure);
  const details = technicalDetails(report, { includeStack: showDetails });

  return (
    <div
      role="alert"
      className={clsx(
        "rounded-lg border border-error/30 bg-error/5 p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-error" />

        <div className="min-w-0 flex-1">
          {title ? (
            <p className="text-sm font-medium text-text-primary">{title}</p>
          ) : null}

          <p className="text-sm text-text-primary">{failure.message}</p>

          {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}

          <p className="mt-2 text-xs text-text-muted">
            Reference:{" "}
            <code className="font-mono text-text-primary">
              {report.referenceId}
            </code>
            {failure.correlationId ? (
              <>
                {" · "}Server request:{" "}
                <code className="font-mono text-text-primary">
                  {failure.correlationId}
                </code>
              </>
            ) : null}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onRetry && failure.retryable ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-accent/90"
              >
                <RefreshCw size={12} />
                Try again
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setShowDetails((open) => !open)}
              className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-primary"
              aria-expanded={showDetails}
            >
              {showDetails ? (
                <ChevronUp size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
              {showDetails ? "Hide technical details" : "Show technical details"}
            </button>
          </div>

          {showDetails ? (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-raised p-3 font-mono text-[11px] leading-relaxed text-text-muted">
              {details}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Banner for a client that has lost its backend.
 *
 * Separate from {@link ErrorPanel} because it is app-level, not view-level: it
 * is deliberately explicit that Axis is online-only and that nothing is being
 * cached, so nobody is misled into reading a stale screen as current.
 */
export function OfflineBanner({
  failure,
  onRetry,
}: {
  failure: ApiFailure;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-error/30 bg-error/10 px-4 py-2.5"
    >
      <AlertTriangle size={16} className="shrink-0 text-error" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">
          {failure.message}
        </p>
        <p className="text-xs text-text-muted">
          Axis is online-only. No clinical data is stored on this computer, so
          nothing can be shown until the server is reachable.
        </p>
      </div>
      {onRetry && failure.retryable ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-accent/90"
        >
          <RefreshCw size={12} />
          Reconnect
        </button>
      ) : null}
    </div>
  );
}
