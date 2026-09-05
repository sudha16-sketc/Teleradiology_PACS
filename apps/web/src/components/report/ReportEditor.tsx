"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import type { ApiError, ReportStatus } from "@axis/types";
import { CriticalFindingToggle } from "./CriticalFindingToggle";
import { ReportActions } from "./ReportActions";
import { apiClient } from "@/lib/api-client";

interface ReportEditorProps {
  studyInstanceUid: string;
  initialClinicalHistory?: string;
  initialFindings?: string;
  initialImpression?: string;
  initialTechnique?: string;
  initialComparison?: string;
  initialRecommendations?: string;
  initialCriticalFinding?: boolean;
  status?: ReportStatus;
}

const TEMPLATES = [
  { id: "general", name: "General Radiology" },
  { id: "chest-ct", name: "CT Chest" },
  { id: "msk", name: "MSK Study" },
];

export function ReportEditor({
  studyInstanceUid,
  initialClinicalHistory = "",
  initialFindings = "",
  initialImpression = "",
  initialTechnique = "",
  initialComparison = "",
  initialRecommendations = "",
  initialCriticalFinding = false,
  status = "DRAFT",
}: ReportEditorProps) {
  const [clinicalHistory, setClinicalHistory] = useState(initialClinicalHistory);
  const [findings, setFindings] = useState(initialFindings);
  const [impression, setImpression] = useState(initialImpression);
  const [technique, setTechnique] = useState(initialTechnique);
  const [comparison, setComparison] = useState(initialComparison);
  const [recommendations, setRecommendations] = useState(initialRecommendations);
  const [criticalFinding, setCriticalFinding] = useState(initialCriticalFinding);
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<ReportStatus>(status);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isSigned = reportStatus === "SIGNED";

  const contentFields = {
    clinicalHistory,
    findings,
    impression,
    technique,
    comparison,
    recommendations,
    criticalFinding,
  };

  const saveDraft = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.patch(
        `/reports/${encodeURIComponent(studyInstanceUid)}/draft`,
        contentFields,
      );
      setNotice("Draft saved.");
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : (e as ApiError)?.message;
      setNotice(message ?? "Failed to save draft.");
    } finally {
      setSaving(false);
    }
  };

  const submitSignoff = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.patch(
        `/reports/${encodeURIComponent(studyInstanceUid)}/draft`,
        contentFields,
      );
      setReportStatus("DRAFT");
      setNotice("Report submitted for sign-off.");
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : (e as ApiError)?.message;
      setNotice(message ?? "Failed to submit for sign-off.");
    } finally {
      setSaving(false);
    }
  };

  const signOff = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.patch(
        `/reports/${encodeURIComponent(studyInstanceUid)}/draft`,
        contentFields,
      );
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/sign`,
        {},
      );
      setReportStatus("SIGNED");
      setNotice("Report signed off.");
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : (e as ApiError)?.message;
      setNotice(message ?? "Failed to sign off.");
    } finally {
      setSaving(false);
    }
  };

  const amend = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/amend`,
        contentFields,
      );
      setReportStatus("DRAFT");
      setNotice("Report amended.");
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : (e as ApiError)?.message;
      setNotice(message ?? "Failed to amend.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-6 py-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setTemplateOpen(!templateOpen)}
            disabled={isSigned}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            {TEMPLATES.find((t) => t.id === selectedTemplate)?.name ?? "Template"}
            <ChevronDown size={14} className="text-text-muted" />
          </button>
          {templateOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-md border border-border bg-surface shadow-lg">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedTemplate(t.id);
                    setTemplateOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-surface-raised",
                    t.id === selectedTemplate
                      ? "text-accent"
                      : "text-text-primary",
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-text-muted">Report Template</span>
        <span className="ml-auto text-xs font-medium uppercase tracking-wider text-text-muted">
          {reportStatus.replace(/_/g, " ")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto bg-editor">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <div className="font-serif">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-editor-ink/60">
              Clinical History
            </label>
            <textarea
              value={clinicalHistory}
              onChange={(e) => setClinicalHistory(e.target.value)}
              disabled={isSigned}
              placeholder="Relevant clinical history..."
              className={clsx(textareaClasses, isSigned && disabledClasses)}
              rows={3}
            />

            <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wider text-editor-ink/60">
              Technique
            </label>
            <textarea
              value={technique}
              onChange={(e) => setTechnique(e.target.value)}
              disabled={isSigned}
              placeholder="Imaging technique / protocol..."
              className={clsx(textareaClasses, isSigned && disabledClasses)}
              rows={2}
            />

            <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wider text-editor-ink/60">
              Comparison
            </label>
            <textarea
              value={comparison}
              onChange={(e) => setComparison(e.target.value)}
              disabled={isSigned}
              placeholder="Prior studies for comparison..."
              className={clsx(textareaClasses, isSigned && disabledClasses)}
              rows={2}
            />

            <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wider text-editor-ink/60">
              Findings <span className="text-error">*</span>
            </label>
            <textarea
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              disabled={isSigned}
              placeholder="Enter radiological findings..."
              className={clsx(textareaClasses, isSigned && disabledClasses)}
              style={{ minHeight: 200 }}
            />
            <div className="mt-1 text-right text-xs text-editor-ink/50">
              {findings.length} characters
            </div>

            <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wider text-editor-ink/60">
              Impression <span className="text-error">*</span>
            </label>
            <textarea
              value={impression}
              onChange={(e) => setImpression(e.target.value)}
              disabled={isSigned}
              placeholder="Enter impression / conclusion..."
              className={clsx(textareaClasses, isSigned && disabledClasses)}
              style={{ minHeight: 200 }}
            />
            <div className="mt-1 text-right text-xs text-editor-ink/50">
              {impression.length} characters
            </div>

            <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wider text-editor-ink/60">
              Recommendations
            </label>
            <textarea
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              disabled={isSigned}
              placeholder="Follow-up / management recommendations..."
              className={clsx(textareaClasses, isSigned && disabledClasses)}
              rows={3}
            />
          </div>

          <div className="mt-6">
            <CriticalFindingToggle
              active={criticalFinding}
              onToggle={() => !isSigned && setCriticalFinding(!criticalFinding)}
              disabled={isSigned}
            />
          </div>
        </div>
      </div>

      {notice && (
        <div className="border-t border-border px-6 py-2 text-xs text-text-muted">
          {notice}
        </div>
      )}

      {saving ? (
        <div className="flex items-center gap-2 border-t border-border px-6 py-4 text-sm text-text-muted">
          <Loader2 size={15} className="animate-spin" />
          Saving...
        </div>
      ) : (
        <ReportActions
          status={reportStatus}
          disabled={isSigned}
          onSaveDraft={saveDraft}
          onSubmitSignoff={submitSignoff}
          onSignOff={signOff}
          onAmend={amend}
        />
      )}
    </div>
  );
}

const textareaClasses =
  "w-full resize-y rounded-md border border-border/60 bg-editor p-4 font-serif text-sm leading-relaxed text-editor-ink placeholder-editor-ink/40 transition-colors focus:border-accent focus:bg-editor focus:outline-none";
const disabledClasses = "cursor-not-allowed bg-surface opacity-70";
