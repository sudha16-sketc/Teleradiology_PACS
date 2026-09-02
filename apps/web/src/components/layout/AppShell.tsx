"use client";

import { NavigationRail } from "./NavigationRail";
import { TopBar } from "./TopBar";
import { useAppStore } from "@/lib/store";
import { clsx } from "clsx";

export function AppShell({
  children,
  breadcrumbs,
}: {
  children: React.ReactNode;
  breadcrumbs?: string[];
}) {
  const { railCollapsed } = useAppStore();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NavigationRail />
      <div
        className={clsx(
          "flex flex-1 flex-col transition-all duration-200",
          railCollapsed ? "ml-16" : "ml-60",
        )}
      >
        <TopBar breadcrumbs={breadcrumbs} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
