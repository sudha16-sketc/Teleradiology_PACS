"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import type { ApiError, ReportStatus, ReportTemplate } from "@axis/types";
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
  onAmend?: () => void;
}

interface TemplateOption {
  id: string;
  name: string;
  clinicalHistory?: string;
  findings?: string;
  impression?: string;
  technique?: string;
  comparison?: string;
  recommendations?: string;
}

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
  onAmend,
}: ReportEditorProps) {
  const [clinicalHistory, setClinicalHistory] = useState(initialClinicalHistory);
  const [findings, setFindings] = useState(initialFindings);
  const [impression, setImpression] = useState(initialImpression);
  const [technique, setTechnique] = useState(initialTechnique);
  const [comparison, setComparison] = useState(initialComparison);
  const [recommendations, setRecommendations] = useState(initialRecommendations);
  const [criticalFinding, setCriticalFinding] = useState(initialCriticalFinding);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<ReportStatus>(status);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [isAmending, setIsAmending] = useState(false);

  const isSigned = (reportStatus === "SIGNED" || reportStatus === "RADIOLOGIST_SIGNED") && !isAmending;

  const contentFields = {
    clinicalHistory,
    findings,
    impression,
    technique,
    comparison,
    recommendations,
    criticalFinding,
  };

  useEffect(() => {
    let mounted = true;
    setTemplatesLoading(true);
    apiClient
      .get<{ data: ReportTemplate[] }>(
        `/templates/for-study/${encodeURIComponent(studyInstanceUid)}`,
      )
      .then((res) => {
        if (mounted) {
          const templateOptions: TemplateOption[] = (res.data ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            clinicalHistory: t.clinicalHistory ?? undefined,
            findings: t.findings ?? undefined,
            impression: t.impression ?? undefined,
            technique: t.technique ?? undefined,
            comparison: t.comparison ?? undefined,
            recommendations: t.recommendations ?? undefined,
          }));
          setTemplates(templateOptions);
          if (templateOptions.length > 0 && !selectedTemplateId) {
            setSelectedTemplateId(templateOptions[0].id);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setTemplates([]);
        }
      })
      .finally(() => {
        if (mounted) setTemplatesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [studyInstanceUid, selectedTemplateId]);

  const applyTemplate = (template: TemplateOption) => {
    if (template.clinicalHistory !== undefined) setClinicalHistory(template.clinicalHistory);
    if (template.findings !== undefined) setFindings(template.findings);
    if (template.impression !== undefined) setImpression(template.impression);
    if (template.technique !== undefined) setTechnique(template.technique);
    if (template.comparison !== undefined) setComparison(template.comparison);
    if (template.recommendations !== undefined) setRecommendations(template.recommendations);
    setSelectedTemplateId(template.id);
  };

  const saveDraft = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}`,
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

  const signOff = async () => {
    setSaving(true);
    setNotice(null);
    try {
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
        {},
      );
      setIsAmending(true);
      setReportStatus("DRAFT");
      setNotice("Report amended. You can now edit and save as draft.");
      onAmend?.();
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
            disabled={isSigned || templatesLoading || templates.length === 0}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            {templatesLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Loading templates...
              </>
            ) : templates.length === 0 ? (
              "No templates available"
            ) : (
              <>
                {templates.find((t) => t.id === selectedTemplateId)?.name ?? "Select template"}
                <ChevronDown size={14} className="text-text-muted" />
              </>
            )}
          </button>
          {!templatesLoading && templateOpen && templates.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-border bg-surface shadow-lg">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    applyTemplate(t);
                    setTemplateOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-surface-raised",
                    t.id === selectedTemplateId
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
