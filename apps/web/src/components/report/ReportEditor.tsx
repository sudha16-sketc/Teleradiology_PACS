"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Eye, Loader2, Search } from "lucide-react";
import { clsx } from "clsx";
import type {
  ApiError,
  CompanySettings,
  ReportStatus,
  ReportTemplate,
  Study,
} from "@axis/types";
import { CriticalFindingToggle } from "./CriticalFindingToggle";
import { ReportActions } from "./ReportActions";
import { ReportPreview } from "./ReportPreview";
import { RichReportEditor } from "./RichReportEditor";
import { TemplatePreview } from "./TemplatePreview";
import { apiClient } from "@/lib/api-client";
import {
  canAmendReport,
  canEditReportContent,
} from "@/lib/report-access";
import {
  hasReportBodyContent,
  legacyFieldsToHtml,
} from "@/lib/report-html";

interface ReportEditorProps {
  study: Study;
  studyInstanceUid: string;
  reportId: string;
  reportVersion: number;
  initialContentHtml?: string | null;
  initialClinicalHistory?: string;
  initialFindings?: string;
  initialImpression?: string;
  initialTechnique?: string;
  initialComparison?: string;
  initialRecommendations?: string;
  initialCriticalFinding?: boolean;
  status?: ReportStatus;
  isAssigned?: boolean;
  company?: CompanySettings | null;
  onAmend?: () => void;
  onSaved?: () => void;
}

interface TemplateOption {
  id: string;
  name: string;
  contentHtml?: string;
  clinicalHistory?: string;
  findings?: string;
  impression?: string;
  technique?: string;
  comparison?: string;
  recommendations?: string;
}

export function ReportEditor({
  study,
  studyInstanceUid,
  reportId,
  reportVersion,
  initialContentHtml,
  initialClinicalHistory = "",
  initialFindings = "",
  initialImpression = "",
  initialTechnique = "",
  initialComparison = "",
  initialRecommendations = "",
  initialCriticalFinding = false,
  status = "DRAFT",
  isAssigned = true,
  company,
  onAmend,
  onSaved,
}: ReportEditorProps) {
  const fallbackHtml = legacyFieldsToHtml({
    clinicalHistory: initialClinicalHistory,
    findings: initialFindings,
    impression: initialImpression,
    technique: initialTechnique,
    comparison: initialComparison,
    recommendations: initialRecommendations,
  });
  const [contentHtml, setContentHtml] = useState(
    hasReportBodyContent(initialContentHtml) ? initialContentHtml ?? "" : fallbackHtml,
  );
  const [criticalFinding, setCriticalFinding] = useState(initialCriticalFinding);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [previewTemplate, setPreviewTemplate] =
    useState<TemplateOption | null>(null);
  const [reportStatus, setReportStatus] = useState<ReportStatus>(status);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [isAmending, setIsAmending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(reportVersion);

  const isReadOnly = !canEditReportContent(
    reportStatus,
    isAssigned,
    isAmending,
  );
  const canAmend =
    isAssigned &&
    canAmendReport(reportStatus) &&
    study.status === "RADIOLOGIST_SIGNED";
  const isBusy = saving || uploading;

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
            contentHtml: t.contentHtml ?? undefined,
            clinicalHistory: t.clinicalHistory ?? undefined,
            findings: t.findings ?? undefined,
            impression: t.impression ?? undefined,
            technique: t.technique ?? undefined,
            comparison: t.comparison ?? undefined,
            recommendations: t.recommendations ?? undefined,
          }));
          setTemplates(templateOptions);
        }
      })
      .catch(() => {
        if (mounted) setTemplates([]);
      })
      .finally(() => {
        if (mounted) setTemplatesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [studyInstanceUid]);

  const applyTemplate = (template: TemplateOption) => {
    const html = template.contentHtml?.trim()
      ? template.contentHtml
      : legacyFieldsToHtml(template);
    setContentHtml(html);
    setSelectedTemplateId(template.id);
    setPreviewTemplate(null);
    setTemplateOpen(false);
  };

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) =>
      template.name.toLowerCase().includes(query),
    );
  }, [templates, templateSearch]);

  const persistDraft = async (announceSaved: boolean) => {
    try {
      await apiClient.post(`/reports/${encodeURIComponent(studyInstanceUid)}`, {
        contentHtml,
        criticalFinding,
      });
      if (announceSaved) setNotice("Draft saved.");
      onSaved?.();
      return true;
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : (e as ApiError)?.message;
      setNotice(message ?? "Failed to save draft.");
      return false;
    }
  };

  const saveDraft = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await persistDraft(true);
    } finally {
      setSaving(false);
    }
  };

  const signOff = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await persistDraft(false);
      if (!saved) return;
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/sign`,
        {},
      );
      setReportStatus("SIGNED");
      setNotice("Report signed off.");
      onSaved?.();
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : (e as ApiError)?.message;
      setNotice(message ?? "Failed to sign off.");
    } finally {
      setSaving(false);
    }
  };

  const amend = async () => {
    const reason = window.prompt("Reason for amendment")?.trim();
    if (!reason) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/amend`,
        { reason },
      );
      setIsAmending(true);
      setReportStatus("DRAFT");
      setCurrentVersion((version) => version + 1);
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
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-raised px-6 py-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setTemplateOpen(!templateOpen)}
            disabled={isReadOnly || templatesLoading || templates.length === 0}
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
                {templates.find((t) => t.id === selectedTemplateId)?.name ??
                  "Insert template"}
                <ChevronDown size={14} className="text-text-muted" />
              </>
            )}
          </button>
          {!templatesLoading && templateOpen && templates.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-md border border-border bg-surface shadow-lg">
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                  />
                  <input
                    type="text"
                    value={templateSearch}
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    placeholder="Search templates..."
                    className="w-full rounded-md border border-border bg-editor py-1.5 pl-8 pr-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
              {filteredTemplates.length === 0 ? (
                <p className="px-3 py-3 text-xs text-text-muted">
                  No templates match your search.
                </p>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  {filteredTemplates.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center border-b border-border/50 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => applyTemplate(t)}
                        className={clsx(
                          "flex min-w-0 flex-1 items-center px-3 py-2 text-left text-sm transition-colors hover:bg-surface-raised",
                          t.id === selectedTemplateId
                            ? "text-accent"
                            : "text-text-primary",
                        )}
                      >
                        <span className="truncate">{t.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewTemplate(t)}
                        className="mr-2 rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
                        aria-label={`Preview ${t.name}`}
                        title="Preview template"
                      >
                        <Eye size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-text-muted">Report Template</span>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            disabled={!contentHtml.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Eye size={14} />
            Preview
          </button>
          <span className="font-mono text-[10px] text-text-muted">
            {reportId}
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {reportStatus.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-editor">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-editor-ink/60">
            <span className="font-mono">
              Patient UID: {study.patient?.patientId ?? "—"}
            </span>
            <span className="font-mono">
              Study UID: {study.studyInstanceUid}
            </span>
          </div>

          <RichReportEditor
            value={contentHtml}
            onChange={setContentHtml}
            studyUid={studyInstanceUid}
            disabled={isReadOnly}
            enableImages
            minHeight={420}
            onUploadingChange={setUploading}
          />

          <div className="mt-6">
            <CriticalFindingToggle
              active={criticalFinding}
              onToggle={() => !isReadOnly && setCriticalFinding(!criticalFinding)}
              disabled={isReadOnly}
            />
          </div>
        </div>
      </div>

      {notice && (
        <div className="border-t border-border px-6 py-2 text-xs text-text-muted">
          {notice}
        </div>
      )}

      {isBusy ? (
        <div className="flex items-center gap-2 border-t border-border px-6 py-4 text-sm text-text-muted">
          <Loader2 size={15} className="animate-spin" />
          {uploading ? "Uploading image..." : "Saving..."}
        </div>
      ) : (
        <ReportActions
          status={reportStatus}
          studyStatus={study.status}
          disabled={isReadOnly && !canAmend}
          onSaveDraft={saveDraft}
          onSignOff={signOff}
          onAmend={canAmend ? amend : undefined}
        />
      )}

      {previewOpen && (
        <ReportPreview
          study={study}
          reportId={reportId}
          reportVersion={currentVersion}
          contentHtml={contentHtml}
          company={company}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {previewTemplate && (
        <TemplatePreview
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onUse={() => applyTemplate(previewTemplate)}
        />
      )}
    </div>
  );
}
