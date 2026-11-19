"use client";

import { useEffect, useState } from "react";
import { NavigationRail } from "./NavigationRail";
import { TopBar } from "./TopBar";
import { useAppStore } from "@/lib/store";
import { clsx } from "clsx";
import { UpdateStatus, useUpdateCheck } from "@/components/UpdateStatus";

export function AppShell({
  children,
  breadcrumbs,
}: {
  children: React.ReactNode;
  breadcrumbs?: string[];
}) {
  const { railCollapsed } = useAppStore();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useUpdateCheck(true);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    const desktopViewport = window.matchMedia("(min-width: 1024px)");
    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) setMobileNavOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    desktopViewport.addEventListener("change", closeOnDesktop);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      desktopViewport.removeEventListener("change", closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [mobileNavOpen]);

  return (
    <div className="flex h-screen h-[100dvh] min-h-0 overflow-hidden bg-background">
      <NavigationRail
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}
      <div
        className={clsx(
          "flex min-w-0 flex-1 flex-col transition-[margin] duration-200",
          railCollapsed ? "lg:ml-16" : "lg:ml-60",
        )}
      >
        <TopBar
          breadcrumbs={breadcrumbs}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          mobileNavOpen={mobileNavOpen}
        />
        <div className="px-4 pt-3 sm:px-6">
          <UpdateStatus />
        </div>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
