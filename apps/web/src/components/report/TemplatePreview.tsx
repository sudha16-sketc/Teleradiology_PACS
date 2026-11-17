"use client";

import { useEffect } from "react";
import { FolderOpen, X } from "lucide-react";
import { legacyFieldsToHtml, sanitizeReportHtml } from "@/lib/report-html";

export interface TemplatePreviewData {
  id: string;
  name: string;
  description?: string | null;
  modality?: string | null;
  subspecialty?: string | null;
  bodyPart?: string | null;
  contentHtml?: string | null;
  clinicalHistory?: string | null;
  findings?: string | null;
  impression?: string | null;
  technique?: string | null;
  comparison?: string | null;
  recommendations?: string | null;
}

interface TemplatePreviewProps {
  template: TemplatePreviewData;
  onClose: () => void;
  onUse?: () => void;
}

export function TemplatePreview({
  template,
  onClose,
  onUse,
}: TemplatePreviewProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const html = template.contentHtml?.trim()
    ? template.contentHtml
    : legacyFieldsToHtml({
        clinicalHistory: template.clinicalHistory ?? undefined,
        findings: template.findings ?? undefined,
        impression: template.impression ?? undefined,
        technique: template.technique ?? undefined,
        comparison: template.comparison ?? undefined,
        recommendations: template.recommendations ?? undefined,
      });
  const safeHtml = sanitizeReportHtml(html);
  const meta = [template.modality, template.bodyPart, template.subspecialty]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Template preview"
    >
      <div className="w-full max-w-[760px]">
        <div className="mb-3 flex items-center justify-between rounded-md bg-surface px-4 py-2 shadow-lg">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">
              {template.name}
            </p>
            {meta && (
              <p className="mt-0.5 truncate text-xs text-text-muted">{meta}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onUse && (
              <button
                type="button"
                onClick={onUse}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-accent/90"
              >
                <FolderOpen size={14} />
                Use Template
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close template preview"
              className="rounded-md border border-border p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="report-paper mx-auto bg-white px-10 py-8 text-neutral-900 shadow-2xl">
          <header className="border-b-2 border-neutral-800 pb-3">
            <h2 className="text-lg font-bold tracking-wide">
              {template.name}
            </h2>
            {template.description && (
              <p className="mt-1 text-[12px] text-neutral-600">
                {template.description}
              </p>
            )}
          </header>

          {safeHtml.trim() ? (
            <article
              className="report-paper-content min-h-[320px] py-5 font-serif text-[13px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <p className="py-8 text-sm text-neutral-500">
              This template has no content yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
