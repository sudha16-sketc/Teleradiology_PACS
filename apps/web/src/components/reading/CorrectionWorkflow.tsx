"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Play, RefreshCw } from "lucide-react";
import type { ChangeRequest } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

interface CorrectionsEnvelope {
  data: ChangeRequest[];
}

interface CorrectionWorkflowProps {
  studyInstanceUid: string;
  status: string;
  onChanged?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Pending manager approval",
  ACKNOWLEDGED: "Pending manager approval",
  APPROVED: "Approved — ready to start",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function CorrectionWorkflow({
  studyInstanceUid,
  status,
  onChanged,
}: CorrectionWorkflowProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [corrections, setCorrections] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<CorrectionsEnvelope>("/corrections");
      const mine = (res.data ?? []).filter(
        (c) => c.study?.studyInstanceUid === studyInstanceUid,
      );
      setCorrections(mine);
    } catch {
      setCorrections([]);
    } finally {
      setLoading(false);
    }
  }, [studyInstanceUid]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = corrections[0] ?? null;
  const isApproved = latest?.status === "APPROVED";

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await apiClient.post(
        `/studies/${encodeURIComponent(studyInstanceUid)}/corrections/begin`,
      );
      setNotice("Corrected report draft created. Edit and sign it below.");
      await load();
      onChanged?.();
    } catch (e) {
      setNotice((e as { message?: string }).message ?? "Unable to start correction.");
    } finally {
      setBusy(false);
    }
  };

  if (!latest || status === "REPORT_DRAFT" || loading) {
    return null;
  }

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-warning transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Correction
      </button>
      {isOpen && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
            <RefreshCw size={14} className="text-warning" />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-text-primary">
                {STATUS_LABELS[latest.status] ?? latest.status}
              </span>
              {latest.reason && (
                <span className="text-xs text-text-muted">{latest.reason}</span>
              )}
              <span className="text-[10px] text-text-muted">
                Requested {formatDateTime(latest.createdAt)} by{" "}
                {latest.requestedBy?.displayName ?? latest.requestedByRole}
              </span>
            </div>
          </div>

          {isApproved && (
            <button
              type="button"
              disabled={busy}
              onClick={begin}
              className="flex items-center justify-center gap-2 rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Start Correction
            </button>
          )}

          {notice && <p className="text-xs text-text-muted">{notice}</p>}
        </div>
      )}
    </div>
  );
}
