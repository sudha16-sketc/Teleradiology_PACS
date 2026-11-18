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
  X,
  Activity,
  Clock,
  UploadCloud,
  ServerCog,
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
  "/queue/verification": Clock,
  "/reading": Monitor,
  "/reports": FileText,
  "/hospitals": Building2,
  "/hospitals/submit": UploadCloud,
  "/hospitals/reports": FileText,
  "/hospitals/tracker": Activity,
  "/analytics": BarChart3,
  "/audit": Shield,
  "/operations": ServerCog,
  "/settings": Settings,
  "/settings/templates": FileText,
  "/admin/registration-requests": ClipboardCheck,
  "/profile": Monitor,
};

export function NavigationRail({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const { railCollapsed, setRailCollapsed, currentUser } = useAppStore();

  const role = currentUser?.role;
  const navItems: NavDefinition[] = role ? navigationForRole(role) : [];

  return (
    <aside
      className={clsx(
        "fixed inset-y-0 left-0 z-50 flex h-full w-60 max-w-[85vw] flex-col border-r border-border bg-surface transition-transform duration-200 lg:translate-x-0",
        mobileOpen
          ? "visible translate-x-0"
          : "invisible -translate-x-full",
        railCollapsed ? "lg:w-16" : "lg:w-60",
        "lg:visible",
      )}
      id="primary-navigation"
      aria-label="Primary navigation"
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <Activity size={20} className="shrink-0 text-accent" />
        {(!railCollapsed || mobileOpen) && (
          <span className="font-heading text-base font-bold tracking-tight text-text-primary">
            Axis
          </span>
        )}
        <button
          type="button"
          onClick={onMobileClose}
          className="ml-auto rounded-md p-2 text-text-muted hover:bg-surface-raised hover:text-text-primary lg:hidden"
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
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
                  onClick={onMobileClose}
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
                  {(!railCollapsed || mobileOpen) && <span>{item.label}</span>}

                  {railCollapsed && !mobileOpen && (
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

      <div className="hidden border-t border-border px-2 py-2 lg:block">
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