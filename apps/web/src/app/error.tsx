"use client";

import { useEffect } from "react";
import { AppErrorBoundaryFallback } from "@/components/GlobalErrorCapture";
import { captureError } from "@/lib/error-report";

/**
 * Route-segment error boundary.
 *
 * Next.js renders this instead of the segment that threw, so a render fault in
 * the reading room or the admin console degrades to a readable page with a retry
 * rather than a blank viewport inside a clinical session.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `digest` is Next.js's server-side correlation handle, already opaque.
    captureError({
      error,
      context: "route-error",
      ...(error.digest ? { referenceId: error.digest } : {}),
    });
  }, [error]);

  return <AppErrorBoundaryFallback error={error} reset={reset} />;
}
