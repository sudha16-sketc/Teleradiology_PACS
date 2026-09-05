"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { ThemeManager } from "@/components/layout/ThemeManager";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeManager>{children}</ThemeManager>
    </QueryClientProvider>
  );
}