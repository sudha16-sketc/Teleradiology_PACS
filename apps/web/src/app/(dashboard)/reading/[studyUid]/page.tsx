"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { hasReportBodyContent } from "@/lib/report-html";
import {
  IMAGING_AVAILABILITY_BADGE_CLASSES,
  IMAGING_AVAILABILITY_LABELS,
} from "@/lib/imaging-availability";
import type {
  ApiError,
  ImagingAvailabilityResult,
  Report,
  Study,
} from "@axis/types";

interface StudyEnvelope {
  data: Study;
}

interface ReportEnvelope {
  data: (Report & { versions?: unknown[]; changeRequests?: unknown[] }) | null;
}

export default function ReadingPage() {
  const params = useParams();
  const studyUid =
    typeof params?.studyUid === "string" ? params.studyUid : "";

  const [study, setStudy] = useState<Study | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [availability, setAvailability] =
    useState<ImagingAvailabilityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveFlushRef = useRef<(() => Promise<boolean>) | null>(null);
  const registerSaveFlush = useCallback(
    (flush: (() => Promise<boolean>) | null) => {
      saveFlushRef.current = flush;
    },
    [],
  );
  const beforeSign = useCallback(async () => {
    if (!saveFlushRef.current) return true;
    return saveFlushRef.current();
  }, []);

  const currentUser = useAppStore((s) => s.currentUser);
  const isRadiologist = currentUser?.role === "RADIOLOGIST";
  const isReviewer =
    currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const isAssigned =
    isRadiologist && study?.assignedRadiologistId === currentUser?.id;

  const load = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background ?? false;
    if (!background) {
      setLoading(true);
      setAvailability(null);
    }
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
      if (!background) {
        setError(
          (err as ApiError).message ?? "Unable to load this study.",
        );
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [studyUid]);

  useEffect(() => {
    void load();
  }, [load]);

  // Light background poll — every 60s to catch external status changes.
  // Never toggle the page-level loading state here: that would unmount the
  // viewer and report panel and discard in-progress edits.
  useEffect(() => {
    const interval = setInterval(() => {
      void load({ background: true });
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
      <div className="flex min-h-full flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <div className="flex flex-1 flex-col gap-4 lg:flex-row">
          <Skeleton className="h-[45dvh] min-h-[280px] flex-1 lg:h-auto" />
          <Skeleton className="h-48 w-full lg:h-auto lg:w-[380px] lg:shrink-0" />
        </div>
      </div>
    );
  }

  const reportHasContent =
    hasReportBodyContent(report?.contentHtml) ||
    !!(report?.findings?.trim() && report?.impression?.trim());

  return (
    <div className="flex min-h-full flex-col gap-4">
      <StudyContextBar
        patientUid={study.patient?.patientId ?? "—"}
        accessionNumber={study.accessionNumber}
      />

      {availability ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span
            className={`rounded-full border px-2 py-0.5 ${IMAGING_AVAILABILITY_BADGE_CLASSES[availability.state]}`}
          >
            {IMAGING_AVAILABILITY_LABELS[availability.state]}
          </span>
          <span>
            Series {availability.actualSeriesCount}/{availability.expectedSeriesCount} ·
            Instances {availability.actualInstanceCount}/{availability.expectedInstanceCount}
          </span>
        </div>
      ) : null}

      <div className="flex min-h-[85dvh] flex-1 flex-col overflow-hidden rounded-md border border-border lg:min-h-0 lg:flex-row">
        <div className="h-[42dvh] min-h-[280px] shrink-0 bg-surface lg:h-auto lg:min-h-0 lg:min-w-0 lg:flex-1">
          <OHIFViewer
            studyInstanceUid={study.studyInstanceUid}
            onAvailabilityChange={setAvailability}
          />
        </div>

        <div className="min-h-[43dvh] w-full flex-1 overflow-y-auto border-t border-border bg-surface lg:min-h-0 lg:w-[380px] lg:flex-none lg:border-l lg:border-t-0">
          <StudyMetadataPanel study={study} />
          <PriorStudiesList studyUid={studyUid} />
          {isReviewer ? (
            <>
              <ReportPanel
                studyInstanceUid={studyUid}
                report={report}
                study={study}
              />
              {report && <CriticalFindingBanner report={report} />}
              <ReviewActions
                studyInstanceUid={studyUid}
                status={study.status}
                onChanged={() => void load({ background: true })}
              />
            </>
          ) : isRadiologist && isAssigned ? (
            <>
              <ReportPanel
                studyInstanceUid={studyUid}
                report={report}
                study={study}
                onReportSaved={() => void load({ background: true })}
                registerSaveFlush={registerSaveFlush}
              />
              {report && <CriticalFindingBanner report={report} />}
              <CorrectionWorkflow
                studyInstanceUid={studyUid}
                status={study.status}
                onChanged={() => void load({ background: true })}
              />
              <SignOffControls
                studyInstanceUid={studyUid}
                status={study.status}
                reportHasContent={reportHasContent}
                beforeSign={beforeSign}
                onChanged={() => void load({ background: true })}
              />
            </>
          ) : (
            <>
              <ReportPanel
                studyInstanceUid={studyUid}
                report={report}
                study={study}
              />
              {report && <CriticalFindingBanner report={report} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
