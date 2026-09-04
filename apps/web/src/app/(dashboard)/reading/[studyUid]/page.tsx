"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { StudyContextBar } from "@/components/reading/StudyContextBar";
import { OHIFViewer } from "@/components/reading/OHIFViewer";
import { StudyMetadataPanel } from "@/components/reading/StudyMetadataPanel";
import { PriorStudiesList } from "@/components/reading/PriorStudiesList";
import { ReportPanel } from "@/components/reading/ReportPanel";
import { CriticalFindingBanner } from "@/components/reading/CriticalFindingBanner";
import { SignOffControls } from "@/components/reading/SignOffControls";
import { ReviewActions } from "@/components/reading/ReviewActions";
import { CorrectionWorkflow } from "@/components/reading/CorrectionWorkflow";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAppStore } from "@/lib/store";
import type { ApiError, Study, Report } from "@axis/types";

interface StudyEnvelope {
  data: Study;
}

interface ReportEnvelope {
  data: Report | null;
}

export default function ReadingPage() {
  const params = useParams();
  const studyUid =
    typeof params?.studyUid === "string" ? params.studyUid : "";

  const [study, setStudy] = useState<Study | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentUser = useAppStore((s) => s.currentUser);
  const isRadiologist = currentUser?.role === "RADIOLOGIST";
  const isReviewer =
    currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const isAssigned =
    isRadiologist && study?.assignedRadiologistId === currentUser?.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [studyRes, reportRes] = await Promise.all([
        apiClient.get<StudyEnvelope>(
          `/studies/${encodeURIComponent(studyUid)}`,
        ),
        apiClient.get<ReportEnvelope>(
          `/reports/${encodeURIComponent(studyUid)}`,
        ),
      ]);
      setStudy(studyRes.data);
      setReport(reportRes.data ?? null);
    } catch (err) {
      setError(
        (err as ApiError).message ?? "Unable to load this study.",
      );
    } finally {
      setLoading(false);
    }
  }, [studyUid]);

  useEffect(() => {
    void load();
  }, [load]);

  // Light background poll — every 60s to catch external status changes.
  useEffect(() => {
    const interval = setInterval(() => {
      void load();
    }, 60000);
    return () => clearInterval(interval);
  }, [load]);

  if (error) {
    return (
      <ErrorState
        title="Unable to load study"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  if (loading || !study) {
    return (
      <div className="flex h-full flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <div className="flex flex-1 gap-4">
          <Skeleton className="flex-1" />
          <Skeleton className="w-[380px]" />
        </div>
      </div>
    );
  }

  const reportHasContent = !!(
    report?.findings?.trim() && report?.impression?.trim()
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <StudyContextBar
        patientName={study.patient.displayName}
        accessionNumber={study.accessionNumber}
      />

      <div className="flex flex-1 gap-0 overflow-hidden rounded-md border border-border">
        <div className="flex-1 bg-surface">
          <OHIFViewer studyInstanceUid={study.studyInstanceUid} />
        </div>

        <div className="w-[380px] shrink-0 overflow-y-auto border-l border-border bg-surface">
          <StudyMetadataPanel study={study} />
          <PriorStudiesList studyUid={studyUid} />
          {isReviewer ? (
            <>
              <ReportPanel studyInstanceUid={studyUid} report={report} />
              {report && <CriticalFindingBanner report={report} />}
              <ReviewActions
                studyInstanceUid={studyUid}
                status={study.status}
                onChanged={() => void load()}
              />
            </>
          ) : isRadiologist && isAssigned ? (
            <>
              <ReportPanel
                studyInstanceUid={studyUid}
                report={report}
                onReportSaved={() => void load()}
              />
              {report && <CriticalFindingBanner report={report} />}
              <CorrectionWorkflow
                studyInstanceUid={studyUid}
                status={study.status}
                onChanged={() => void load()}
              />
              <SignOffControls
                studyInstanceUid={studyUid}
                status={study.status}
                reportHasContent={reportHasContent}
                onChanged={() => void load()}
              />
            </>
          ) : (
            <>
              <ReportPanel
                studyInstanceUid={studyUid}
                report={report}
              />
              {report && <CriticalFindingBanner report={report} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
