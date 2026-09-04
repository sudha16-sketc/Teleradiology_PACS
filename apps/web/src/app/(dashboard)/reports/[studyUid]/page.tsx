"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Study, Report } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { ReportEditor } from "@/components/report/ReportEditor";
import { ReportSidebar } from "@/components/report/ReportSidebar";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAppStore } from "@/lib/store";

export default function ReportEditorPage() {
  const params = useParams();
  const studyUid = typeof params?.studyUid === "string" ? params.studyUid : "";
  const currentUser = useAppStore((s) => s.currentUser);
  const isRadiologist = currentUser?.role === "RADIOLOGIST";

  const [study, setStudy] = useState<Study | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const [studyRes, reportRes] = await Promise.all([
        apiClient.get<{ data: Study }>(`/studies/${encodeURIComponent(studyUid)}`),
        apiClient.get<{ data: Report | null }>(
          `/reports/${encodeURIComponent(studyUid)}`,
        ),
      ]);
      setStudy(studyRes.data);
      setReport(reportRes.data ?? null);
    } catch (e) {
      console.error("Failed to load report", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [studyUid]);

  useEffect(() => {
    if (studyUid) load();
  }, [studyUid, load]);

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load report"
        description="Unable to fetch this report. Please check your connection and try again."
        onRetry={() => load()}
      />
    );
  }

  if (isLoading || !study) {
    return (
      <div className="flex h-full gap-4">
        <Skeleton className="flex-1" />
        <Skeleton className="w-72" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-full flex-col gap-4">
        <div className="flex flex-1 items-center justify-center rounded-md border border-border">
          <EmptyState
            title="No report yet"
            description="This study does not have a report yet. Open the reading view to create one."
          />
        </div>
        <aside className="w-72 flex-shrink-0">
          <ReportSidebar
            patientName={study.patient?.displayName ?? "—"}
            patientId={study.patient?.patientId ?? "—"}
            accessionNumber={study.accessionNumber}
            modality={study.modality}
            studyDescription={study.studyDescription}
            bodyPart={study.bodyPart}
            hospitalName={study.hospital?.name ?? "—"}
            assignedRadiologist={study.assignedRadiologist?.displayName ?? "—"}
            studyInstanceUid={studyUid}
          />
        </aside>
      </div>
    );
  }

  if (!isRadiologist) {
    return (
      <div className="flex h-full gap-4">
        <div className="flex flex-1 items-center justify-center rounded-md border border-border">
          <EmptyState
            title="Report editing is restricted"
            description="Only the assigned radiologist can create or edit report content. Review and release are performed from the reading view."
          />
        </div>
        <aside className="w-72 flex-shrink-0 overflow-y-auto">
          <ReportSidebar
            patientName={study.patient?.displayName ?? "—"}
            patientId={study.patient?.patientId ?? "—"}
            accessionNumber={study.accessionNumber}
            modality={study.modality}
            studyDescription={study.studyDescription}
            bodyPart={study.bodyPart}
            hospitalName={study.hospital?.name ?? "—"}
            assignedRadiologist={study.assignedRadiologist?.displayName ?? "—"}
            studyInstanceUid={studyUid}
          />
        </aside>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4">
      <div className="flex flex-1 overflow-hidden">
        <ReportEditor
          studyInstanceUid={studyUid}
          initialClinicalHistory={report.clinicalHistory}
          initialFindings={report.findings}
          initialImpression={report.impression}
          initialTechnique={report.technique}
          initialComparison={report.comparison}
          initialRecommendations={report.recommendations}
          initialCriticalFinding={report.criticalFinding}
          status={report.status}
        />
      </div>

      <aside className="w-72 flex-shrink-0 overflow-y-auto">
        <ReportSidebar
          patientName={study.patient?.displayName ?? "—"}
          patientId={study.patient?.patientId ?? "—"}
          accessionNumber={study.accessionNumber}
          modality={study.modality}
          studyDescription={study.studyDescription}
          bodyPart={study.bodyPart}
          hospitalName={study.hospital?.name ?? "—"}
          assignedRadiologist={study.assignedRadiologist?.displayName ?? "—"}
          studyInstanceUid={studyUid}
        />
      </aside>
    </div>
  );
}
