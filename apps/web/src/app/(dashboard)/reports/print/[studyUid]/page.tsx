"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import type { Report, Study } from "@axis/types";
import {
  buildReportRichContent,
  isReportRichContent,
} from "@axis/types";
import { apiClient, failureOf } from "@/lib/api-client";
import { printCurrentView } from "@/lib/desktop-bridge";
import { ErrorPanel } from "@/components/ErrorPanel";
import { ReportDocumentCanvas } from "@/components/report/ReportDocumentCanvas";

interface ReportEnvelope {
  data: Report;
}

export default function PrintReportPage() {
  const params = useParams<{ studyUid: string }>();
  const router = useRouter();
  const studyUid = decodeURIComponent(params.studyUid ?? "");

  const [report, setReport] = useState<Report | null>(null);
  const [failure, setFailure] = useState<ReturnType<typeof failureOf> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFailure(null);
      try {
        const response = await apiClient.get<ReportEnvelope>(
          `/reports/${encodeURIComponent(studyUid)}`,
          { timeoutMs: 15_000 },
        );
        if (!cancelled) setReport(response.data);
      } catch (error: unknown) {
        if (!cancelled) setFailure(failureOf(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [studyUid]);

  const richContent = useMemo(() => {
    if (isReportRichContent(report?.richContent)) return report.richContent;
    return buildReportRichContent({
      clinicalHistory: report?.clinicalHistory ?? "",
      technique: report?.technique ?? "",
      comparison: report?.comparison ?? "",
      findings: report?.findings ?? "",
      impression: report?.impression ?? "",
      recommendations: report?.recommendations ?? "",
    });
  }, [report]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (failure || !report) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <ErrorPanel
          title="This report could not be loaded"
          failure={failure ?? failureOf(new Error("No report was returned"))}
          onRetry={() => router.refresh()}
        />
      </div>
    );
  }

  const study: Study | undefined = report.study;
  if (!study) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <ErrorPanel
          title="Study details are unavailable"
          failure={failureOf(new Error("The report did not include its study details."))}
          onRetry={() => router.refresh()}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[900px] items-center justify-between px-6 py-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              void printCurrentView();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            <Printer className="h-4 w-4" />
            Export / Print
          </button>
        </div>
      </div>

      <article className="report-print mx-auto max-w-[900px] bg-white px-6 py-8 text-black">
        <header className="mb-5 border-b-2 border-black pb-3">
          <p className="text-center text-xl font-bold tracking-wide">
            AXIS RADIOLOGY
          </p>
          <h1 className="mt-1 text-center text-sm font-semibold tracking-wider">
            CLINICAL IMAGING REPORT
          </h1>
          <p className="mt-1 text-center text-xs">
            Confidential medical record
          </p>
        </header>

        <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] leading-snug">
          <Field label="Patient" value={study.patient?.displayName} />
          <Field label="Patient ID" value={study.patient?.patientId} />
          <Field label="Date of Birth" value={dateOnly(study.patient?.dateOfBirth)} />
          <Field label="Gender" value={study.patient?.gender} />
          <Field label="Accession" value={study.accessionNumber} />
          <Field label="Study Date" value={dateOnly(study.studyDate)} />
          <Field label="Modality" value={study.modality} />
          <Field label="Body Part" value={study.bodyPart} />
          <Field label="Description" value={study.studyDescription} />
          <Field label="Referring Physician" value={study.referringPhysician} />
          <Field label="Hospital" value={study.hospital?.name} />
          <Field label="Assigned Radiologist" value={study.assignedRadiologist?.displayName} />
        </dl>

        <ReportDocumentCanvas
          content={richContent}
          study={study}
          editable={false}
        />

        <footer className="mt-6 border-t-2 border-black pt-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] leading-snug">
            <Field label="Report Status" value={report.status} />
            <Field label="Signed Off By" value={report.signedOffBy} />
            <Field
              label="Signed Off At"
              value={report.signedOffAt ? dateOnly(report.signedOffAt) : ""}
            />
            <Field label="Report Version" value={String(report.version)} />
          </dl>
          <p className="mt-3 text-center text-[11px] text-gray-700">
            Contact: [Company contact details]
          </p>
        </footer>
      </article>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-semibold">{label}:</dt>
      <dd className="min-w-0 break-words">{value || ""}</dd>
    </div>
  );
}

function dateOnly(value?: string | null): string {
  return value ? value.slice(0, 10) : "";
}
