"use client";

import { useEffect, useState } from "react";
import type { AuditAction, AuditLogEntry } from "@axis/types";
import { clsx } from "clsx";
import { Shield } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";

interface AuditEnvelope {
  data: AuditLogEntry[];
  meta?: { total: number; page: number; pageSize: number; totalPages: number };
}

const PAGE_SIZE = 50;

const ACTION_OPTIONS: { label: string; value: AuditAction | "ALL" }[] = [
  { label: "All Actions", value: "ALL" },
  { label: "Login", value: "LOGIN" },
  { label: "Study Viewed", value: "STUDY_VIEWED" },
  { label: "Study Downloaded", value: "STUDY_DOWNLOADED" },
  { label: "Study Assigned", value: "STUDY_ASSIGNED" },
  { label: "Report Created", value: "REPORT_CREATED" },
  { label: "Report Edited", value: "REPORT_EDITED" },
  { label: "Report Signed", value: "REPORT_SIGNED" },
  { label: "Report Amended", value: "REPORT_AMENDED" },
  { label: "Report Verified", value: "REPORT_VERIFIED" },
  { label: "Report Released", value: "REPORT_RELEASED" },
  { label: "Report Revised", value: "REPORT_REVISED" },
  { label: "Critical Finding", value: "CRITICAL_FINDING_FLAGGED" },
  { label: "User Created", value: "USER_CREATED" },
  { label: "Routing Changed", value: "ROUTING_RULE_CHANGED" },
  { label: "Delivery Completed", value: "DELIVERY_COMPLETED" },
  { label: "Delivery Failed", value: "DELIVERY_FAILED" },
  { label: "Change Requested", value: "CHANGE_REQUESTED" },
  { label: "Study Reassigned", value: "STUDY_REASSIGNED" },
  { label: "SLA Config Changed", value: "SLA_CONFIG_CHANGED" },
  { label: "Backup Started", value: "BACKUP_STARTED" },
  { label: "Backup Completed", value: "BACKUP_COMPLETED" },
  { label: "Backup Failed", value: "BACKUP_FAILED" },
  { label: "Backup Verified", value: "BACKUP_VERIFIED" },
  { label: "Retention Preview", value: "RETENTION_PREVIEW" },
  { label: "Retention Executed", value: "RETENTION_EXECUTED" },
  { label: "Study Archived", value: "ARCHIVE_MARKED" },
];

const RESOURCE_OPTIONS: { label: string; value: string }[] = [
  { label: "All Resources", value: "ALL" },
  { label: "Study", value: "STUDY" },
  { label: "Report", value: "REPORT" },
  { label: "User", value: "USER" },
  { label: "Worklist", value: "WORKLIST" },
  { label: "Backup", value: "BACKUP" },
  { label: "Retention", value: "RETENTION" },
];

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ActionBadge({ action }: { action: AuditAction }) {
  const colorMap: Record<string, string> = {
    LOGIN: "text-text-muted",
    LOGOUT: "text-text-muted",
    STUDY_VIEWED: "text-accent",
    STUDY_DOWNLOADED: "text-accent",
    STUDY_ASSIGNED: "text-accent",
    STUDY_STATUS_CHANGED: "text-accent",
    REPORT_CREATED: "text-success",
    REPORT_EDITED: "text-warning",
    REPORT_SIGNED: "text-success",
    REPORT_AMENDED: "text-warning",
    REPORT_VERIFIED: "text-success",
    REPORT_REVISED: "text-accent",
    REPORT_RELEASED: "text-success",
    CRITICAL_FINDING_FLAGGED: "text-error",
    CRITICAL_FINDING_ACKNOWLEDGED: "text-success",
    USER_CREATED: "text-accent",
    USER_UPDATED: "text-accent",
    ROUTING_RULE_CHANGED: "text-warning",
    DELIVERY_ATTEMPTED: "text-accent",
    DELIVERY_FAILED: "text-error",
    DELIVERY_COMPLETED: "text-success",
    SLA_CONFIG_CHANGED: "text-warning",
    BACKUP_STARTED: "text-accent",
    BACKUP_COMPLETED: "text-success",
    BACKUP_FAILED: "text-error",
    BACKUP_VERIFIED: "text-success",
    RETENTION_PREVIEW: "text-accent",
    RETENTION_EXECUTED: "text-warning",
    ARCHIVE_MARKED: "text-warning",
  };

  return (
    <span className={clsx("text-xs font-medium", colorMap[action] ?? "text-text-muted")}>
      {action.replace(/_/g, " ")}
    </span>
  );
}

export default function AuditLogPage() {
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [resourceFilter, setResourceFilter] = useState<string>("ALL");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = async (targetPage = page) => {
    setIsLoading(true);
    setHasError(false);
    try {
      const params = new URLSearchParams();
      params.set("page", String(targetPage));
      params.set("pageSize", String(PAGE_SIZE));
      if (actionFilter !== "ALL") params.set("action", actionFilter);
      if (resourceFilter !== "ALL") params.set("resource", resourceFilter);
      if (roleFilter !== "ALL") params.set("actorRole", roleFilter);
      if (fromDate) params.set("from", new Date(fromDate).toISOString());
      if (toDate) params.set("to", new Date(`${toDate}T23:59:59`).toISOString());
      const res = await apiClient.get<AuditEnvelope>(`/audit?${params.toString()}`);
      setEntries(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
      setTotalPages(res.meta?.totalPages ?? 1);
    } catch (e) {
      console.error("Failed to load audit log", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    setPage(1);
    load(1);
  };

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load audit log"
        description="Unable to fetch audit entries."
        onRetry={() => load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Audit Log
        </h1>
        <p className="text-sm text-text-muted">
          Append-only record of system events (server-side filtered)
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        >
          {RESOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        >
          {["ALL", "ADMIN", "MANAGER", "RADIOLOGIST", "HOSPITAL"].map((r) => (
            <option key={r} value={r}>
              {r === "ALL" ? "All Roles" : r}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="From date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        />
        <span className="text-xs text-text-muted">to</span>
        <input
          type="date"
          aria-label="To date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        />
        <button
          onClick={applyFilters}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Apply
        </button>
      </div>

      <div className="rounded-md border border-border">
        <div className="grid grid-cols-[1fr_0.8fr_1.2fr_0.6fr_1.2fr_0.8fr] gap-4 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
          <div>Timestamp</div>
          <div>Actor</div>
          <div>Action</div>
          <div>Resource</div>
          <div>Resource ID</div>
          <div>IP</div>
        </div>

        {isLoading ? (
          <SkeletonTable rows={8} />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Shield size={32} className="mb-3 text-text-muted" />
            <p className="text-sm text-text-muted">No audit entries match your filter</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[1fr_0.8fr_1.2fr_0.6fr_1.2fr_0.8fr] gap-4 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-raised/50"
            >
              <span className="font-mono text-xs text-text-muted">
                {formatTimestamp(entry.timestamp)}
              </span>
              <div className="flex flex-col">
                <span className="text-sm text-text-primary">{entry.actorName}</span>
                <span className="text-xs text-text-muted">{entry.actorRole}</span>
              </div>
              <ActionBadge action={entry.action} />
              <span className="text-xs text-text-muted">{entry.resource}</span>
              <span className="font-mono text-xs text-text-muted truncate">
                {entry.resourceId}
              </span>
              <span className="font-mono text-xs text-text-muted">
                {entry.ipAddress ?? "--"}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{total} entries</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => {
              const p = page - 1;
              setPage(p);
              load(p);
            }}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => {
              const p = page + 1;
              setPage(p);
              load(p);
            }}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
