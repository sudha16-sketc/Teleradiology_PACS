"use client";

import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { ThemeManager } from "@/components/layout/ThemeManager";
import {
  GlobalErrorCapture,
  AppErrorBoundaryFallback,
} from "@/components/GlobalErrorCapture";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAppStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const hydrateAuth = useAppStore((s) => s.hydrateAuth);

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  return (
    /*
     * The class boundary is the outer of the two on purpose. It is synchronous
     * and imports almost nothing, so it still works when the providers below it
     * are the thing that failed to render.
     */
    <ErrorBoundary
      fallback={(error, reset) => (
        <AppErrorBoundaryFallback error={error} reset={reset} />
      )}
    >
      <QueryClientProvider client={queryClient}>
        <GlobalErrorCapture>
          <ThemeManager>{children}</ThemeManager>
        </GlobalErrorCapture>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
