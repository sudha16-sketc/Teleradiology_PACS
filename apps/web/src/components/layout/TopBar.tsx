"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  LogOut,
  Settings,
  UserRound,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { apiClient } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/permissions";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ThemeMenu } from "@/components/layout/ThemeMenu";

function avatarInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function TopBar({ breadcrumbs }: { breadcrumbs?: string[] }) {
  const router = useRouter();
  const currentUser = useAppStore((s) => s.currentUser);
  const clearCurrentUser = useAppStore((s) => s.clearCurrentUser);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleLogout() {
    try {
      await apiClient.post("/auth/logout");
    } catch {
      // ignore network errors on logout; clear local state regardless
    }
    clearCurrentUser();
    router.replace("/login");
  }

  const name = currentUser?.displayName ?? "";
  const role = currentUser ? ROLE_LABELS[currentUser.role] : "";
  const isAdmin = currentUser?.role === "ADMIN";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-text-muted">/</span>}
              <span
                className={
                  i === breadcrumbs.length - 1
                    ? "font-medium text-text-primary"
                    : "text-text-muted"
                }
              >
                {crumb}
              </span>
            </span>
          ))
        ) : (
          <span className="text-text-muted">Axis</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <ThemeMenu />
        <NotificationBell />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-raised"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
              {avatarInitials(name)}
            </div>
            <div className="hidden text-left text-sm sm:block">
              <div className="font-medium leading-tight text-text-primary">
                {name || "…"}
              </div>
              <div className="text-xs leading-tight text-text-muted">
                {role || "…"}
              </div>
            </div>
            <ChevronDown
              size={14}
              className={menuOpen ? "text-text-muted" : "text-text-muted/60"}
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg"
            >
              <div className="border-b border-border px-3.5 py-3">
                <div className="text-sm font-medium text-text-primary">
                  {name || "Signed in"}
                </div>
                <div className="mt-0.5 truncate text-xs text-text-muted">
                  {currentUser?.email ?? ""}
                </div>
                <div className="mt-1 text-xs text-accent">{role}</div>
              </div>

              <Link
                href="/profile"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface"
                role="menuitem"
              >
                <UserRound size={16} className="text-text-muted" />
                Profile
              </Link>

              {isAdmin && (
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface"
                  role="menuitem"
                >
                  <Settings size={16} className="text-text-muted" />
                  Settings
                </Link>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 border-t border-border px-3.5 py-2 text-left text-sm text-error transition-colors hover:bg-surface"
                role="menuitem"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}