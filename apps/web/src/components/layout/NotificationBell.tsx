"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { AppNotification } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { isDesktop } from "@/lib/platform";
import {
  notificationsPermitted,
  requestNativeNotificationPermission,
  showNativeNotification,
} from "@/lib/desktop-bridge";
import { notificationTitle } from "@/lib/notification-events";
import { formatDateTime } from "@/lib/format";

interface NotificationsEnvelope {
  data: AppNotification[];
  unread: number;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [nativeNotificationsEnabled, setNativeNotificationsEnabled] =
    useState(false);
  const [nativePermissionDenied, setNativePermissionDenied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Notification IDs already accounted for.
   *
   * The server is the only source of notifications, and this set exists purely
   * to decide what is *new*. Two rules, both deliberate:
   *
   *   - The first successful poll seeds the set without toasting anything, so
   *     starting the client does not fire a burst of toasts for everything that
   *     happened while it was closed.
   *   - Everything after that is new by definition, because the API only returns
   *     the current set and an ID already seen has been seen.
   *
   * Held in memory rather than in storage on purpose: a toast is a prompt to look
   * now, and re-announcing yesterday's events on tomorrow's launch is noise, not
   * information. The in-app list is the durable record.
   */
  const announced = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<NotificationsEnvelope>("/notifications");
      const incoming = res.data ?? [];
      setItems(incoming);
      setUnread(res.unread ?? 0);

      if (!isDesktop()) {
        announced.current = new Set(incoming.map((n) => n.id));
        return;
      }

      if (announced.current === null) {
        announced.current = new Set(incoming.map((n) => n.id));
        return;
      }

      const fresh = incoming.filter((n) => !announced.current!.has(n.id));
      for (const n of fresh) announced.current!.add(n.id);
      // Sequentially, and after the set is updated: a burst of parallel toasts
      // arrives unordered and can outrun the Windows notification queue.
      for (const n of fresh) {
        void showNativeNotification(n.type);
      }
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
    if (!isDesktop()) return;
    void notificationsPermitted().then(setNativeNotificationsEnabled);
  }, []);

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
    if (n.type === "RETENTION_NOTIFICATION") {
      router.push("/retention");
      return;
    }
    // `/reading/[studyUid]` is keyed by the DICOM StudyInstanceUID. The
    // notification's own `studyId` is the internal Study primary key and would
    // 404, so the routable UID projected by the API is used instead.
    const studyUid = n.study?.studyInstanceUid;
    if (studyUid) {
      router.push(`/reading/${encodeURIComponent(studyUid)}`);
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
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg">
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
            {isDesktop() && !nativeNotificationsEnabled && (
              <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
                <span className="text-xs text-text-muted">
                  {nativePermissionDenied
                    ? "Allow notifications in Windows settings."
                    : "Desktop notifications are off."}
                </span>
                {!nativePermissionDenied && (
                  <button
                    type="button"
                    onClick={async () => {
                      const granted = await requestNativeNotificationPermission();
                      setNativeNotificationsEnabled(granted);
                      setNativePermissionDenied(!granted);
                    }}
                    className="shrink-0 text-xs font-medium text-accent hover:text-accent/80"
                  >
                    Enable
                  </button>
                )}
              </div>
            )}
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-text-muted">
                No notifications
              </div>
            ) : (
              items.map((n) => {
                // Only study-linked notifications are navigable. Ones without a
                // resolvable StudyInstanceUID (e.g. the study was removed) stay
                // inert rather than presenting a clickable row that does
                // nothing.
                const clickable = !!n.study?.studyInstanceUid;
                const row = (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-text-primary">
                        {notificationTitle(n.type) ?? n.title}
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
                  </>
                );
                const className =
                  "flex w-full flex-col gap-0.5 border-b border-border px-3.5 py-2.5 text-left";
                return clickable ? (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openStudy(n)}
                    className={clsx(className, "transition-colors hover:bg-surface")}
                  >
                    {row}
                  </button>
                ) : (
                  <div
                    key={n.id}
                    className={clsx(className, "cursor-default opacity-80")}
                  >
                    {row}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
