"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { AppNotification } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

interface NotificationsEnvelope {
  data: AppNotification[];
  unread: number;
}

const TYPE_LABELS: Record<string, string> = {
  CORRECTION_REQUESTED: "Correction requested",
  CORRECTION_APPROVED: "Correction approved",
  CORRECTION_REJECTED: "Correction rejected",
  CORRECTION_STARTED: "Correction started",
  CORRECTED_REPORT_SIGNED: "Corrected report signed",
  CORRECTION_RESOLVED: "Correction resolved",
  CORRECTED_REPORT_DELIVERED: "Corrected report delivered",
  CORRECTION_HOSPITAL_ACCEPTED: "Corrected report accepted",
};

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<NotificationsEnvelope>("/notifications");
      setItems(res.data ?? []);
      setUnread(res.unread ?? 0);
    } catch {
      // transient; ignore polling failures
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markRead = async (n: AppNotification) => {
    try {
      await apiClient.post(`/notifications/${n.id}/read`);
      await load();
    } catch {
      // ignore
    }
  };

  const markAllRead = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await apiClient.post("/notifications/read-all");
      await load();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const openStudy = (n: AppNotification) => {
    setOpen(false);
    void markRead(n);
    if (n.studyId) {
      router.push(`/reading/${n.studyId}`);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          void load();
        }}
        className="relative rounded-md p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <span className="text-sm font-semibold text-text-primary">
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={loading}
                className="flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent/80 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <CheckCheck size={12} />
                )}
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-text-muted">
                No notifications
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openStudy(n)}
                  className="flex w-full flex-col gap-0.5 border-b border-border px-3.5 py-2.5 text-left transition-colors hover:bg-surface"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary">
                      {TYPE_LABELS[n.type] ?? n.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-text-muted">
                      {formatDateTime(n.createdAt)}
                    </span>
                  </div>
                  <span className="text-xs text-text-muted">{n.message}</span>
                  {!n.readAt && (
                    <span className="mt-0.5 inline-flex w-fit rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      New
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
