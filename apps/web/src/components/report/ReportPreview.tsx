"use client";

import { useEffect } from "react";
import { Printer, X } from "lucide-react";
import type { CompanySettings, Study } from "@axis/types";
import { sanitizeReportHtml } from "@/lib/report-html";
import { ReportFooter } from "./ReportFooter";

interface ReportPreviewProps {
  study: Study;
  reportId: string;
  reportVersion: number;
  contentHtml: string;
  company?: CompanySettings | null;
  onClose: () => void;
}

function formatStudyDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Read-only A4-style preview. The browser print dialog is used for PDF export,
 * which keeps the output identical to what the radiologist reviewed on screen.
 */
export function ReportPreview({
  study,
  reportId,
  reportVersion,
  contentHtml,
  company,
  onClose,
}: ReportPreviewProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const safeHtml = sanitizeReportHtml(contentHtml);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Report preview"
    >
      <div className="w-full max-w-[820px]">
        <div className="no-print mb-3 flex items-center justify-between rounded-md bg-surface px-4 py-2 shadow-lg">
          <span className="text-sm font-semibold text-text-primary">
            Report preview
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-accent/90"
            >
              <Printer size={14} />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="rounded-md border border-border p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          id="report-print-root"
          className="report-paper mx-auto bg-white px-10 py-8 text-neutral-900 shadow-2xl"
        >
          <header className="border-b-2 border-neutral-800 pb-3">
            <div className="flex items-start justify-between gap-6">
              <div>
                <h1 className="text-xl font-bold tracking-wide">
                  {company?.name?.trim() || study.hospital?.name || "RADIOLOGY REPORT"}
                </h1>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                  Diagnostic Radiology Report
                </p>
              </div>
              <div className="text-right text-[11px] leading-relaxed text-neutral-700">
                <p>
                  <span className="font-semibold">Report ID:</span> {reportId}
                </p>
                <p>
                  <span className="font-semibold">Version:</span> {reportVersion}
                </p>
                <p>
                  <span className="font-semibold">Date:</span>{" "}
                  {formatStudyDate(study.studyDate)}
                </p>
              </div>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-x-8 gap-y-2 border-b border-neutral-300 py-4 text-[12px]">
            <Detail label="Patient UID" value={study.patient?.patientId} mono />
            <Detail label="Study UID" value={study.studyInstanceUid} mono />
            <Detail label="Accession Number" value={study.accessionNumber} mono />
            <Detail label="Modality / Body Part" value={`${study.modality} / ${study.bodyPart}`} />
            <Detail label="Study Description" value={study.studyDescription} />
            <Detail label="Referring Physician" value={study.referringPhysician} />
            <Detail label="Facility" value={study.hospital?.name} />
            <Detail
              label="Clinical History"
              value={study.clinicalHistory ?? "—"}
            />
          </section>

          <article
            className="report-paper-content min-h-[360px] py-5 font-serif text-[13px] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />

          <ReportFooter
            company={company}
            hospitalName={study.hospital?.name}
            reportId={reportId}
          />
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className={mono ? "break-all font-mono text-[11px]" : ""}>
        {value?.trim() ? value : "—"}
      </p>
    </div>
  );
}
