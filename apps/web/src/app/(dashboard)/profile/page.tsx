"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Phone, UserRound } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { ROLE_LABELS } from "@/lib/permissions";
import { normalizePhone, phoneHref, PHONE_VALIDATION_MESSAGE } from "@/lib/phone";
import { PhoneField } from "@/components/PhoneField";
import type { AuthUser } from "@axis/types";

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
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPhone(currentUser?.phone ? currentUser.phone.replace(/^\+91/, "") : "");
  }, [currentUser?.phone]);

  if (!currentUser) return null;

  async function savePhone(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone);
    if (normalized === null) {
      setError(PHONE_VALIDATION_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.patch<{ data: AuthUser }>("/auth/me", {
        phone: normalized,
      });
      setCurrentUser(response.data);
      setNotice("Phone number updated.");
    } catch (err) {
      setError((err as { message?: string }).message ?? "Unable to update phone number.");
    } finally {
      setSaving(false);
    }
  }

  const phoneLink = phoneHref(currentUser.phone);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="font-heading text-xl font-bold text-text-primary">
        Profile
      </h1>

      <div className="rounded-md border border-border bg-surface p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xl font-semibold text-accent">
            {avatarInitials(currentUser.displayName)}
          </div>
          <div className="min-w-0">
            <div className="break-words text-lg font-semibold text-text-primary">
              {currentUser.displayName}
            </div>
            <a
              href={`mailto:${currentUser.email}`}
              className="flex items-center gap-1.5 break-all text-sm text-accent hover:underline"
            >
              <Mail size={13} className="shrink-0" />
              {currentUser.email}
            </a>
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
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Phone
            </dt>
            <dd className="mt-1 text-sm text-text-primary">
              {phoneLink ? (
                <a href={phoneLink} className="flex items-center gap-1.5 text-accent hover:underline">
                  <Phone size={13} className="shrink-0" />
                  {currentUser.phone}
                </a>
              ) : (
                "Not provided"
              )}
            </dd>
          </div>
        </dl>
      </div>

      <form
        onSubmit={savePhone}
        className="space-y-3 rounded-md border border-border bg-surface p-6"
      >
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          Update phone number
        </h2>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        {notice && <p role="status" className="text-sm text-success">{notice}</p>}
        <PhoneField value={phone} onChange={setPhone} />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save phone number
        </button>
      </form>

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
