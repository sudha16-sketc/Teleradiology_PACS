"use client";

import { useEffect, useState } from "react";
import type { AuditAction, AuditLogEntry } from "@axis/types";
import { clsx } from "clsx";
import { Shield, Search } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";

interface AuditEnvelope {
  data: AuditLogEntry[];
}

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
  { label: "Critical Finding", value: "CRITICAL_FINDING_FLAGGED" },
  { label: "User Created", value: "USER_CREATED" },
  { label: "Routing Changed", value: "ROUTING_RULE_CHANGED" },
  { label: "Delivery Completed", value: "DELIVERY_COMPLETED" },
  { label: "Delivery Failed", value: "DELIVERY_FAILED" },
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
    REPORT_FINALIZED: "text-success",
    CRITICAL_FINDING_FLAGGED: "text-error",
    CRITICAL_FINDING_ACKNOWLEDGED: "text-success",
    USER_CREATED: "text-accent",
    USER_UPDATED: "text-accent",
    ROUTING_RULE_CHANGED: "text-warning",
    DELIVERY_ATTEMPTED: "text-accent",
    DELIVERY_FAILED: "text-error",
    DELIVERY_COMPLETED: "text-success",
  };

  return (
    <span className={clsx("text-xs font-medium", colorMap[action] ?? "text-text-muted")}>
      {action.replace(/_/g, " ")}
    </span>
  );
}

export default function AuditLogPage() {
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<AuditEnvelope>("/audit");
      setEntries(res.data ?? []);
    } catch (e) {
      console.error("Failed to load audit log", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = entries.filter((entry) => {
    if (actionFilter !== "ALL" && entry.action !== actionFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        entry.actorName.toLowerCase().includes(q) ||
        entry.resourceId.toLowerCase().includes(q) ||
        entry.action.toLowerCase().includes(q)
      );
    }
    return true;
  });

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
          Append-only record of system events
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder="Search actor, resource, action..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none"
          />
        </div>
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
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Shield size={32} className="mb-3 text-text-muted" />
            <p className="text-sm text-text-muted">No audit entries match your filter</p>
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[1fr_0.8fr_1.2fr_0.6fr_1.2fr_0.8fr] gap-4 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-raised/50"
            >
              <span className="font-mono text-xs text-text-muted">
                {formatTimestamp(entry.timestamp)}
              </span>
              <div className="flex flex-col">
                <span className="text-sm text-text-primary">
                  {entry.actorName}
                </span>
                <span className="text-xs text-text-muted">
                  {entry.actorRole}
                </span>
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

      <div className="text-xs text-text-muted">
        {filtered.length} entries
      </div>
    </div>
  );
}
