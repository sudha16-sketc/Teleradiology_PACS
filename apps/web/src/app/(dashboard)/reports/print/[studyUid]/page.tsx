"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Printer, ArrowLeft, Loader2 } from "lucide-react";
import type { Report, Study } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { failureOf } from "@/lib/api-client";
import { printCurrentView } from "@/lib/desktop-bridge";
import { ErrorPanel } from "@/components/ErrorPanel";

/**
 * Print-optimised view of a single radiology report.
 *
 * # Why this exists alongside the server PDF
 *
 * `GET /reports/hospital/:studyUid/pdf` is the canonical, signed-off artefact
 * and stays exactly as it is: it is what gets filed, what gets delivered to a
 * requesting hospital, and what an auditor asks for. It is a plain-text
 * monospaced layout, because it has to render identically in any PDF viewer on
 * any machine.
 *
 * This page is for the other case — a clinician who wants the report on paper
 * *now*, in the reading room, without a round trip through a file dialog and a
 * viewer. It reuses the same authorised data (`GET /reports/:studyUid`, which
 * enforces the same RBAC and hospital isolation) and lays it out for the print
 * pipeline. It is a presentation layer, not a second renderer: it contains no
 * PDF generation, writes no file, and never becomes the record of the report.
 *
 * The section order and labels deliberately mirror `buildPdf` in
 * `apps/api/src/reports/reports.service.ts`. If one changes, the other must too,
 * or a printed page and a filed PDF will disagree — which is exactly the kind of
 * discrepancy nobody notices until it matters.
 *
 * # Printing
 *
 * `window.print()` opens the platform print dialog, which on the desktop client
 * is the native WebView2 pipeline. There is no Tauri `print()` binding, so this
 * is not a degraded path on Windows; it is the same path a browser tab uses.
 * Nothing is spooled to disk by this page, and the page holds no state beyond
 * the fetched report.
 */

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
        const res = await apiClient.get<ReportEnvelope>(
          `/reports/${encodeURIComponent(studyUid)}`,
          // A print request is a one-off read; no reason to hold a socket open.
          { timeoutMs: 15_000 },
        );
        if (cancelled) return;
        setReport(res.data);
      } catch (e: unknown) {
        if (cancelled) return;
        setFailure(failureOf(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [studyUid]);

  const study: Study | undefined = report?.study;

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
          failure={
            failure ??
            // Unreachable in practice: a successful fetch always sets a report.
            failureOf(new Error("No report was returned"))
          }
          onRetry={() => router.refresh()}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/*
        Screen-only toolbar. `print:hidden` keeps it off paper — a printed report
        must not carry a "Print" button.
      */}
      <div className="print:hidden border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
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
            Print
          </button>
        </div>
      </div>

      <article className="report-print mx-auto max-w-3xl bg-white px-10 py-8 text-black">
        <header className="border-b-2 border-black pb-3">
          <h1 className="text-center text-lg font-bold tracking-wide">
            AXIS RADIOLOGY PACS — FINAL RADIOLOGY REPORT
          </h1>
        </header>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] leading-snug">
          <Field label="Accession #" value={study?.accessionNumber} />
          <Field label="Study UID" value={study?.studyInstanceUid} />
          <Field label="Study Date" value={dateOnly(study?.studyDate)} />
          <Field label="Modality" value={study?.modality} />
          <Field label="Body Part" value={study?.bodyPart} />
          <Field
            label="Study Description"
            value={study?.studyDescription}
          />
          <Field label="Referring Physician" value={study?.referringPhysician} />
          <Field label="Hospital" value={study?.hospital?.name} />
        </dl>

        <Section title="Patient">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] leading-snug">
            <Field label="Name" value={study?.patient?.displayName} />
            <Field label="Patient ID" value={study?.patient?.patientId} />
            <Field
              label="DOB"
              value={dateOnly(study?.patient?.dateOfBirth)}
            />
            <Field label="Gender" value={study?.patient?.gender} />
          </dl>
        </Section>

        <Section title="Clinical History">
          {report.clinicalHistory || study?.clinicalHistory || "N/A"}
        </Section>

        <Section title="Technique">{report.technique || "N/A"}</Section>

        <Section title="Comparison / Priors">
          {report.comparison || "N/A"}
        </Section>

        <Section title="Findings">{report.findings || "N/A"}</Section>

        <Section title="Impression">{report.impression || "N/A"}</Section>

        {report.recommendations ? (
          <Section title="Recommendations">{report.recommendations}</Section>
        ) : null}

        {report.criticalFinding ? (
          <p className="mt-4 border-2 border-black py-2 text-center text-sm font-bold">
            *** CRITICAL FINDING — ACTION REQUIRED ***
          </p>
        ) : null}

        <footer className="mt-6 border-t-2 border-black pt-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] leading-snug">
            <Field label="Report Status" value={report.status} />
            <Field label="Signed Off By" value={report.signedOffBy} />
            {report.signedOffAt ? (
              <Field label="Signed Off At" value={report.signedOffAt} />
            ) : null}
            <Field label="Report Version" value={String(report.version)} />
          </dl>
        </footer>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="border-b border-black pb-0.5 text-[13px] font-bold tracking-wide uppercase">
        {title}
      </h2>
      <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">
        {children}
      </div>
    </section>
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

/** `YYYY-MM-DD`, matching the server PDF's date formatting exactly. */
function dateOnly(value?: string | null): string {
  return value ? value.slice(0, 10) : "";
}
