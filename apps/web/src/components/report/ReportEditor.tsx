"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import type { ReportStatus } from "@axis/types";
import { CriticalFindingToggle } from "./CriticalFindingToggle";
import { ReportActions } from "./ReportActions";
import { ReportVersionHistory } from "./ReportVersionHistory";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

interface ReportEditorProps {
  studyInstanceUid: string;
  initialFindings?: string;
  initialImpression?: string;
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
  initialFindings = "",
  initialImpression = "",
  initialCriticalFinding = false,
  status = "DRAFT",
}: ReportEditorProps) {
  const currentUser = useAppStore((s) => s.currentUser);
  const [findings, setFindings] = useState(initialFindings);
  const [impression, setImpression] = useState(initialImpression);
  const [criticalFinding, setCriticalFinding] = useState(initialCriticalFinding);
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<ReportStatus>(status);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const authorId = currentUser?.id ?? "";

  const saveDraft = async () => {
    if (!authorId) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.post(`/reports/${encodeURIComponent(studyInstanceUid)}`, {
        authorId,
        findings,
        impression,
        criticalFinding,
      });
      setNotice("Draft saved.");
    } catch (e: any) {
      setNotice(e?.message ?? "Failed to save draft.");
    } finally {
      setSaving(false);
    }
  };

  const submitSignoff = async () => {
    if (!authorId) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.post(`/reports/${encodeURIComponent(studyInstanceUid)}`, {
        authorId,
        findings,
        impression,
        criticalFinding,
      });
      setReportStatus("PENDING_SIGNOFF");
      setNotice("Report submitted for sign-off.");
    } catch (e: any) {
      setNotice(e?.message ?? "Failed to submit for sign-off.");
    } finally {
      setSaving(false);
    }
  };

  const signOff = async () => {
    if (!authorId) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.post(`/reports/${encodeURIComponent(studyInstanceUid)}`, {
        authorId,
        findings,
        impression,
        criticalFinding,
      });
      await apiClient.post(`/reports/${encodeURIComponent(studyInstanceUid)}/sign`, {
        signedOffBy: authorId,
      });
      setReportStatus("FINAL");
      setNotice("Report signed off and finalized.");
    } catch (e: any) {
      setNotice(e?.message ?? "Failed to sign off.");
    } finally {
      setSaving(false);
    }
  };

  const amend = async () => {
    if (!authorId) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiClient.post(`/reports/${encodeURIComponent(studyInstanceUid)}/amend`, {
        authorId,
        findings,
        impression,
      });
      setReportStatus("AMENDED");
      setNotice("Report amended.");
    } catch (e: any) {
      setNotice(e?.message ?? "Failed to amend.");
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
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
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

      <div className="flex-1 overflow-y-auto bg-[#F6F4EF]">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <div className="font-serif">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-muted">
              Findings
            </label>
            <textarea
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder="Enter radiological findings..."
              className="w-full resize-y rounded-md border border-border/60 bg-white/70 p-4 font-serif text-sm leading-relaxed text-text-primary placeholder-text-muted/50 transition-colors focus:border-accent focus:bg-white focus:outline-none"
              style={{ minHeight: 200 }}
            />
            <div className="mt-1 text-right text-xs text-text-muted">
              {findings.length} characters
            </div>

            <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wider text-text-muted">
              Impression
            </label>
            <textarea
              value={impression}
              onChange={(e) => setImpression(e.target.value)}
              placeholder="Enter impression / conclusion..."
              className="w-full resize-y rounded-md border border-border/60 bg-white/70 p-4 font-serif text-sm leading-relaxed text-text-primary placeholder-text-muted/50 transition-colors focus:border-accent focus:bg-white focus:outline-none"
              style={{ minHeight: 200 }}
            />
            <div className="mt-1 text-right text-xs text-text-muted">
              {impression.length} characters
            </div>
          </div>

          <div className="mt-6">
            <CriticalFindingToggle
              active={criticalFinding}
              onToggle={() => setCriticalFinding(!criticalFinding)}
            />
          </div>

          <div className="mt-6">
            <ReportVersionHistory />
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
          onSaveDraft={saveDraft}
          onSubmitSignoff={submitSignoff}
          onSignOff={signOff}
          onAmend={amend}
        />
      )}
    </div>
  );
}
