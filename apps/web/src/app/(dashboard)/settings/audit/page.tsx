"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditLogEntry } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/Skeleton";

const ACTION_TYPES = [
  "LOGIN", "LOGOUT", "STUDY_VIEWED", "STUDY_DOWNLOADED", "STUDY_ASSIGNED",
  "REPORT_CREATED", "REPORT_SIGNED", "REPORT_FINALIZED",
  "CRITICAL_FINDING_FLAGGED", "ROUTING_RULE_CHANGED", "USER_CREATED",
  "DELIVERY_ATTEMPTED",
];

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Login",
  LOGOUT: "Logout",
  STUDY_VIEWED: "Study Viewed",
  STUDY_DOWNLOADED: "Study Downloaded",
  STUDY_ASSIGNED: "Study Assigned",
  REPORT_CREATED: "Report Created",
  REPORT_SIGNED: "Report Signed",
  REPORT_FINALIZED: "Report Finalized",
  CRITICAL_FINDING_FLAGGED: "Critical Finding Flagged",
  ROUTING_RULE_CHANGED: "Routing Rule Changed",
  USER_CREATED: "User Created",
  DELIVERY_ATTEMPTED: "Delivery Attempted",
};

export default function AuditPage() {
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<{
        data: AuditLogEntry[];
        meta?: { total: number };
      }>("/audit");
      setEntries(res.data ?? []);
    } catch (e) {
      console.error("Failed to load audit log", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      actionFilter === "ALL"
        ? entries
        : entries.filter((e) => e.action === actionFilter),
    [entries, actionFilter],
  );

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load audit log"
        description="Unable to fetch the audit log. Please check your connection and try again."
        onRetry={() => load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-xl font-bold text-text-primary">
        Audit Log
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
        >
          <option value="ALL">All Actions</option>
          {ACTION_TYPES.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a] ?? a}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No audit entries"
          description="Audit log entries will appear here as users take actions."
        />
      ) : (
        <div className="rounded-md border border-border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Actor
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Action
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Resource
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Resource ID
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-muted">
                      {formatDateTime(entry.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {entry.actorName}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-surface-raised px-2 py-0.5 text-xs font-medium text-text-muted">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {entry.resource}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">
                      {entry.resourceId}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {entry.actorRole}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
