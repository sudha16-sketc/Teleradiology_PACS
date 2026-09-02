"use client";

import { useEffect, useMemo, useState } from "react";
import type { Report, StudyStatus } from "@axis/types";
import { Search, Download, Loader2, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { apiClient } from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";

interface HospitalReportsEnvelope {
  data: Report[];
}

export default function HospitalReportsPage() {
  const [search, setSearch] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<HospitalReportsEnvelope>("/reports/hospital");
      setReports(res.data ?? []);
    } catch (e) {
      console.error("Failed to load hospital reports", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!search) return reports;
    const q = search.toLowerCase();
    return reports.filter(
      (r) =>
        r.study?.patient?.displayName?.toLowerCase().includes(q) ||
        r.id?.toLowerCase().includes(q) ||
        r.study?.accessionNumber?.toLowerCase().includes(q),
    );
  }, [search, reports]);

  const downloadPdf = (studyUid: string, accessionNumber: string) => {
    const a = document.createElement("a");
    a.href = `/api/reports/hospital/${studyUid}/pdf`;
    a.download = `report-${accessionNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load reports"
        description="Unable to fetch finalized reports. Please try again."
        onRetry={() => load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            Reports Library
          </h1>
          <p className="text-sm text-text-muted">
            View and download finalized radiology reports
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder="Search patient or accession..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-surface pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No finalized reports"
          description="Finalized radiology reports for your hospital will appear here."
        />
      ) : (
        <div className="rounded-md border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Patient</th>
                  <th className="px-4 py-2.5 font-medium">Study</th>
                  <th className="px-4 py-2.5 font-medium">Accession</th>
                  <th className="px-4 py-2.5 font-medium">Modality</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Author</th>
                  <th className="px-4 py-2.5 font-medium">Signed Off</th>
                  <th className="px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border last:border-b-0 hover:bg-surface-raised/50"
                  >
                    <td className="px-4 py-2.5 font-medium text-text-primary">
                      {r.study?.patient?.displayName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {r.study?.studyDescription || "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                      {r.study?.accessionNumber}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {r.study?.modality}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        status={(r.study?.status ?? "FINAL") as StudyStatus}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {r.author?.displayName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {r.signedOffAt
                        ? new Date(r.signedOffAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() =>
                          downloadPdf(
                            r.study?.studyInstanceUid ?? "",
                            r.study?.accessionNumber ?? "",
                          )
                        }
                        className={clsx(
                          "flex items-center gap-1 rounded bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20",
                        )}
                      >
                        <Download size={12} />
                        Download PDF
                      </button>
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
