"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Download, CheckCircle2, X, AlertTriangle } from "lucide-react";
import { clsx } from "clsx";
import {
  checkForUpdates,
  currentUpdateState,
  installAvailableUpdate,
  subscribeToUpdates,
  type UpdateState,
  type UpdateStatus,
} from "@/lib/update";
import { isDesktop } from "@/lib/platform";

/**
 * Update status for the desktop client.
 *
 * # Why it says nothing by default
 *
 * The committed configuration is inert — no endpoint, no key — so most builds
 * will never check. This renders as nothing at all in that case, because a
 * permanent "Updates unavailable" badge is a permanent nag about a feature the
 * operator never enabled. Only a real finding gets real estate.
 *
 * The client never prompts on its own and never restarts the app. Reinstalling
 * mid-read is not acceptable in a clinical session, so the user chooses both
 * whether to update and when to restart.
 */
export function UpdateStatus() {
  const [state, setState] = useState<UpdateState>(currentUpdateState());
  const [busy, setBusy] = useState(false);
  /**
   * Statuses the user has explicitly dismissed.
   *
   * Keyed by status so each banner is dismissible once: dismissing "an update is
   * available" must not suppress the far more important "restart to finish",
   * which arrives later in a different state.
   */
  const [dismissed, setDismissed] = useState<Set<UpdateStatus>>(new Set());

  const dismiss = (status: UpdateStatus) => {
    setDismissed((prev) => new Set(prev).add(status));
  };

  useEffect(() => subscribeToUpdates(setState), []);

  // Only ever worth showing on the desktop client; a browser tab cannot install
  // anything.
  const relevant: UpdateStatus[] = [
    "available",
    "readyToInstall",
    "installed",
    "error",
  ];
  const visible =
    isDesktop() && relevant.includes(state.status) && !dismissed.has(state.status);

  if (!visible) return null;

  if (state.status === "available") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm">
        <Download size={15} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-text-primary">
          Axis {state.version} is available
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void installAvailableUpdate().finally(() => setBusy(false));
          }}
          className="shrink-0 rounded bg-accent px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <RefreshCw size={12} className="animate-spin" /> : "Install"}
        </button>
        <button
          type="button"
          onClick={() => dismiss("available")}
          className="shrink-0 text-text-muted hover:text-text-primary"
          aria-label="Dismiss update notice"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (state.status === "downloading") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary">
        <RefreshCw size={15} className="shrink-0 animate-spin text-accent" />
        <span className="flex-1">
          Downloading Axis {state.version}… {state.progress ?? 0}%
        </span>
      </div>
    );
  }

  if (state.status === "readyToInstall" || state.status === "installed") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-sm">
        <CheckCircle2 size={15} className="shrink-0 text-success" />
        <span className="min-w-0 flex-1 text-text-primary">
          Axis {state.version} is installed. Restart Axis to finish the update.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 text-text-primary">
        {state.reason ?? "The update check could not be completed."}
      </span>
    </div>
  );
}

/**
 * Check for an update once, at startup, after a short delay.
 *
 * A manual action inside {@link UpdateStatus}, or wherever a deployment puts its
 * "Check for updates" control. Deliberately not mounted by default: an automatic
 * check on every launch is a network call the operator did not ask for, and on a
 * workstation on a hospital network that is a decision, not a detail.
 */
export function useUpdateCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !isDesktop()) return;
    // Delay so a slow deployment does not compete with the first paint.
    const timer = setTimeout(() => void checkForUpdates(), 5_000);
    return () => clearTimeout(timer);
  }, [enabled]);
}

/** Compact control for a settings or help surface. */
export function UpdateCheckButton({ className }: { className?: string }) {
  const [state, setState] = useState<UpdateState>(currentUpdateState());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeToUpdates(setState), []);

  if (!isDesktop()) return null;

  const label =
    state.status === "unavailable"
      ? "Updates not configured"
      : state.status === "upToDate"
        ? "Axis is up to date"
        : state.status === "checking"
          ? "Checking for updates"
          : "Check for updates";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void checkForUpdates().finally(() => setBusy(false));
      }}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:opacity-50",
        className,
      )}
    >
      <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
