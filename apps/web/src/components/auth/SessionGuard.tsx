"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { roleHasAccess } from "@/lib/permissions";
import type { AuthUser, UserRole } from "@axis/types";

interface ApiEnvelope<T> {
  data: T;
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      <p className="text-sm text-text-muted">Loading Axis…</p>
    </div>
  );
}

function ForbiddenScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6">
      <ShieldAlert size={48} strokeWidth={1} className="text-error" />
      <h1 className="font-heading text-xl font-bold text-text-primary">
        403 — Access Denied
      </h1>
      <p className="max-w-md text-center text-sm text-text-muted">
        Your account does not have permission to access this area. Contact an
        administrator if you believe this is a mistake.
      </p>
      <Link
        href="/worklist"
        className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
      >
        Go to Worklist
      </Link>
    </div>
  );
}

export function useSessionUser(): AuthUser | null {
  return useAppStore((s) => s.currentUser);
}

export function SessionGuard({
  requiredRole,
  children,
}: {
  requiredRole?: UserRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const authStatus = useAppStore((s) => s.authStatus);
  const currentUser = useAppStore((s) => s.currentUser);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<ApiEnvelope<AuthUser>>("/auth/me")
      .then((res) => {
        if (!cancelled) setCurrentUser(res.data);
      })
      .catch(() => {
        if (!cancelled) setCurrentUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [setCurrentUser]);

  if (authStatus === "loading") return <LoadingScreen />;

  if (authStatus === "anonymous") {
    if (pathname !== "/login") {
      router.replace("/login");
    }
    return null;
  }

  if (requiredRole && currentUser && currentUser.role !== requiredRole) {
    return <ForbiddenScreen />;
  }
  if (currentUser && !roleHasAccess(currentUser.role, pathname)) {
    return <ForbiddenScreen />;
  }

  return <>{children}</>;
}