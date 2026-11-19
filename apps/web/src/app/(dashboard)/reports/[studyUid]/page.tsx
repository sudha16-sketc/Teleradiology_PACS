"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { CompanySettings, Study, Report } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { ReportEditor } from "@/components/report/ReportEditor";
import { ReportCreationOptions } from "@/components/report/ReportCreationOptions";
import { ReportPreview } from "@/components/report/ReportPreview";
import { ReportSidebar } from "@/components/report/ReportSidebar";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAppStore } from "@/lib/store";
import { reportBodyHtml } from "@/lib/report-html";

export default function ReportEditorPage() {
  const params = useParams();
  const studyUid = typeof params?.studyUid === "string" ? params.studyUid : "";
  const currentUser = useAppStore((s) => s.currentUser);
  const isRadiologist = currentUser?.role === "RADIOLOGIST";

  const [study, setStudy] = useState<Study | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const [studyRes, reportRes, companyRes] = await Promise.all([
        apiClient.get<{ data: Study }>(`/studies/${encodeURIComponent(studyUid)}`),
        apiClient.get<{ data: Report | null }>(
          `/reports/${encodeURIComponent(studyUid)}`,
        ),
        apiClient
          .get<{ data: CompanySettings | null }>("/company-settings")
          .catch(() => ({ data: null })),
      ]);
      setStudy(studyRes.data);
      setReport(reportRes.data ?? null);
      setCompany(companyRes.data ?? null);
    } catch (e) {
      console.error("Failed to load report", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [studyUid]);

  useEffect(() => {
    if (studyUid) void load();
  }, [studyUid, load]);

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load report"
        description="Unable to fetch this report. Please check your connection and try again."
        onRetry={() => void load()}
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

  const isAssigned =
    isRadiologist && study.assignedRadiologistId === currentUser?.id;
  const sidebar = (
    <aside className="w-72 flex-shrink-0 overflow-y-auto">
      <ReportSidebar
        patientUid={study.patient?.patientId ?? "—"}
        accessionNumber={study.accessionNumber}
        modality={study.modality}
        studyDescription={study.studyDescription}
        bodyPart={study.bodyPart}
        hospitalName={study.hospital?.name ?? "—"}
        assignedRadiologist={study.assignedRadiologist?.displayName ?? "—"}
        studyInstanceUid={studyUid}
      />
    </aside>
  );

  if (!report) {
    return (
      <div className="flex h-full gap-4">
        <div className="flex flex-1 items-center justify-center overflow-y-auto rounded-md border border-border p-6">
          {isAssigned ? (
            <ReportCreationOptions
              studyInstanceUid={studyUid}
              onCreated={(created) => setReport(created)}
            />
          ) : (
            <EmptyState
              title={isRadiologist ? "Study not assigned to you" : "No report yet"}
              description={
                isRadiologist
                  ? "Only the assigned radiologist can create a report for this study."
                  : "This study does not have a report yet. A radiologist must create it from their worklist."
              }
            />
          )}
        </div>
        {sidebar}
      </div>
    );
  }

  if (!isRadiologist) {
    return (
      <div className="flex h-full gap-4">
        <div className="flex flex-1 flex-col overflow-y-auto rounded-md border border-border">
          <div className="no-print flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-4 py-2">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Read-only report · {report.status.replace(/_/g, " ")}
            </span>
            <a
              href={`/reports/print/${encodeURIComponent(studyUid)}`}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface"
            >
              Print / PDF
            </a>
          </div>
          <div className="overflow-y-auto p-4">
            <ReportPreview
              inline
              study={study}
              reportId={report.id}
              reportVersion={report.version}
              contentHtml={reportBodyHtml(report)}
              company={company}
            />
          </div>
        </div>
        {sidebar}
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4">
      <div className="flex flex-1 overflow-hidden">
        <ReportEditor
          study={study}
          studyInstanceUid={studyUid}
          reportId={report.id}
          reportVersion={report.version}
          initialContentHtml={report.contentHtml}
          initialClinicalHistory={report.clinicalHistory}
          initialFindings={report.findings}
          initialImpression={report.impression}
          initialTechnique={report.technique}
          initialComparison={report.comparison}
          initialRecommendations={report.recommendations}
          initialCriticalFinding={report.criticalFinding}
          status={report.status}
          isAssigned={isAssigned}
          company={company}
        />
      </div>

      {sidebar}
    </div>
  );
}
