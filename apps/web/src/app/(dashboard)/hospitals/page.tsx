"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, Clock, CheckCircle2, Timer, RefreshCw } from "lucide-react";
import type { Study, StudyStatus } from "@axis/types";
import { MetricCard } from "@/components/hospital/MetricCard";
import { StudyPipeline } from "@/components/hospital/StudyPipeline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { apiClient } from "@/lib/api-client";

interface StudiesEnvelope {
  data: Study[];
}

export default function HospitalPortalPage() {
  const router = useRouter();
  const [studies, setStudies] = useState<Study[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<StudiesEnvelope>("/studies");
      setStudies(res.data ?? []);
    } catch (e) {
      console.error("Failed to load hospital studies", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const today = new Date().toDateString();
  const sentToday = studies.filter(
    (s) => new Date(s.createdAt).toDateString() === today,
  ).length;
  const inProgress = studies.filter(
    (s) => ["RECEIVING", "VALIDATING", "UNASSIGNED", "ASSIGNED", "IN_READING", "REPORT_DRAFT", "RADIOLOGIST_SIGNED", "MANAGER_REVIEW"].includes(s.status),
  ).length;
  const delivered = studies.filter(
    (s) => ["MANAGER_APPROVED", "DELIVERED_TO_HOSPITAL", "HOSPITAL_REVIEW", "HOSPITAL_ACCEPTED", "COMPLETED"].includes(s.status),
  ).length;

  const recent = [...studies]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const tracked = recent.find((s) =>
    ["HOSPITAL_SUBMITTED", "RECEIVING", "VALIDATING", "UNASSIGNED", "ASSIGNED", "IN_READING", "REPORT_DRAFT"].includes(s.status),
  );

  if (hasError) {
    return (
      <div className="p-6">
        <ErrorState
          title="Failed to load hospital portal"
          description="Unable to fetch your hospital's studies."
          onRetry={() => load()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            Hospital Portal
          </h1>
          <p className="text-sm text-text-muted">
            Your hospital&apos;s study submissions and reports
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-text-muted hover:text-text-primary"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            onClick={() => router.push("/hospitals/submit")}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus size={15} />
            Submit Study
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          title="Studies Sent (Today)"
          value={sentToday}
          icon={<Send size={16} />}
        />
        <MetricCard
          title="In Progress"
          value={inProgress}
          icon={<Clock size={16} />}
        />
        <MetricCard
          title="Finalized"
          value={delivered}
          icon={<CheckCircle2 size={16} />}
        />
        <MetricCard
          title="Total Studies"
          value={studies.length}
          icon={<Timer size={16} />}
        />
      </div>

      {tracked && (
        <div className="rounded-md border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              Study Tracker — {tracked.accessionNumber}
            </h2>
            <span className="text-xs text-text-muted">
              {tracked.patient?.displayName} · {tracked.modality} ·{" "}
              {tracked.studyDescription}
            </span>
          </div>
          <StudyPipeline currentStatus={tracked.status as StudyStatus} />
        </div>
      )}

      <div className="rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-heading text-sm font-semibold text-text-primary">
            Recent Studies
          </h2>
          <button
            onClick={() => router.push("/hospitals/tracker")}
            className="text-xs font-medium text-accent hover:underline"
          >
            View all
          </button>
        </div>
        {isLoading ? (
          <SkeletonTable rows={6} />
        ) : recent.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No studies yet"
              description="Submit your first study to get started."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Patient</th>
                  <th className="px-4 py-2.5 font-medium">Accession</th>
                  <th className="px-4 py-2.5 font-medium">Modality</th>
                  <th className="px-4 py-2.5 font-medium">Study</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr
                    key={s.studyInstanceUid}
                    className="border-b border-border last:border-b-0 hover:bg-surface-raised/50"
                  >
                    <td className="px-4 py-2.5 font-medium text-text-primary">
                      {s.patient?.displayName}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                      {s.accessionNumber}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">{s.modality}</td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {s.studyDescription || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
