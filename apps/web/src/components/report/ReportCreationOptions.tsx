"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, FilePlus2, FolderOpen, Loader2, Search } from "lucide-react";
import type { ApiError, Report, ReportTemplate } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { legacyFieldsToHtml } from "@/lib/report-html";
import { TemplatePreview } from "./TemplatePreview";

interface ReportCreationOptionsProps {
  studyInstanceUid: string;
  onCreated: (report: Report) => void;
}

const BLANK_REPORT_HTML = [
  "<h2>Clinical History</h2><p><br /></p>",
  "<h2>Technique</h2><p><br /></p>",
  "<h2>Comparison</h2><p><br /></p>",
  "<h2>Findings</h2><p><br /></p>",
  "<h2>Impression</h2><p><br /></p>",
  "<h2>Recommendations</h2><p><br /></p>",
].join("");

export function ReportCreationOptions({
  studyInstanceUid,
  onCreated,
}: ReportCreationOptionsProps) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [previewTemplate, setPreviewTemplate] = useState<ReportTemplate | null>(
    null,
  );
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiClient
      .get<{ data: ReportTemplate[] }>(
        `/templates/for-study/${encodeURIComponent(studyInstanceUid)}`,
      )
      .then((res) => {
        if (mounted) setTemplates(res.data ?? []);
      })
      .catch(() => {
        if (mounted) setTemplates([]);
      })
      .finally(() => {
        if (mounted) setLoadingTemplates(false);
      });
    return () => {
      mounted = false;
    };
  }, [studyInstanceUid]);

  const create = async (
    key: string,
    payload: Record<string, unknown>,
  ) => {
    setCreating(key);
    setError(null);
    try {
      const res = await apiClient.post<{ data: Report }>(
        `/reports/${encodeURIComponent(studyInstanceUid)}`,
        payload,
      );
      onCreated(res.data);
    } catch (e) {
      setError((e as ApiError)?.message ?? "Failed to create report.");
    } finally {
      setCreating(null);
    }
  };

  const createCustom = () =>
    create("custom", {
      contentHtml: BLANK_REPORT_HTML,
      criticalFinding: false,
    });

  const createFromTemplate = (template: ReportTemplate) =>
    create(template.id, {
      contentHtml: template.contentHtml?.trim()
        ? template.contentHtml
        : legacyFieldsToHtml(template),
      clinicalHistory: template.clinicalHistory ?? "",
      findings: template.findings ?? "",
      impression: template.impression ?? "",
      technique: template.technique ?? "",
      comparison: template.comparison ?? "",
      recommendations: template.recommendations ?? "",
      criticalFinding: false,
    });

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) =>
      [
        template.name,
        template.description,
        template.modality,
        template.subspecialty,
        template.bodyPart,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [templates, templateSearch]);

  return (
    <div className="mx-auto w-full max-w-2xl rounded-md border border-border bg-surface p-8">
      <div className="text-center">
        <FilePlus2 size={30} className="mx-auto text-accent" strokeWidth={1.5} />
        <h1 className="mt-3 font-heading text-lg font-bold text-text-primary">
          Create a report
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Start with a structured blank report or pre-populate the editor from a
          saved template.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={createCustom}
          disabled={creating !== null}
          className="flex flex-col items-start rounded-md border border-border bg-surface-raised p-5 text-left transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FilePlus2 size={20} className="text-accent" />
          <span className="mt-3 text-sm font-semibold text-text-primary">
            Custom Report
          </span>
          <span className="mt-1 text-xs leading-relaxed text-text-muted">
            Open the rich editor with standard report headings. Write any
            findings, impression, formatting, tables and images.
          </span>
          {creating === "custom" && (
            <Loader2 size={14} className="mt-3 animate-spin text-accent" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setShowTemplates((value) => !value)}
          disabled={creating !== null || loadingTemplates}
          className="flex flex-col items-start rounded-md border border-border bg-surface-raised p-5 text-left transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FolderOpen size={20} className="text-accent" />
          <span className="mt-3 text-sm font-semibold text-text-primary">
            Use Template
          </span>
          <span className="mt-1 text-xs leading-relaxed text-text-muted">
            Choose a saved template. Its content and formatting are inserted
            into the editor where you can review and edit it.
          </span>
          {loadingTemplates && (
            <Loader2 size={14} className="mt-3 animate-spin text-accent" />
          )}
        </button>
      </div>

      {showTemplates && !loadingTemplates && (
        <div className="mt-5 rounded-md border border-border">
          <div className="border-b border-border bg-surface-raised px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Select a template
          </div>
          {templates.length === 0 ? (
            <p className="px-4 py-5 text-sm text-text-muted">
              No active templates are available for this study. Use a custom
              report instead.
            </p>
          ) : (
            <>
              <div className="border-b border-border p-3">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                  />
                  <input
                    type="text"
                    value={templateSearch}
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    placeholder="Search templates by name, modality, or body part..."
                    className="w-full rounded-md border border-border bg-editor py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
              {filteredTemplates.length === 0 ? (
                <p className="px-4 py-5 text-sm text-text-muted">
                  No templates match “{templateSearch}”.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {filteredTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center border-b border-border last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => createFromTemplate(template)}
                        disabled={creating !== null}
                        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary">
                            {template.name}
                          </p>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {[template.modality, template.bodyPart, template.subspecialty]
                              .filter(Boolean)
                              .join(" · ") ||
                              template.description ||
                              "General template"}
                          </p>
                        </div>
                        {creating === template.id ? (
                          <Loader2 size={14} className="animate-spin text-accent" />
                        ) : (
                          <FolderOpen size={14} className="text-text-muted" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewTemplate(template)}
                        className="mr-3 rounded-md border border-border p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
                        aria-label={`Preview ${template.name}`}
                        title="Preview template"
                      >
                        <Eye size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {previewTemplate && (
        <TemplatePreview
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onUse={() => {
            const template = previewTemplate;
            setPreviewTemplate(null);
            void createFromTemplate(template);
          }}
        />
      )}
    </div>
  );
}
