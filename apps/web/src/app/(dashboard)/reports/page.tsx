"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Report } from "@axis/types";
import { Search, FileText, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ReportStatusBadge } from "@/components/ui/ReportStatusBadge";
import { formatDate } from "@/lib/format";

const REPORT_STATUS_FILTERS = [
  { label: "Draft", value: "DRAFT" },
  { label: "Signed", value: "SIGNED" },
  { label: "Manager Review", value: "MANAGER_REVIEW" },
  { label: "Approved", value: "MANAGER_APPROVED" },
  { label: "Hospital Review", value: "HOSPITAL_REVIEW" },
  { label: "Correction Requested", value: "CORRECTION_REQUESTED" },
] as const;

export default function ReportsPage() {
  const currentUser = useAppStore((state) => state.currentUser);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [deliveringUid, setDeliveringUid] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<{ data: Report[] }>("/reports");
      setReports(res.data ?? []);
    } catch (e) {
      console.error("Failed to load reports", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deliverReport(report: Report) {
    const studyUid = report.study?.studyInstanceUid ?? "";
    if (!studyUid || deliveringUid) return;
    if (
      !window.confirm(
        "Deliver this signed report to the hospital that submitted the study?",
      )
    ) {
      return;
    }
    setDeliveringUid(studyUid);
    setNotice(null);
    try {
      await apiClient.post(`/studies/${encodeURIComponent(studyUid)}/deliver`);
      setNotice({ kind: "success", text: "Report delivered to the originating hospital." });
      await load();
    } catch (err) {
      setNotice({
        kind: "error",
        text: (err as { message?: string }).message ?? "Report delivery failed.",
      });
    } finally {
      setDeliveringUid(null);
    }
  }

  const canDeliverRole =
    currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";

  const filteredReports = useMemo(() => {
    let list = [...reports];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.study?.patient?.displayName?.toLowerCase().includes(q) ||
          r.study?.accessionNumber?.toLowerCase().includes(q) ||
          r.study?.studyDescription?.toLowerCase().includes(q) ||
          r.author?.displayName?.toLowerCase().includes(q),
      );
    }

    if (statusFilter) {
      list = list.filter((r) => r.status === statusFilter);
    }

    return list;
  }, [reports, searchQuery, statusFilter]);

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load reports"
        description="Unable to fetch reports. Please check your connection and try again."
        onRetry={() => load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            Reports
          </h1>
          <p className="text-sm text-text-muted">
            {filteredReports.length}{" "}
            {filteredReports.length === 1 ? "report" : "reports"}
          </p>
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-md border px-3 py-2 text-sm ${
            notice.kind === "error"
              ? "border-error/30 bg-error/10 text-error"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder="Search patient, accession, author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none sm:w-auto"
        >
          <option value="">All Statuses</option>
          {REPORT_STATUS_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : filteredReports.length === 0 ? (
        <EmptyState
          title="No reports found"
          description="Try adjusting your filters or search query."
        />
      ) : (
        <div className="overflow-x-auto">
        <div className="min-w-[1100px] rounded-md border border-border">
          <div className="grid grid-cols-[1fr_1.2fr_0.5fr_0.9fr_0.8fr_0.7fr_0.4fr_0.5fr_0.5fr] gap-4 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <div>Patient</div>
            <div>Study</div>
            <div>Modality</div>
            <div>Accession</div>
            <div>Status</div>
            <div>Author</div>
            <div>Version</div>
            <div>Signed Off</div>
            <div>View</div>
            <div>Actions</div>
          </div>

          {filteredReports.map((report) => {
            const studyUid = report.study?.studyInstanceUid ?? report.studyInstanceUid ?? "";
            const canDeliver =
              canDeliverRole &&
              report.status === "SIGNED" &&
              report.study?.status === "MANAGER_APPROVED" &&
              Boolean(report.signedOffAt) &&
              Boolean(report.study?.studyInstanceUid);
            return (
              <div
                key={report.id}
                className="grid grid-cols-[1fr_1.2fr_0.5fr_0.9fr_0.8fr_0.7fr_0.4fr_0.5fr_0.5fr] items-center gap-4 border-b border-border px-4 py-3 transition-colors hover:bg-surface-raised/50"
              >
                <div className="flex flex-col">
                  <Link
                    href={`/reports/${studyUid}`}
                    className="text-sm font-medium text-text-primary hover:text-accent hover:underline"
                  >
                    {report.study?.patient?.displayName ?? "—"}
                  </Link>
                  <span className="font-mono text-xs text-text-muted">
                    {report.study?.patient?.patientId ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm text-text-primary">
                    {report.study?.studyDescription ?? "—"}
                  </span>
                  <span className="text-xs text-text-muted">
                    {report.study?.bodyPart ?? ""}
                  </span>
                </div>
                <span className="text-sm text-text-muted">
                  {report.study?.modality ?? "—"}
                </span>
                <span className="font-mono text-xs text-text-muted">
                  {report.study?.accessionNumber ?? "—"}
                </span>
                <div>
                  <ReportStatusBadge status={report.status} />
                </div>
                <span className="text-sm text-text-muted">
                  {report.author?.displayName ?? "—"}
                </span>
                <span className="font-mono text-xs text-text-muted">
                  v{report.version}
                </span>
                <span className="text-sm text-text-muted">
                  {report.signedOffAt ? formatDate(report.signedOffAt) : "—"}
                </span>
                <Link
                  href={`/reports/${studyUid}`}
                  aria-label={`Open report for ${report.study?.patient?.displayName ?? "patient"}`}
                  className="text-accent transition-colors hover:text-accent/80"
                >
                  <FileText size={16} />
                </Link>
                <div>
                  {canDeliver && (
                    <button
                      type="button"
                      onClick={() => void deliverReport(report)}
                      disabled={deliveringUid !== null}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-background transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deliveringUid === report.study?.studyInstanceUid ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Send size={12} />
                      )}
                      Deliver
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>Click a patient name or the report icon to open a report</span>
        <span>
          {filteredReports.length} of {reports.length} reports
        </span>
      </div>
    </div>
  );
}
