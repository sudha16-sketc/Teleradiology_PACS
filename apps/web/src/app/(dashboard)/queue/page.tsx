"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { WorklistItem, StudyPriority } from "@axis/types";
import { Search } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PriorityBadge } from "@/components/ui/PriorityBadge";
import { AcuityPulse } from "@/components/ui/AcuityPulse";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";

const PRIORITY_ORDER: Record<StudyPriority, number> = {
  STAT: 0,
  URGENT: 1,
  ROUTINE: 2,
};

export default function MyQueuePage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState<WorklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const isRadiologist = currentUser?.role === "RADIOLOGIST";

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const endpoint = isRadiologist ? "/worklist/my" : "/worklist";
      const res = await apiClient.get<{ data: WorklistItem[] }>(endpoint);
      setItems(res.data ?? []);
    } catch (e) {
      console.error("Failed to load queue", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [isRadiologist]);

  useEffect(() => {
    load();
  }, [load]);

  const sortedQueue = useMemo(() => {
    let list = [...items];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (item) =>
          item.study?.patient?.displayName?.toLowerCase().includes(q) ||
          item.study?.accessionNumber?.toLowerCase().includes(q) ||
          item.study?.studyDescription?.toLowerCase().includes(q) ||
          item.study?.hospital?.name?.toLowerCase().includes(q),
      );
    }

    return list.sort(
      (a, b) =>
        PRIORITY_ORDER[a.study.priority] - PRIORITY_ORDER[b.study.priority],
    );
  }, [items, searchQuery]);

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load queue"
        description="Unable to fetch your queue. Please check your connection and try again."
        onRetry={() => load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            My Queue
          </h1>
          <p className="text-sm text-text-muted">
            {sortedQueue.length}{" "}
            {sortedQueue.length === 1 ? "study" : "studies"} assigned to you
          </p>
        </div>
      </div>

      <div className="relative flex-1 max-w-sm">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          placeholder="Search patient, accession, study..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none"
        />
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : sortedQueue.length === 0 ? (
        <EmptyState
          title="Your queue is empty"
          description="Studies assigned to you will appear here. Check the worklist for available cases."
        />
      ) : (
        <div className="rounded-md border border-border">
          <div className="grid grid-cols-[1fr_1fr_1.2fr_0.5fr_0.5fr_0.8fr_1fr] gap-4 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <div>Patient</div>
            <div>Accession</div>
            <div>Study</div>
            <div>Modality</div>
            <div>Priority</div>
            <div>Status</div>
            <div>Hospital</div>
          </div>

          {sortedQueue.map((item) => (
            <Link
              key={item.study.studyInstanceUid}
              href={`/reading/${item.study.studyInstanceUid}`}
              className="grid grid-cols-[1fr_1fr_1.2fr_0.5fr_0.5fr_0.8fr_1fr] items-center gap-4 border-b border-border px-4 py-3 transition-colors hover:bg-surface-raised/50"
            >
              <div className="flex items-center gap-2">
                <AcuityPulse
                  priority={item.study.priority}
                  status={item.study.status}
                />
                <span className="text-sm font-medium text-text-primary">
                  {item.study?.patient?.displayName ?? "—"}
                </span>
              </div>
              <span className="font-mono text-xs text-text-muted">
                {item.study.accessionNumber}
              </span>
              <span className="text-sm text-text-primary">
                {item.study.studyDescription}
              </span>
              <span className="text-sm text-text-muted">
                {item.study.modality}
              </span>
              <div>
                <PriorityBadge priority={item.study.priority} />
              </div>
              <div>
                <StatusBadge status={item.study.status} />
              </div>
              <span className="text-sm text-text-muted">
                {item.study.hospital?.name ?? "—"}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="text-xs text-text-muted">
        Click a study to open it in the reading view
      </div>
    </div>
  );
}
