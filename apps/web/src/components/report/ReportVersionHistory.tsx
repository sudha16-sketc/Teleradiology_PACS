"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import type { ReportStatus } from "@axis/types";
import { formatDateTime } from "@/lib/format";

interface VersionEntry {
  version: number;
  status: ReportStatus;
  author: string;
  date: string;
  contentHash: string;
}

interface ReportVersionHistoryProps {
  versions?: VersionEntry[];
}

const STATUS_STYLES: Record<ReportStatus, string> = {
  DRAFT: "bg-surface text-text-muted",
  SIGNED: "bg-accent/10 text-accent",
  MANAGER_REVIEW: "bg-warning/10 text-warning",
  MANAGER_APPROVED: "bg-success/10 text-success",
  HOSPITAL_REVIEW: "bg-warning/10 text-warning",
  CORRECTION_REQUESTED: "bg-error/10 text-error",
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: "Draft",
  SIGNED: "Signed",
  MANAGER_REVIEW: "Manager Review",
  MANAGER_APPROVED: "Approved",
  HOSPITAL_REVIEW: "Hospital Review",
  CORRECTION_REQUESTED: "Correction Requested",
};

export function ReportVersionHistory({ versions = [] }: ReportVersionHistoryProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-surface-raised/50"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Version History
      </button>
      {expanded && (
        <div className="border-t border-border">
          {versions.length === 0 ? (
            <div className="px-4 py-4 text-xs text-text-muted">
              No version history available for this report.
            </div>
          ) : (
            versions.map((v) => (
              <div
                key={v.version}
                className="flex items-center justify-between border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      v{v.version}
                    </span>
                    <span
                      className={clsx(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
                        STATUS_STYLES[v.status],
                      )}
                    >
                      {STATUS_LABELS[v.status]}
                    </span>
                  </div>
                  <span className="text-xs text-text-muted">{v.author}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-xs text-text-muted">
                    {formatDateTime(v.date)}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">
                    {v.contentHash}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
