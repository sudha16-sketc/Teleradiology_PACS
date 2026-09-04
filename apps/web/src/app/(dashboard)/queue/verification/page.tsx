"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Study } from "@axis/types";
import { Search, RefreshCw } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/format";

interface StudyEnvelope {
  data: Study[];
  meta?: { total: number };
}

export default function PendingVerificationPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const isReviewer = currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const [search, setSearch] = useState("");
  const [studies, setStudies] = useState<Study[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<StudyEnvelope>("/studies", {
        params: { status: "RADIOLOGIST_SIGNED", pageSize: "200" },
      });
      setStudies(res.data ?? []);
    } catch (e) {
      console.error("Failed to load pending verifications", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search) return studies;
    const q = search.toLowerCase();
    return studies.filter(
      (s) =>
        s.patient?.displayName?.toLowerCase().includes(q) ||
        s.accessionNumber?.toLowerCase().includes(q) ||
        s.studyDescription?.toLowerCase().includes(q) ||
        s.hospital?.name?.toLowerCase().includes(q),
    );
  }, [studies, search]);

  if (!isReviewer) {
    return (
      <EmptyState
        title="Access restricted"
        description="Pending Verification is only available to administrators and managers."
      />
    );
  }

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load pending verifications"
        description="Unable to fetch studies pending verification. Please try again."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            Pending Verification
          </h1>
          <p className="text-sm text-text-muted">
            Studies awaiting review before release to hospital
          </p>
        </div>
        <button
          onClick={() => void load()}
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
            placeholder="Search patient, accession, study..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-surface pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <span className="text-xs text-text-muted">
          {filtered.length} {filtered.length === 1 ? "study" : "studies"} pending
        </span>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No pending verifications"
          description="All signed reports have been reviewed. New reports awaiting verification will appear here."
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
                  <th className="px-4 py-2.5 font-medium">Hospital</th>
                  <th className="px-4 py-2.5 font-medium">Radiologist</th>
                  <th className="px-4 py-2.5 font-medium">Signed At</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.studyInstanceUid}
                    className="border-b border-border last:border-b-0 hover:bg-surface-raised/50"
                  >
                    <td className="px-4 py-2.5 font-medium text-text-primary">
                      {s.patient?.displayName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {s.studyDescription || "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                      {s.accessionNumber}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {s.modality}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {s.hospital?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {s.assignedRadiologist?.displayName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {s.signedOffAt ? formatDateTime(s.signedOffAt) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/reading/${s.studyInstanceUid}`}
                        className="rounded bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20"
                      >
                        Review
                      </Link>
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
