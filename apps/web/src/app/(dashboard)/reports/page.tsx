"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Report } from "@axis/types";
import { Search, FileText } from "lucide-react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

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

      <div className="flex items-center gap-3">
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
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none"
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
        <div className="rounded-md border border-border">
          <div className="grid grid-cols-[1fr_1.2fr_0.5fr_0.9fr_0.8fr_0.7fr_0.4fr_0.5fr_0.4fr] gap-4 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <div>Patient</div>
            <div>Study</div>
            <div>Modality</div>
            <div>Accession</div>
            <div>Status</div>
            <div>Author</div>
            <div>Version</div>
            <div>Signed Off</div>
            <div>View</div>
          </div>

          {filteredReports.map((report) => {
            const studyUid = report.study?.studyInstanceUid ?? report.studyInstanceUid ?? "";
            return (
              <Link
                key={report.id}
                href={`/reports/${studyUid}`}
                className="grid grid-cols-[1fr_1.2fr_0.5fr_0.9fr_0.8fr_0.7fr_0.4fr_0.5fr_0.4fr] items-center gap-4 border-b border-border px-4 py-3 transition-colors hover:bg-surface-raised/50"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text-primary">
                    {report.study?.patient?.displayName ?? "—"}
                  </span>
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
                  <StatusBadge status={report.study?.status ?? "HOSPITAL_SUBMITTED"} />
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
                <span className="text-accent transition-colors hover:text-accent/80">
                  <FileText size={16} />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>Click a row to open report</span>
        <span>
          {filteredReports.length} of {reports.length} reports
        </span>
      </div>
    </div>
  );
}
