"use client";

import { UserRound } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { ROLE_LABELS } from "@/lib/permissions";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};

function avatarInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function ProfilePage() {
  const currentUser = useAppStore((s) => s.currentUser);

  if (!currentUser) return null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="font-heading text-xl font-bold text-text-primary">
        Profile
      </h1>

      <div className="rounded-md border border-border bg-surface p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-xl font-semibold text-accent">
            {avatarInitials(currentUser.displayName)}
          </div>
          <div>
            <div className="text-lg font-semibold text-text-primary">
              {currentUser.displayName}
            </div>
            <div className="text-sm text-text-muted">
              {currentUser.email}
            </div>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Role
            </dt>
            <dd className="mt-1 text-sm text-text-primary">
              {ROLE_LABELS[currentUser.role]}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Status
            </dt>
            <dd className="mt-1 text-sm text-text-primary">
              {STATUS_LABELS[currentUser.status]}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted">
        <UserRound size={14} />
        <span>
          Role and permissions are managed by an administrator and verified
          against the backend on every request.
        </span>
      </div>
    </div>
  );
}