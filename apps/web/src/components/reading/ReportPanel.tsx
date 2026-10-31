"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { clsx } from "clsx";
import type { Report, ReportStatus, ReportVersion } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { formatDateTime } from "@/lib/format";
import { CriticalFindingToggle } from "@/components/report/CriticalFindingToggle";

interface ReportPanelProps {
  studyInstanceUid: string;
  report: Report | null;
  onReportSaved?: () => void;
  onAmend?: () => void;
}

type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

interface ReportFormFields {
  clinicalHistory: string;
  findings: string;
  impression: string;
  technique: string;
  comparison: string;
  recommendations: string;
  criticalFinding: boolean;
}

const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  DRAFT: "bg-surface text-text-muted",
  SIGNED: "bg-accent/10 text-accent",
  RADIOLOGIST_SIGNED: "bg-accent/10 text-accent",
  MANAGER_REVIEW: "bg-warning/10 text-warning",
  MANAGER_APPROVED: "bg-success/10 text-success",
  HOSPITAL_REVIEW: "bg-warning/10 text-warning",
  CORRECTION_REQUESTED: "bg-error/10 text-error",
};

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: "Draft",
  SIGNED: "Signed",
  RADIOLOGIST_SIGNED: "Signed",
  MANAGER_REVIEW: "Manager Review",
  MANAGER_APPROVED: "Approved",
  HOSPITAL_REVIEW: "Hospital Review",
  CORRECTION_REQUESTED: "Correction Requested",
};

const AUTOSAVE_DELAY_MS = 500;

export function ReportPanel({
  studyInstanceUid,
  report,
  onReportSaved,
  onAmend,
}: ReportPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isAmending, setIsAmending] = useState(false);
  const [amendBusy, setAmendBusy] = useState(false);
  const [amendError, setAmendError] = useState<string | null>(null);
  const currentUser = useAppStore((s) => s.currentUser);
  const isRadiologist = currentUser?.role === "RADIOLOGIST";
  const isAssigned =
    isRadiologist && report
      ? report.authorId === currentUser?.id
      : false;
  const isSigned = report?.status === "SIGNED" || report?.status === "RADIOLOGIST_SIGNED";
  const isEditable = isAssigned && (!isSigned || isAmending);
  const reportKey = report
    ? `${report.id}:${report.version}:${report.status}`
    : null;

  const [clinicalHistory, setClinicalHistory] = useState(
    report?.clinicalHistory ?? "",
  );
  const [findings, setFindings] = useState(report?.findings ?? "");
  const [impression, setImpression] = useState(report?.impression ?? "");
  const [technique, setTechnique] = useState(report?.technique ?? "");
  const [comparison, setComparison] = useState(report?.comparison ?? "");
  const [recommendations, setRecommendations] = useState(
    report?.recommendations ?? "",
  );
  const [criticalFinding, setCriticalFinding] = useState(
    report?.criticalFinding ?? false,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const dirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const lastReportKeyRef = useRef<string | null>(reportKey);

  // Sync form state when the report identity/version changes. Background
  // refreshes must not clobber edits the radiologist is still typing.
  useEffect(() => {
    if (!report) return;
    const key = `${report.id}:${report.version}:${report.status}`;
    const keyChanged = key !== lastReportKeyRef.current;
    if (!keyChanged && dirtyRef.current) return;

    lastReportKeyRef.current = key;
    setClinicalHistory(report.clinicalHistory ?? "");
    setFindings(report.findings ?? "");
    setImpression(report.impression ?? "");
    setTechnique(report.technique ?? "");
    setComparison(report.comparison ?? "");
    setRecommendations(report.recommendations ?? "");
    setCriticalFinding(report.criticalFinding ?? false);
    if (report.status !== "SIGNED" && report.status !== "RADIOLOGIST_SIGNED") {
      setIsAmending(false);
    }
    if (!dirtyRef.current) {
      setSaveStatus("idle");
      setErrorMessage(null);
    }
  }, [report]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleAmend = useCallback(async () => {
    if (amendBusy) return;
    setAmendBusy(true);
    setAmendError(null);
    try {
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/amend`,
        {},
      );
      setIsAmending(true);
      setSaveStatus("idle");
      onAmend?.();
      onReportSaved?.();
    } catch (e) {
      setAmendError(
        (e as { message?: string }).message ?? "Failed to amend report.",
      );
    } finally {
      setAmendBusy(false);
    }
  }, [amendBusy, studyInstanceUid, onAmend, onReportSaved]);

  const saveDraft = useCallback(
    async (fields: ReportFormFields) => {
      if (!mountedRef.current) return;
      const editVersion = editVersionRef.current;
      setSaveStatus("saving");
      setErrorMessage(null);
      try {
        await apiClient.patch(
          `/reports/${encodeURIComponent(studyInstanceUid)}/draft`,
          fields,
        );
        if (!mountedRef.current) return;
        const now = new Date();
        const hh = String(now.getUTCHours()).padStart(2, "0");
        const mm = String(now.getUTCMinutes()).padStart(2, "0");
        const ss = String(now.getUTCSeconds()).padStart(2, "0");
        setSavedAt(`${hh}:${mm}:${ss}`);
        setSaveStatus("saved");
        if (editVersionRef.current === editVersion) {
          dirtyRef.current = false;
        }
        onReportSaved?.();
      } catch (e) {
        if (!mountedRef.current) return;
        setSaveStatus("error");
        setErrorMessage(
          (e as { message?: string }).message ?? "Failed to save draft.",
        );
      }
    },
    [studyInstanceUid, onReportSaved],
  );

  const scheduleAutoSave = useCallback(
    (fields: ReportFormFields) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setSaveStatus("unsaved");
      setErrorMessage(null);
      timerRef.current = setTimeout(() => {
        void saveDraft(fields);
      }, AUTOSAVE_DELAY_MS);
    },
    [saveDraft],
  );

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const updateField = useCallback(
    (
      field: keyof ReportFormFields,
      value: string | boolean,
      current: ReportFormFields,
    ) => {
      if (!isEditable) return;
      switch (field) {
        case "clinicalHistory":
          setClinicalHistory(value as string);
          break;
        case "findings":
          setFindings(value as string);
          break;
        case "impression":
          setImpression(value as string);
          break;
        case "technique":
          setTechnique(value as string);
          break;
        case "comparison":
          setComparison(value as string);
          break;
        case "recommendations":
          setRecommendations(value as string);
          break;
        case "criticalFinding":
          setCriticalFinding(value as boolean);
          break;
      }
      const next = { ...current, [field]: value } as ReportFormFields;
      dirtyRef.current = true;
      editVersionRef.current += 1;
      scheduleAutoSave(next);
    },
    [isEditable, scheduleAutoSave],
  );

  // Build the latest form state for the autosave callback.
  const formState: ReportFormFields = {
    clinicalHistory,
    findings,
    impression,
    technique,
    comparison,
    recommendations,
    criticalFinding,
  };

  if (!report) {
    const isAssigned = isRadiologist && studyInstanceUid; // studyInstanceUid implies we have a study context
    
    return (
      <div className="border-b border-border">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Report
        </button>
        {isOpen && (
          <div className="flex flex-col items-center gap-3 px-4 py-6">
            <FileText size={32} strokeWidth={1} className="text-text-muted" />
            <p className="text-sm text-text-muted">No report yet</p>
            {isAssigned && (
              <button
                type="button"
                onClick={() => {
                  window.location.href = `/reports/${encodeURIComponent(studyInstanceUid)}`;
                }}
                className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
              >
                Create Report
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Report
        <span
          className={clsx(
            "ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
            REPORT_STATUS_STYLES[report.status],
          )}
        >
          {REPORT_STATUS_LABELS[report.status]}
        </span>
      </button>
      {isOpen && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {/* Amend action for signed reports */}
          {isSigned && isAssigned && !isAmending && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleAmend()}
                disabled={amendBusy}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {amendBusy && <Loader2 size={12} className="animate-spin" />}
                Amend Report
              </button>
            </div>
          )}
          {amendError && (
            <p className="text-xs text-error">{amendError}</p>
          )}
          {isAmending && (
            <div className="flex items-center gap-2 text-sm text-accent">
              <span>Amendment mode — editing enabled</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>v{report.version}</span>
            {report.author && (
              <span>
                by {report.author.displayName ?? report.author.email}
              </span>
            )}
          </div>

          {/* --- Clinical History --- */}
          <FieldGroup label="Clinical History">
            <textarea
              value={clinicalHistory}
              onChange={(e) =>
                updateField("clinicalHistory", e.target.value, formState)
              }
              disabled={!isEditable}
              placeholder="Relevant clinical history..."
              rows={2}
              className={fieldClasses}
            />
          </FieldGroup>

          {/* --- Technique --- */}
          <FieldGroup label="Technique">
            <textarea
              value={technique}
              onChange={(e) =>
                updateField("technique", e.target.value, formState)
              }
              disabled={!isEditable}
              placeholder="Imaging technique / protocol..."
              rows={2}
              className={fieldClasses}
            />
          </FieldGroup>

          {/* --- Comparison --- */}
          <FieldGroup label="Comparison">
            <textarea
              value={comparison}
              onChange={(e) =>
                updateField("comparison", e.target.value, formState)
              }
              disabled={!isEditable}
              placeholder="Prior studies for comparison..."
              rows={1}
              className={fieldClasses}
            />
          </FieldGroup>

          {/* --- Findings --- */}
          <FieldGroup label="Findings" required>
            <textarea
              value={findings}
              onChange={(e) =>
                updateField("findings", e.target.value, formState)
              }
              disabled={!isEditable}
              placeholder="Enter radiological findings..."
              rows={6}
              className={fieldClasses}
            />
          </FieldGroup>

          {/* --- Impression --- */}
          <FieldGroup label="Impression" required>
            <textarea
              value={impression}
              onChange={(e) =>
                updateField("impression", e.target.value, formState)
              }
              disabled={!isEditable}
              placeholder="Enter impression / conclusion..."
              rows={4}
              className={fieldClasses}
            />
          </FieldGroup>

          {/* --- Recommendations --- */}
          <FieldGroup label="Recommendations">
            <textarea
              value={recommendations}
              onChange={(e) =>
                updateField("recommendations", e.target.value, formState)
              }
              disabled={!isEditable}
              placeholder="Follow-up / management recommendations..."
              rows={2}
              className={fieldClasses}
            />
          </FieldGroup>

          {/* --- Critical Finding --- */}
          {isEditable ? (
            <div className="mt-2">
              <CriticalFindingToggle
                active={criticalFinding}
                onToggle={() =>
                  updateField(
                    "criticalFinding",
                    !criticalFinding,
                    formState,
                  )
                }
              />
            </div>
          ) : report.criticalFinding ? (
            <div className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2">
              <AlertCircle size={14} className="text-warning" />
              <span className="text-xs font-medium text-warning">
                Critical Finding Flagged
              </span>
            </div>
          ) : null}

          {/* --- Save status bar --- */}
          {isEditable && (
            <div className="flex items-center gap-2 border-t border-border pt-2 text-xs text-text-muted">
              {saveStatus === "saving" && (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Saving...
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <Check size={12} className="text-success" />
                  Saved at {savedAt}
                </>
              )}
              {saveStatus === "unsaved" && "Unsaved changes"}
              {saveStatus === "error" && (
                <span className="text-error">{errorMessage}</span>
              )}
            </div>
          )}

          {/* --- Version History --- */}
          <div className="mt-2">
            <ReportVersionHistoryInline
              studyInstanceUid={studyInstanceUid}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FieldGroup({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      {children}
    </div>
  );
}

const fieldClasses =
  "w-full resize-y rounded-md border border-border/60 bg-editor p-3 font-serif text-sm leading-relaxed text-editor-ink placeholder-editor-ink/40 transition-colors focus:border-accent focus:bg-editor focus:outline-none disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-70";

/**
 * Fetches version history from the API inline (rather than requiring a parent
 * to do it). The existing ReportVersionHistory component takes pre-fetched
 * data; here we do the fetch ourselves.
 */
function ReportVersionHistoryInline({
  studyInstanceUid,
}: {
  studyInstanceUid: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [versions, setVersions] = useState<ReportVersion[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await apiClient.get<{ data: ReportVersion[] }>(
        `/reports/${encodeURIComponent(studyInstanceUid)}/versions`,
      );
      setVersions(res.data ?? []);
      setLoaded(true);
    } catch {
      // silently ignore — version history is informational
    }
  }, [studyInstanceUid, loaded]);

  const toggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) void load();
  }, [expanded, loaded, load]);

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-raised/50"
      >
        {expanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
        Version History
      </button>
      {expanded && (
        <div className="border-t border-border">
          {versions.length === 0 ? (
            <div className="px-3 py-3 text-xs text-text-muted">
              No version history available.
            </div>
          ) : (
            versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-text-primary">
                      v{v.version}
                    </span>
                    <span
                      className={clsx(
                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                        v.status === "SIGNED"
                          ? "bg-accent/10 text-accent"
                          : "bg-surface text-text-muted",
                      )}
                    >
                      {v.status}
                    </span>
                    {v.version > 1 ? (
                      <span className="inline-flex items-center rounded-full bg-error/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-error">
                        Corrected
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium leading-none text-text-muted">
                        Original
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {v.author?.displayName ?? v.author?.email ?? "Unknown"}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] text-text-muted">
                    {formatDateTime(v.createdAt)}
                  </span>
                  <span className="font-mono text-[9px] text-text-muted">
                    {v.contentHash?.slice(0, 12)}...
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
