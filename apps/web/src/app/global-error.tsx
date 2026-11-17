"use client";

import { useEffect } from "react";

/**
 * Boundary for failures in the root layout itself.
 *
 * Reached only when the providers, the theme manager or the `<html>` element
 * fail, which is why it cannot use the app shell: there is no shell to render
 * into. Styling is inline rather than from a class, because the stylesheet is
 * loaded by the layout that just failed.
 *
 * A reload is the only sensible recovery here, so that is what it offers.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Imported lazily: if `error-report.ts` itself were the thing that failed,
    // a static import would take this component down with it.
    void import("@/lib/error-report")
      .then(({ captureError }) => captureError({ error, context: "global-error" }))
      .catch(() => {
        // Reporting is best-effort and must never be the reason the page is
        // blank. Silently ignored by design.
      });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f14",
          color: "#e6edf3",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>
            Axis could not start
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#9aa7b4",
            }}
          >
            The application hit an error it could not recover from. Reloading
            usually clears it. If it keeps happening, restart the desktop client
            and quote the reference below to support.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 0.875rem",
              borderRadius: "0.375rem",
              border: "1px solid #2b3644",
              background: "#16202b",
              color: "#e6edf3",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            Reload Axis
          </button>
          {error.digest ? (
            <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#6b7885" }}>
              Reference:{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                {error.digest}
              </code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
