"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CheckCircle2, ShieldCheck, FileText, RefreshCw } from "lucide-react";
import type { Report, Study, StudyStatus } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/format";

interface StudyEnvelope {
  data: Study;
}

interface ReportEnvelope {
  data: Report | null;
}

const HOSPITAL_REVIEWABLE: StudyStatus[] = [
  "DELIVERED_TO_HOSPITAL",
  "HOSPITAL_REVIEW",
  "HOSPITAL_ACCEPTED",
  "COMPLETED",
];

const CORRECTION_ELIGIBLE: StudyStatus[] = [
  "DELIVERED_TO_HOSPITAL",
  "HOSPITAL_REVIEW",
  "HOSPITAL_ACCEPTED",
  "COMPLETED",
];

export default function HospitalReportDetailPage() {
  const params = useParams();
  const router = useRouter();
  const studyUid =
    typeof params?.studyUid === "string" ? params.studyUid : "";

  const [study, setStudy] = useState<Study | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [corrBusy, setCorrBusy] = useState(false);
  const [corrReason, setCorrReason] = useState("");
  const [corrNotice, setCorrNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        apiClient.get<StudyEnvelope>(`/studies/${encodeURIComponent(studyUid)}`),
        apiClient.get<ReportEnvelope>(`/reports/${encodeURIComponent(studyUid)}`),
      ]);
      setStudy(s.data);
      setReport(r.data ?? null);
    } catch (err) {
      setError((err as { message?: string }).message ?? "Unable to load this report.");
    } finally {
      setLoading(false);
    }
  }, [studyUid]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: "hospital-review" | "accept") => {
    if (busy) return;
    setBusy(action);
    setNotice(null);
    try {
      await apiClient.post(`/studies/${encodeURIComponent(studyUid)}/${action}`);
      setNotice(
        action === "hospital-review"
          ? "Report marked as reviewed by your hospital."
          : "Report accepted by your hospital.",
      );
      await load();
    } catch (e) {
      setNotice((e as { message?: string }).message ?? "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  const requestCorrection = async () => {
    if (corrBusy) return;
    if (!corrReason.trim()) {
      setCorrNotice("Please describe the correction needed.");
      return;
    }
    setCorrBusy(true);
    setCorrNotice(null);
    try {
      await apiClient.post(
        `/studies/${encodeURIComponent(studyUid)}/correction-requests`,
        { reason: corrReason.trim() },
      );
      setCorrReason("");
      setCorrNotice("Correction request submitted for manager review.");
      await load();
    } catch (e) {
      setCorrNotice(
        (e as { message?: string }).message ?? "Request failed.",
      );
    } finally {
      setCorrBusy(false);
    }
  };

  if (error) {
    return (
      <ErrorState
        title="Unable to load report"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  if (loading || !study) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const status = study.status as StudyStatus;
  const canReview = status === "DELIVERED_TO_HOSPITAL";
  const canAccept = status === "HOSPITAL_REVIEW";
  const isFinalized =
    status === "HOSPITAL_ACCEPTED" || status === "COMPLETED";

  return (
    <div className="flex flex-col gap-6 p-6">
      <button
        type="button"
        onClick={() => router.push("/hospitals/reports")}
        className="flex w-fit items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
      >
        <ArrowLeft size={15} />
        Back to Received Reports
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-heading text-xl font-bold text-text-primary">
            {study.patient?.displayName ?? "Patient"}
          </div>
          <div className="text-sm text-text-muted">
            {study.studyDescription || "Radiology Study"} ·{" "}
            {study.accessionNumber} · {study.modality}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {!HOSPITAL_REVIEWABLE.includes(status) ? (
        <div className="rounded-md border border-border bg-surface p-6 text-center">
          <LockNote />
          <p className="mt-2 text-sm text-text-muted">
            This report is not yet available for your hospital. It becomes
            available once delivered.
          </p>
        </div>
      ) : (
        <>
          {/* Integrity banner for signed, immutable reports */}
          {report && (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2">
              <ShieldCheck size={16} className="text-success" />
              <span className="text-xs text-text-muted">
                Signed report — immutable content. Signed by{" "}
                <span className="font-medium text-text-primary">
                  {report.author?.displayName ?? "Radiologist"}
                </span>
                {report.signedOffAt
                  ? ` on ${formatDateTime(report.signedOffAt)}`
                  : ""}
                {report.contentHash ? (
                  <span className="ml-1 font-mono">
                    · SHA-256 {report.contentHash.slice(0, 16)}…
                  </span>
                ) : null}
              </span>
            </div>
          )}

          {notice && (
            <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-text-primary">
              {notice}
            </div>
          )}

          {report && (
            <div className="rounded-md border border-border bg-surface">
              <div className="border-b border-border px-5 py-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
                Radiology Report
              </div>
              <div className="flex flex-col gap-4 px-5 py-4">
                <Section label="Clinical History">
                  {report.clinicalHistory || "—"}
                </Section>
                <Section label="Technique">{report.technique || "—"}</Section>
                <Section label="Comparison / Priors">
                  {report.comparison || "—"}
                </Section>
                <Section label="Findings">{report.findings}</Section>
                <Section label="Impression">{report.impression}</Section>
                <Section label="Recommendations">
                  {report.recommendations || "—"}
                </Section>
                {report.criticalFinding && (
                  <div className="rounded-md bg-warning/10 px-3 py-2 text-sm font-medium text-warning">
                    *** CRITICAL FINDING — ACTION REQUIRED ***
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hospital review/accept actions */}
          {(canReview || canAccept || isFinalized) && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
              <div className="text-sm font-semibold text-text-primary">
                Hospital Review
              </div>
              {canReview && (
                <>
                  <p className="text-xs text-text-muted">
                    Your hospital has received this report. Confirm you have
                    reviewed it.
                  </p>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run("hospital-review")}
                    className="flex items-center justify-center gap-2 rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === "hospital-review" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : null}
                    Mark as Reviewed
                  </button>
                </>
              )}
              {canAccept && (
                <>
                  <p className="text-xs text-text-muted">
                    Accepting this report finalizes your hospital&apos;s
                    acceptance of the findings.
                  </p>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run("accept")}
                    className="flex items-center justify-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === "accept" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : null}
                    Accept Report
                  </button>
                </>
              )}
              {isFinalized && (
                <div className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 size={16} />
                  {status === "COMPLETED"
                    ? "This study is completed."
                    : "This report has been accepted by your hospital."}
                </div>
              )}
            </div>
          )}

          {/* Request correction for a delivered/accepted/completed signed report */}
          {CORRECTION_ELIGIBLE.includes(status) && report && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <RefreshCw size={15} className="text-text-muted" />
                Request a Correction
              </div>
              <p className="text-xs text-text-muted">
                The signed report is immutable and will not be changed. A
                correction request creates a new version which is reviewed and
                delivered through the standard workflow.
              </p>
              <textarea
                value={corrReason}
                onChange={(e) => setCorrReason(e.target.value)}
                placeholder="Describe the correction needed (e.g. impression)"
                rows={3}
                className="w-full resize-none rounded-md border border-border/60 bg-white/70 p-2 text-sm text-text-primary placeholder-text-muted/50 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={corrBusy}
                onClick={requestCorrection}
                className="flex w-fit items-center justify-center gap-2 rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {corrBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                Submit Correction Request
              </button>
              {corrNotice && (
                <p className="text-xs text-text-muted">{corrNotice}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-text-primary">
        {children}
      </div>
    </div>
  );
}

function LockNote() {
  return (
    <FileText size={32} strokeWidth={1} className="mx-auto text-text-muted" />
  );
}
