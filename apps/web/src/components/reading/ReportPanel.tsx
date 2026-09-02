"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { clsx } from "clsx";
import type { Report, ReportStatus } from "@axis/types";

interface ReportPanelProps {
  studyInstanceUid: string;
  report: Report | null;
}

const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  DRAFT: "bg-surface text-text-muted",
  PENDING_SIGNOFF: "bg-accent/10 text-accent",
  FINAL: "bg-success/10 text-success",
  AMENDED: "bg-warning/10 text-warning",
};

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: "Draft",
  PENDING_SIGNOFF: "Pending Sign-off",
  FINAL: "Final",
  AMENDED: "Amended",
};

export function ReportPanel({ studyInstanceUid, report }: ReportPanelProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Report
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {report ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
                    REPORT_STATUS_STYLES[report.status],
                  )}
                >
                  {REPORT_STATUS_LABELS[report.status]}
                </span>
                <span className="text-xs text-text-muted">
                  v{report.version}
                </span>
              </div>

              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Findings
                </h4>
                <p className="font-serif text-sm leading-relaxed text-text-primary">
                  {report.findings}
                </p>
              </div>

              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Impression
                </h4>
                <p className="font-serif text-sm leading-relaxed text-text-primary">
                  {report.impression}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6">
              <FileText size={32} strokeWidth={1} className="text-text-muted" />
              <p className="text-sm text-text-muted">No report yet</p>
              <Link
                href={`/reports/${studyInstanceUid}`}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
              >
                Create Report
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
