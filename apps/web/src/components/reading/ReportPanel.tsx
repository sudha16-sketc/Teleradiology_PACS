"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Printer,
} from "lucide-react";
import { clsx } from "clsx";
import type { Report, ReportStatus, ReportVersion } from "@axis/types";
import { apiClient, failureOf } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { formatDateTime } from "@/lib/format";

interface ReportPanelProps {
  studyInstanceUid: string;
  report: Report | null;
  assignedRadiologistId?: string | null;
}

const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  DRAFT: "bg-surface text-text-muted",
  SIGNED: "bg-accent/10 text-accent",
  MANAGER_REVIEW: "bg-warning/10 text-warning",
  MANAGER_APPROVED: "bg-success/10 text-success",
  HOSPITAL_REVIEW: "bg-warning/10 text-warning",
  CORRECTION_REQUESTED: "bg-error/10 text-error",
};

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: "Draft",
  SIGNED: "Signed",
  MANAGER_REVIEW: "Manager Review",
  MANAGER_APPROVED: "Approved",
  HOSPITAL_REVIEW: "Hospital Review",
  CORRECTION_REQUESTED: "Correction Requested",
};

const REPORT_SECTIONS = [
  ["Clinical History", "clinicalHistory"],
  ["Technique", "technique"],
  ["Comparison", "comparison"],
  ["Findings", "findings"],
  ["Impression", "impression"],
  ["Recommendations", "recommendations"],
] as const;

export function ReportPanel({
  studyInstanceUid,
  report,
  assignedRadiologistId,
}: ReportPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const currentUser = useAppStore((state) => state.currentUser);
  const canAuthor =
    currentUser?.role === "RADIOLOGIST" &&
    currentUser.id === assignedRadiologistId;

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Report
        {report && (
          <span
            className={clsx(
              "ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
              REPORT_STATUS_STYLES[report.status],
            )}
          >
            {REPORT_STATUS_LABELS[report.status]}
          </span>
        )}
      </button>

      {isOpen &&
        (report ? (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>v{report.version}</span>
              {report.author && (
                <span>
                  by {report.author.displayName ?? report.author.email}
                </span>
              )}
            </div>

            {report.criticalFinding && (
              <div className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2">
                <AlertCircle size={14} className="text-warning" />
                <span className="text-xs font-medium text-warning">
                  Critical Finding Flagged
                </span>
              </div>
            )}

            {REPORT_SECTIONS.map(([label, field]) => (
              <ReportSection
                key={field}
                label={label}
                value={report[field] ?? ""}
              />
            ))}

            {canAuthor && report.status !== "SIGNED" && (
              <Link
                href={`/reports/${encodeURIComponent(studyInstanceUid)}`}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
              >
                <FileText size={14} />
                Open full report editor
              </Link>
            )}

            <Link
              href={`/reports/print/${encodeURIComponent(studyInstanceUid)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-accent hover:underline"
            >
              <Printer size={13} />
              Preview / print saved report
            </Link>

            <ReportVersionHistoryInline studyInstanceUid={studyInstanceUid} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 py-6">
            <FileText size={32} strokeWidth={1} className="text-text-muted" />
            <p className="text-sm text-text-muted">No report yet</p>
            {canAuthor && (
              <Link
                href={`/reports/${encodeURIComponent(studyInstanceUid)}`}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
              >
                <FileText size={14} />
                Start Report
              </Link>
            )}
          </div>
        ))}
    </div>
  );
}

function ReportSection({ label, value }: { label: string; value: string }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </h3>
      <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-text-primary">
        {value || "—"}
      </p>
    </section>
  );
}

function ReportVersionHistoryInline({
  studyInstanceUid,
}: {
  studyInstanceUid: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [versions, setVersions] = useState<ReportVersion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiClient.get<{ data: ReportVersion[] }>(
        `/reports/${encodeURIComponent(studyInstanceUid)}/versions`,
      );
      setVersions(response.data ?? []);
      setLoaded(true);
    } catch (error: unknown) {
      setLoadError(failureOf(error).message);
    } finally {
      setLoading(false);
    }
  }, [loading, studyInstanceUid]);

  const toggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded && !loading) void load();
  }, [expanded, loaded, load, loading]);

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-raised/50"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Version History
      </button>
      {expanded && (
        <div className="border-t border-border">
          {loading ? (
            <p className="px-3 py-3 text-xs text-text-muted">Loading versions…</p>
          ) : loadError ? (
            <div className="flex items-center justify-between gap-2 px-3 py-3">
              <p className="text-xs text-error">{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="text-xs font-medium text-accent hover:underline"
              >
                Retry
              </button>
            </div>
          ) : versions.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-muted">
              {loaded ? "No version history available." : "Open to load versions."}
            </p>
          ) : (
            versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-text-primary">
                    v{version.version} · {version.status}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {version.author?.displayName ??
                      version.author?.email ??
                      "Unknown"}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] text-text-muted">
                    {formatDateTime(version.createdAt)}
                  </span>
                  <span className="font-mono text-[9px] text-text-muted">
                    {version.contentHash.slice(0, 12)}...
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
