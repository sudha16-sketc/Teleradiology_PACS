"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, RefreshCw } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/ErrorState";
import type { RetentionNotificationView } from "@axis/types";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function RetentionReviewPage() {
  const [items, setItems] = useState<RetentionNotificationView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiClient.get<{ data: RetentionNotificationView[] }>(
        "/retention/notifications",
      );
      setItems(res.data ?? []);
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (id: string, response: "CANCEL" | "DELETE") => {
    const label = response === "CANCEL" ? "defer" : "archive";
    if (!window.confirm(`Confirm you want to ${label} this study?`)) return;
    setBusyId(id);
    setMessage(null);
    try {
      await apiClient.post(`/retention/notifications/${id}/respond`, {
        response,
      });
      setMessage(`Retention decision recorded: ${response}.`);
      await load();
    } catch (e) {
      console.error(e);
      setMessage("Could not record the decision. Check the notice status and try again.");
    } finally {
      setBusyId(null);
    }
  };

  if (error) {
    return (
      <ErrorState
        title="Failed to load retention notices"
        description="Check your permissions and try again."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            Retention Review
          </h1>
          <p className="text-sm text-text-muted">
            Respond to retention notices. CANCEL defers the study; DELETE archives it now.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {message && <p className="text-sm text-text-muted">{message}</p>}

      <section className="rounded-md border border-border p-5">
        <div className="mb-4 flex items-center gap-2">
          <Archive size={18} className="text-accent" />
          <h2 className="font-heading text-lg font-semibold text-text-primary">
            Notice queue
          </h2>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-text-muted">No retention notices are visible.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-surface-raised text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2">Study</th>
                  <th className="px-3 py-2">Hospital</th>
                  <th className="px-3 py-2">Notice</th>
                  <th className="px-3 py-2">Deadline</th>
                  <th className="px-3 py-2">Decision</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-border text-text-muted"
                  >
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-text-primary">
                        {item.accessionNumber}
                      </div>
                      <div className="max-w-[220px] truncate font-mono text-[11px]">
                        {item.studyInstanceUid}
                      </div>
                    </td>
                    <td className="px-3 py-2">{item.hospitalName}</td>
                    <td className="px-3 py-2">
                      <div>{item.deliveryStatus}</div>
                      <div className="text-[11px]">
                        sent {formatDate(item.sentAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {formatDate(item.responseDeadline)}
                      <div className="text-[11px]">
                        cancels {item.cancelCount} / ignored {item.ignoredCount}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {item.response ?? "Awaiting response"}
                      <div className="text-[11px]">{item.reportStatus}</div>
                    </td>
                    <td className="px-3 py-2">
                      {item.response ? (
                        <span className="text-xs text-text-muted">Recorded</span>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => void respond(item.id, "CANCEL")}
                            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
                          >
                            CANCEL
                          </button>
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => void respond(item.id, "DELETE")}
                            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                          >
                            DELETE
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
