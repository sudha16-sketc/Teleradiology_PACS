"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiClient } from "@/lib/api-client";
import type { StudyStatus } from "@axis/types";

interface SignOffControlsProps {
  studyInstanceUid: string;
  status: StudyStatus;
  reportHasContent?: boolean;
  onChanged?: () => void;
}

export function SignOffControls({
  studyInstanceUid,
  status,
  reportHasContent = false,
  onChanged,
}: SignOffControlsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canSignOff =
    status === "REPORT_DRAFT" ||
    status === "CORRECTION_REQUESTED" ||
    status === "IN_READING";

  const canMarkDelivered =
    status === "MANAGER_APPROVED" ||
    status === "DELIVERED_TO_HOSPITAL" ||
    status === "HOSPITAL_REVIEW";

  const handleSignOff = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setConfirmOpen(false);
    try {
      // Server derives signer identity from session; no signedOffBy in body.
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/sign`,
        {},
      );
      setNotice("Report signed successfully.");
      onChanged?.();
    } catch (e) {
      setNotice(
        (e as { message?: string }).message ?? "Sign-off failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleMarkDelivered = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/deliver`,
      );
      setNotice("Study marked as delivered.");
      onChanged?.();
    } catch (e) {
      setNotice(
        (e as { message?: string }).message ?? "Failed to mark delivered.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Sign Off
      </button>
      {isOpen && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Study Status:</span>
            <StatusBadge status={status} />
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy || !canSignOff}
              onClick={() => setConfirmOpen(true)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={14} className="inline animate-spin" />
              ) : null}{" "}
              Sign Report
            </button>
            <button
              type="button"
              disabled={busy || !canMarkDelivered}
              onClick={() => void handleMarkDelivered()}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
            >
              Mark Delivered
            </button>
          </div>

          {notice && <p className="text-xs text-text-muted">{notice}</p>}
        </div>
      )}

      {/* --- Confirmation Dialog --- */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-full bg-warning/10 p-2">
                <AlertTriangle size={18} className="text-warning" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-text-primary">
                  Confirm Sign-Off
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  This action is <strong>irreversible</strong>. The report will
                  be locked and submitted for manager review. You will not be
                  able to edit it afterwards.
                </p>
                {!reportHasContent && (
                  <p className="mt-2 text-xs text-error">
                    Warning: the report may be missing required fields (findings,
                    impression).
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSignOff()}
                disabled={busy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={14} className="inline animate-spin" />
                ) : null}{" "}
                Confirm Sign-Off
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
