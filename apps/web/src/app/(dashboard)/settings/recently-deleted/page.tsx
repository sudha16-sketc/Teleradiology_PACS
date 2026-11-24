"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useAppStore } from "@/lib/store";

interface DeletedRecord {
  id: string;
  status: string;
  hospitalName: string;
  studyInstanceUid: string;
  accessionNumber: string;
  patientId: string;
  patientName: string;
  deletedByName: string;
  deletedAt: string;
  expiresAt: string;
  restoredAt: string | null;
  recordType: "STUDY";
}

interface DeletedResponse {
  data: DeletedRecord[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

const ARCHIVE_STATUSES = [
  "ARCHIVING",
  "ARCHIVED",
  "RESTORING",
  "RESTORED",
  "PURGING",
  "PURGE_FAILED",
  "PURGED",
  "FAILED",
];

export default function RecentlyDeletedPage() {
  const currentUser = useAppStore((state) => state.currentUser);
  const [patientId, setPatientId] = useState("");
  const [recordType, setRecordType] = useState("");
  const [deletedBy, setDeletedBy] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DeletedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      const response = await apiClient.get<DeletedResponse>("/manual-deletions", {
        params: {
          patientId: patientId || undefined,
          recordType: recordType || undefined,
          deletedBy: deletedBy || undefined,
          status: status || undefined,
          from: from || undefined,
          to: to || undefined,
          page,
          pageSize: 25,
        },
      });
      setResult(response);
    } catch (error) {
      console.error("Failed to load recently deleted records", error);
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, [deletedBy, from, page, patientId, recordType, status, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (item: DeletedRecord) => {
    if (
      !window.confirm(
        `Restore ${item.patientName} — ${item.accessionNumber}? The study and its archived relationships and DICOM files will be returned to active PACS access.`,
      )
    ) {
      return;
    }
    setWorkingId(item.id);
    setMessage(null);
    setErrorMessage(null);
    try {
      await apiClient.post(`/manual-deletions/${encodeURIComponent(item.id)}/restore`);
      setMessage(`${item.accessionNumber} was restored.`);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setWorkingId(null);
    }
  };

  const purge = async (item: DeletedRecord) => {
    if (
      !window.confirm(
        `Permanently purge ${item.patientName} — ${item.accessionNumber}? This deletes the S3 archive and cannot be undone.`,
      )
    ) {
      return;
    }
    const confirmation = window.prompt(`Type archive id ${item.id} to confirm permanent purge.`);
    if (confirmation !== item.id) return;

    setWorkingId(item.id);
    setMessage(null);
    setErrorMessage(null);
    try {
      await apiClient.post(`/manual-deletions/${encodeURIComponent(item.id)}/purge`, {
        confirmArchiveId: confirmation,
      });
      setMessage(`${item.accessionNumber} was permanently purged.`);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Purge failed.");
    } finally {
      setWorkingId(null);
    }
  };

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load Recently Deleted"
        description="Unable to load archived records. Please check your connection and try again."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-text-primary">
          Recently Deleted
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Recover deleted studies until their retention period expires. Permanent
          purge removes the recoverable archive from S3.
        </p>
      </div>

      {message && (
        <div role="status" className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {message}
        </div>
      )}
      {errorMessage && (
        <div role="alert" className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {errorMessage}
        </div>
      )}

      <div className="grid gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-medium text-text-muted">
          Patient ID
          <input
            value={patientId}
            onChange={(event) => {
              setPage(1);
              setPatientId(event.target.value);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
            placeholder="Search patient ID"
          />
        </label>
        <label className="text-xs font-medium text-text-muted">
          Record type
          <select
            value={recordType}
            onChange={(event) => {
              setPage(1);
              setRecordType(event.target.value);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All record types</option>
            <option value="STUDY">Study</option>
          </select>
        </label>
        <label className="text-xs font-medium text-text-muted">
          Deleted by
          <input
            value={deletedBy}
            onChange={(event) => {
              setPage(1);
              setDeletedBy(event.target.value);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
            placeholder="Name or user ID"
          />
        </label>
        <label className="text-xs font-medium text-text-muted">
          Archive status
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All statuses</option>
            {ARCHIVE_STATUSES.map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-text-muted">
          Deleted after
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setPage(1);
              setFrom(event.target.value);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
          />
        </label>
        <label className="text-xs font-medium text-text-muted">
          Deleted before
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setPage(1);
              setTo(event.target.value);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
          />
        </label>
      </div>

      {loading ? (
        <SkeletonTable rows={6} />
      ) : !result?.data.length ? (
        <EmptyState
          title="No deleted records found"
          description="Deleted studies will appear here while they remain recoverable."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[1050px]">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Patient ID</th>
                <th className="px-4 py-3">Deleted by</th>
                <th className="px-4 py-3">Deleted at</th>
                <th className="px-4 py-3">Status / expires</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((item) => {
                const canRestore =
                  item.status === "ARCHIVED" &&
                  new Date(item.expiresAt).getTime() > Date.now();
                const canPurge =
                  currentUser?.role === "ADMIN" &&
                  ["ARCHIVED", "PURGE_FAILED", "FAILED"].includes(item.status);
                return (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-text-primary">{item.patientName}</p>
                      <p className="font-mono text-xs text-text-muted">
                        {item.accessionNumber} · {item.studyInstanceUid}
                      </p>
                      <p className="text-xs text-text-muted">{item.hospitalName}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary">Study</td>
                    <td className="px-4 py-3 font-mono text-sm text-text-primary">{item.patientId}</td>
                    <td className="px-4 py-3 text-sm text-text-primary">{item.deletedByName}</td>
                    <td className="px-4 py-3 text-sm text-text-muted">{formatDateTime(item.deletedAt)}</td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      <div>{item.status.replace(/_/g, " ")}</div>
                      <div>Expires {formatDateTime(item.expiresAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {canRestore && (
                          <button
                            onClick={() => void restore(item)}
                            disabled={workingId === item.id}
                            className="flex items-center gap-1 rounded bg-accent/10 px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                          >
                            <RotateCcw size={13} />
                            Restore
                          </button>
                        )}
                        {canPurge && (
                          <button
                            onClick={() => void purge(item)}
                            disabled={workingId === item.id}
                            className="flex items-center gap-1 rounded bg-error/10 px-2 py-1.5 text-xs font-medium text-error hover:bg-error/20 disabled:opacity-50"
                          >
                            <Trash2 size={13} />
                            Purge
                          </button>
                        )}
                        {!canRestore && !canPurge && (
                          <span className="text-xs text-text-muted">No actions available</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-text-muted">
            <span>{result.meta.total} archives</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
                className="rounded border border-border px-2 py-1 disabled:opacity-50"
              >
                Previous
              </button>
              <span>Page {result.meta.page} of {Math.max(result.meta.totalPages, 1)}</span>
              <button
                onClick={() => setPage((value) => Math.min(result.meta.totalPages, value + 1))}
                disabled={page >= result.meta.totalPages}
                className="rounded border border-border px-2 py-1 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
