"use client";

import { useCallback, useEffect, useState } from "react";
import type { AIJob } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { formatTime } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";

interface AIJobWithStudy extends AIJob {
  study?: {
    studyInstanceUid?: string;
    accessionNumber?: string;
    patient?: {
      displayName?: string;
    };
  };
}

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const TASK_LABELS: Record<string, string> = {
  ANATOMY_DETECTION: "Anatomy Detection",
  PATHOLOGY_SCREENING: "Pathology Screening",
  MEASUREMENT: "Measurement",
  COMPARISON: "Comparison",
};

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return "—";
  const sec = Math.floor(
    (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000,
  );
  if (sec < 0) return "—";
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return min > 0 ? `${min}m ${rem}s` : `${sec}s`;
}

export default function AIQueuePage() {
  const [jobs, setJobs] = useState<AIJobWithStudy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<{
        data: AIJobWithStudy[];
        meta?: { total: number };
      }>("/ai/jobs");
      setJobs(res.data ?? []);
    } catch (e) {
      console.error("Failed to load AI jobs", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const queued = jobs.filter((j) => j.status === "QUEUED").length;
  const processing = jobs.filter((j) => j.status === "PROCESSING").length;
  const completed = jobs.filter((j) => j.status === "COMPLETED").length;
  const failed = jobs.filter((j) => j.status === "FAILED").length;

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load AI jobs"
        description="Unable to fetch the AI queue. Please check your connection and try again."
        onRetry={() => load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-text-primary">
          AI Queue Monitor
        </h1>
        <p className="mt-1 rounded-md bg-warning/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-warning">
          AI ASSISTIVE — NOT A FINAL DIAGNOSIS
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Queued", value: queued, color: "text-text-muted" },
          { label: "Processing", value: processing, color: "text-accent" },
          { label: "Completed", value: completed, color: "text-success" },
          { label: "Failed", value: failed, color: "text-error" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-md border border-border bg-surface p-4 text-center"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
              {s.label}
            </p>
            <p className={`mt-1 font-heading text-2xl font-bold ${s.color}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No AI jobs"
          description="AI processing jobs will appear here as studies are submitted."
        />
      ) : (
        <div className="rounded-md border border-border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Task
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Study
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Started
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Completed
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {TASK_LABELS[job.taskType] ?? job.taskType}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-text-primary">
                        {job.study?.accessionNumber ?? job.studyInstanceUid}
                      </p>
                      <p className="text-xs text-text-muted">
                        {job.study?.patient?.displayName ?? "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          job.status === "COMPLETED"
                            ? "bg-success/10 text-success"
                            : job.status === "FAILED"
                              ? "bg-error/10 text-error"
                              : job.status === "PROCESSING"
                                ? "bg-accent/10 text-accent"
                                : "bg-surface-raised text-text-muted"
                        }`}
                      >
                        {STATUS_LABELS[job.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-muted">
                      {job.startedAt ? formatTime(job.startedAt) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-muted">
                      {job.completedAt ? formatTime(job.completedAt) : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">
                      {formatDuration(job.startedAt, job.completedAt)}
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
