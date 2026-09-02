"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Study, StudyStatus } from "@axis/types";
import { Search, Filter } from "lucide-react";
import { clsx } from "clsx";
import { apiClient } from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { HospitalStudyTimeline } from "@/components/hospital/HospitalStudyTimeline";
import { formatDateTime } from "@/lib/format";

interface TimelineEvent {
  status: StudyStatus;
  timestamp: string;
  actor: string;
}

function buildTimeline(study: Study): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const submittedAt = study.receivedAt ?? study.createdAt;
  if (submittedAt) {
    events.push({
      status: "SUBMITTED",
      timestamp: submittedAt,
      actor: study.hospital?.name ?? "Hospital",
    });
  }

  if (study.assignedAt) {
    events.push({
      status: "ASSIGNED",
      timestamp: study.assignedAt,
      actor: study.assignedRadiologist?.displayName ?? "Coordinator",
    });
  }

  if (study.reportingStartedAt) {
    events.push({
      status: "IN_READING",
      timestamp: study.reportingStartedAt,
      actor: study.assignedRadiologist?.displayName ?? "Radiologist",
    });
  }

  if (study.finalizedAt) {
    events.push({
      status: "FINAL",
      timestamp: study.finalizedAt,
      actor: study.assignedRadiologist?.displayName ?? "Radiologist",
    });
  }

  if (events.length === 0) {
    events.push({
      status: "NEW",
      timestamp: study.createdAt,
      actor: study.hospital?.name ?? "Hospital",
    });
  }

  return events;
}

const ALL_STATUSES: StudyStatus[] = [
  "NEW",
  "VALIDATED",
  "UNASSIGNED",
  "ASSIGNED",
  "IN_READING",
  "FINAL",
  "AMENDED",
  "DELIVERED",
];

export default function HospitalTrackerPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StudyStatus | "ALL">("ALL");
  const [studies, setStudies] = useState<Study[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<{
        data: Study[];
        meta?: { total: number };
      }>("/studies");
      setStudies(res.data ?? []);
    } catch (e) {
      console.error("Failed to load studies", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeStudy = useMemo(() => {
    const active = [...studies]
      .filter((s) => s.status !== "CANCELLED")
      .sort(
        (a, b) =>
          new Date(b.receivedAt ?? b.createdAt).getTime() -
          new Date(a.receivedAt ?? a.createdAt).getTime(),
      );
    return active[0] ?? null;
  }, [studies]);

  const timeline = useMemo(
    () => (activeStudy ? buildTimeline(activeStudy) : []),
    [activeStudy],
  );

  const filtered = useMemo(() => {
    if (!studies.length) return [];
    const matching = [...studies].filter((s) => s.status !== "CANCELLED");
    const list = matching.filter((s) => {
      const matchesSearch =
        search === "" ||
        s.patient?.displayName?.toLowerCase().includes(search.toLowerCase()) ||
        s.accessionNumber?.toLowerCase().includes(search.toLowerCase()) ||
        s.studyDescription?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || s.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    return list;
  }, [studies, search, statusFilter]);

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load studies"
        description="Unable to fetch studies. Please check your connection and try again."
        onRetry={() => load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Study Tracker
        </h1>
        <p className="text-sm text-text-muted">
          Track the status of studies sent to reading
        </p>
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
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-text-muted" />
          <div className="flex gap-1">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={clsx(
                "rounded px-2 py-1 text-xs font-medium",
                statusFilter === "ALL"
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              All
            </button>
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={clsx(
                  "rounded px-2 py-1 text-xs font-medium",
                  statusFilter === s
                    ? "bg-accent/10 text-accent"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : !activeStudy ? (
        <EmptyState
          title="No active studies"
          description="Studies sent to reading will appear here once submitted."
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <div className="rounded-md border border-border bg-surface p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Most Recent Study
              </h2>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-text-primary">
                  {activeStudy.patient?.displayName ?? "—"}
                </span>
                <span className="font-mono text-xs text-text-muted">
                  {activeStudy.accessionNumber}
                </span>
                <span className="text-sm text-text-muted">
                  {activeStudy.studyDescription}
                </span>
                <span className="mt-1 text-sm text-text-muted">
                  {activeStudy.modality} · {activeStudy.bodyPart}
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge status={activeStudy.status} />
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border bg-surface p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Study Timeline
              </h2>
              <HospitalStudyTimeline
                events={timeline}
                currentStatus={activeStudy.status}
              />
            </div>
          </div>

          <div className="rounded-md border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-text-muted">
                    <th className="px-4 py-2.5 font-medium">Patient</th>
                    <th className="px-4 py-2.5 font-medium">Study</th>
                    <th className="px-4 py-2.5 font-medium">Modality</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Received</th>
                    <th className="px-4 py-2.5 font-medium">Last Updated</th>
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
                        {s.studyDescription}
                      </td>
                      <td className="px-4 py-2.5 text-text-muted">
                        {s.modality}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-2.5 text-text-muted">
                        {s.receivedAt
                          ? formatDateTime(s.receivedAt)
                          : s.createdAt
                            ? formatDateTime(s.createdAt)
                            : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-text-muted">
                        {formatDateTime(s.updatedAt)}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-text-muted"
                      >
                        No studies match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
