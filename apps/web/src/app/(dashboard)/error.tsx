"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Something went wrong"
      description={
        process.env.NODE_ENV === "development"
          ? error.message
          : "An unexpected error occurred. Try again, or contact your administrator."
      }
      onRetry={reset}
    />
  );
}
