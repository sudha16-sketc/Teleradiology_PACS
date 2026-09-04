"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { StudyStatus } from "@axis/types";

interface ReviewActionsProps {
  studyInstanceUid: string;
  status: StudyStatus;
  onChanged?: () => void;
}

export function ReviewActions({
  studyInstanceUid,
  status,
  onChanged,
}: ReviewActionsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  // Exact-state gating for the Phase 5 review / delivery lifecycle. Each action
  // is only offered when the study is precisely in the required source state;
  // the server independently enforces actors + prerequisites.
  const canReview = status === "RADIOLOGIST_SIGNED";
  const canApprove = status === "MANAGER_REVIEW";
  const canDeliver = status === "MANAGER_APPROVED";
  const canRequestChange =
    status === "RADIOLOGIST_SIGNED" || status === "MANAGER_REVIEW" || status === "MANAGER_APPROVED";

  const run = async (
    action: "review" | "approve" | "deliver" | "change-request",
  ) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (action === "change-request") {
        if (!reason.trim()) {
          setNotice("Please provide a reason for the change request.");
          setBusy(false);
          return;
        }
        await apiClient.post(
          `/reports/${encodeURIComponent(studyInstanceUid)}/change-request`,
          { reason: reason.trim() },
        );
        setNotice("Change requested.");
      } else {
        await apiClient.post(
          `/studies/${encodeURIComponent(studyInstanceUid)}/${action}`,
        );
        setNotice(
          action === "review"
            ? "Report sent for manager review."
            : action === "approve"
              ? "Report approved."
              : "Report delivered to hospital.",
        );
      }
      setReason("");
      onChanged?.();
    } catch (e) {
      setNotice((e as { message?: string }).message ?? "Action failed.");
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
        Review & Delivery
      </button>
      {isOpen && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy || !canReview}
              onClick={() => run("review")}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="inline animate-spin" /> : null}{" "}
              Begin Manager Review
            </button>
            <button
              type="button"
              disabled={busy || !canApprove}
              onClick={() => run("approve")}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="inline animate-spin" /> : null}{" "}
              Approve Report
            </button>
            <button
              type="button"
              disabled={busy || !canDeliver}
              onClick={() => run("deliver")}
              className="rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="inline animate-spin" /> : null}{" "}
              Deliver to Hospital
            </button>
          </div>

          {canRequestChange && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-2">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for change request..."
                className="w-full resize-none rounded-md border border-border/60 bg-white/70 p-2 text-sm text-text-primary placeholder-text-muted/50 focus:border-accent focus:outline-none"
                rows={2}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => run("change-request")}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                Request Change
              </button>
            </div>
          )}

          {notice && <p className="text-xs text-text-muted">{notice}</p>}
        </div>
      )}
    </div>
  );
}
