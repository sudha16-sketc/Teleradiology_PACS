"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  ListTodo,
  Inbox,
  Monitor,
  FileText,
  Building2,
  BarChart3,
  Shield,
  Settings,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import {
  navigationForRole,
  type NavDefinition,
} from "@/lib/permissions";

const ICONS: Record<string, LucideIcon> = {
  "/worklist": ListTodo,
  "/queue": Inbox,
  "/reading": Monitor,
  "/reports": FileText,
  "/hospitals": Building2,
  "/analytics": BarChart3,
  "/audit": Shield,
  "/settings": Settings,
  "/admin/registration-requests": ClipboardCheck,
};

export function NavigationRail() {
  const pathname = usePathname();
  const { railCollapsed, setRailCollapsed, currentUser } = useAppStore();

  const role = currentUser?.role ?? "ADMIN";
  const navItems: NavDefinition[] = navigationForRole(role);

  return (
    <aside
      className={clsx(
        "fixed left-0 top-0 z-40 flex h-full flex-col border-r border-border bg-surface transition-all duration-200",
        railCollapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <Activity size={20} className="shrink-0 text-accent" />
        {!railCollapsed && (
          <span className="font-heading text-base font-bold tracking-tight text-text-primary">
            Axis
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="flex flex-col gap-0.5 px-2">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = ICONS[item.href] ?? ListTodo;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={clsx(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-text-muted hover:bg-surface-raised hover:text-text-primary",
                  )}
                >
                  <Icon
                    size={20}
                    className={clsx(
                      "shrink-0 transition-colors",
                      isActive
                        ? "text-accent"
                        : "text-text-muted group-hover:text-text-primary",
                    )}
                  />
                  {!railCollapsed && <span>{item.label}</span>}

                  {railCollapsed && (
                    <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-primary shadow-lg group-hover:block">
                      {item.label}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={() => setRailCollapsed(!railCollapsed)}
          className="flex w-full items-center justify-center gap-3 rounded-md px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
          aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {railCollapsed ? (
            <ChevronRight size={18} />
          ) : (
            <>
              <ChevronLeft size={18} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}