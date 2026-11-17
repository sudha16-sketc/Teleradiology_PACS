"use client";

import { useEffect } from "react";
import { ErrorPanel } from "@/components/ErrorPanel";
import { failureOf } from "@/lib/api-client";
import { captureError, newReferenceId } from "@/lib/error-report";
import { initRuntimeInfo } from "@/lib/desktop-bridge";

/**
 * Last-resort handlers for faults React will never see.
 *
 * A component that throws is caught by a boundary. An error thrown from an
 * effect cleanup, a rejected promise nobody awaited, or a WebView2 that fails to
 * paint is not: those reach `window.onerror` and `unhandledrejection`, and if
 * nothing listens they vanish silently. A radiologist would then see a frozen
 * screen with no way to describe it to support.
 *
 * # What is captured
 *
 * Only what is needed to make the report actionable: the message, the stack, the
 * reference ID and the runtime version. Everything passes through
 * `captureError`, which redacts tokens, cookies, DICOM UIDs, emails and URL
 * query strings first. Nothing is written to `console.log` by this module, and
 * nothing is sent anywhere — see `error-report.ts` for why the default sink is
 * the in-memory ring rather than a network call.
 */
export function GlobalErrorCapture({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // A crash report with no OS and app version is much less useful to support.
    void initRuntimeInfo();

    const onError = (event: ErrorEvent) => {
      captureError({
        error: event.error ?? new Error(event.message),
        context: "window.onerror",
        source: event.filename ? redactFilename(event.filename) : undefined,
        referenceId: newReferenceId(),
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      captureError({
        error: normaliseRejection(event.reason),
        context: "unhandledrejection",
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return <>{children}</>;
}

/**
 * A rejection reason is not necessarily an `Error`: anything can be thrown or
 * rejected, including strings and plain objects. Normalising means the
 * redaction path always has a real message to work on.
 */
function normaliseRejection(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === "string") return new Error(reason);
  try {
    return new Error(JSON.stringify(reason) ?? String(reason));
  } catch {
    return new Error("An unknown value was rejected");
  }
}

/**
 * Keep the file *name* and line, drop the directory.
 *
 * A WebView2 stack points at a build artefact path that can embed the operator's
 * Windows username, and occasionally a build path with a deployment name in it.
 */
function redactFilename(filename: string): string {
  const parts = filename.split(/[\\/]/);
  const last = parts[parts.length - 1] ?? filename;
  return last.length > 80 ? last.slice(0, 80) : last;
}

/**
 * Root error boundary for a React render failure.
 *
 * Deliberately not a component that imports anything heavy: a boundary that
 * itself fails to render replaces a bug with a blank screen.
 */
export function AppErrorBoundaryFallback({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const report = captureError({ error, context: "react-boundary" });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl">
        <ErrorPanel
          title="Axis hit an unexpected error"
          failure={failureOf(error)}
          cause={error}
          onRetry={reset}
        />
        <p className="mt-4 text-center text-xs text-text-muted">
          Quote reference{" "}
          <code className="font-mono text-text-primary">
            {report.referenceId}
          </code>{" "}
          to support. Nothing about this session was lost; reload if the screen
          does not recover.
        </p>
      </div>
    </div>
  );
}
