"use client";

import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { ThemeManager } from "@/components/layout/ThemeManager";
import { useAppStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const hydrateAuth = useAppStore((s) => s.hydrateAuth);

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeManager>{children}</ThemeManager>
    </QueryClientProvider>
  );
}