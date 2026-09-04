"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import type { ChangeRequest } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatDateTime } from "@/lib/format";
import { useAppStore } from "@/lib/store";

interface CorrectionsEnvelope {
  data: ChangeRequest[];
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  APPROVED: "Approved",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-warning/10 text-warning",
  ACKNOWLEDGED: "bg-warning/10 text-warning",
  APPROVED: "bg-accent/10 text-accent",
  IN_PROGRESS: "bg-accent/10 text-accent",
  RESOLVED: "bg-success/10 text-success",
  REJECTED: "bg-error/10 text-error",
  CANCELLED: "bg-surface text-text-muted",
};

export default function CorrectionsPage() {
  const router = useRouter();
  const currentUser = useAppStore((s) => s.currentUser);
  const isReviewer =
    currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";

  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejections, setRejections] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<CorrectionsEnvelope>("/corrections");
      setItems(res.data ?? []);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Unable to load corrections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setNotice(null);
    try {
      await apiClient.post(`/corrections/${id}/approve`);
      setNotice("Correction approved.");
      await load();
    } catch (e) {
      setNotice((e as { message?: string }).message ?? "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    if (busy) return;
    const resolution = (rejections[id] ?? "").trim();
    if (!resolution) {
      setNotice("Please provide a resolution to reject the request.");
      return;
    }
    setBusy(id);
    setNotice(null);
    try {
      await apiClient.post(`/corrections/${id}/reject`, { resolution });
      setNotice("Correction rejected.");
      await load();
    } catch (e) {
      setNotice((e as { message?: string }).message ?? "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <ErrorState
        title="Unable to load corrections"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-text-primary">
            Corrections
          </h1>
          <p className="text-sm text-text-muted">
            Corrected reports create a new immutable version through the normal
            review and delivery workflow.
          </p>
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-text-primary">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 size={14} className="animate-spin" /> Loading corrections…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-border bg-surface p-8 text-center text-sm text-text-muted">
          No correction requests found.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((cr) => (
            <div
              key={cr.id}
              className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    cr.study?.studyInstanceUid &&
                    router.push(`/reading/${cr.study.studyInstanceUid}`)
                  }
                  className="text-left"
                >
                  <div className="text-sm font-semibold text-text-primary hover:underline">
                    {cr.study?.patient?.displayName ?? "Patient"} ·{" "}
                    {cr.study?.accessionNumber ?? ""}
                  </div>
                  <div className="text-xs text-text-muted">
                    {cr.study?.modality ?? ""} · Requested{" "}
                    {formatDateTime(cr.createdAt)} by{" "}
                    {cr.requestedBy?.displayName ?? cr.requestedByRole}
                  </div>
                </button>
                <span
                  className={
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none " +
                    (STATUS_STYLES[cr.status] ?? "")
                  }
                >
                  {STATUS_LABELS[cr.status] ?? cr.status}
                </span>
              </div>

              <div className="text-sm text-text-primary">{cr.reason}</div>

              {cr.resolution && (
                <div className="rounded-md border border-border bg-surface-raised/40 px-3 py-2 text-xs text-text-muted">
                  <span className="font-medium">Resolution:</span>{" "}
                  {cr.resolution}
                </div>
              )}

              {isReviewer && (cr.status === "OPEN" || cr.status === "ACKNOWLEDGED") && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <textarea
                    value={rejections[cr.id] ?? ""}
                    onChange={(e) =>
                      setRejections((prev) => ({
                        ...prev,
                        [cr.id]: e.target.value,
                      }))
                    }
                    placeholder="Resolution (required to reject)…"
                    rows={2}
                    className="w-full resize-none rounded-md border border-border/60 bg-white/70 p-2 text-sm text-text-primary placeholder-text-muted/50 focus:border-accent focus:outline-none"
                  />
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => approve(cr.id)}
                      className="flex items-center justify-center gap-1.5 rounded-md bg-success px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === cr.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => reject(cr.id)}
                      className="flex items-center justify-center gap-1.5 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm font-medium text-error transition-colors hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === cr.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <X size={14} />
                      )}
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
