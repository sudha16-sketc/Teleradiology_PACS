"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { clsx } from "clsx";
import type {
  CompanySettings,
  Report,
  ReportStatus,
  ReportVersion,
  Study,
} from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { formatDateTime } from "@/lib/format";
import {
  canEditReportContent,
  isSignedReportStatus,
} from "@/lib/report-access";
import { reportBodyHtml } from "@/lib/report-html";
import { CriticalFindingToggle } from "@/components/report/CriticalFindingToggle";
import { ReportPreview } from "@/components/report/ReportPreview";
import { RichReportEditor } from "@/components/report/RichReportEditor";

interface ReportPanelProps {
  studyInstanceUid: string;
  report: Report | null;
  study?: Study;
  onReportSaved?: () => void;
  onAmend?: () => void;
  registerSaveFlush?: (flush: (() => Promise<boolean>) | null) => void;
}

type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

interface ReportFormFields {
  contentHtml: string;
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

function reportBody(report: Report | null): string {
  if (!report) return "";
  return reportBodyHtml(report);
}

export function ReportPanel({
  studyInstanceUid,
  report,
  study,
  onReportSaved,
  onAmend,
  registerSaveFlush,
}: ReportPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isAmending, setIsAmending] = useState(false);
  const [amendBusy, setAmendBusy] = useState(false);
  const [amendError, setAmendError] = useState<string | null>(null);
  const currentUser = useAppStore((s) => s.currentUser);
  const isRadiologist = currentUser?.role === "RADIOLOGIST";
  const isAssigned =
    isRadiologist && report ? report.authorId === currentUser?.id : false;
  const isSigned = report ? isSignedReportStatus(report.status) : false;
  const isEditable = report
    ? canEditReportContent(report.status, isAssigned, isAmending)
    : false;
  const reportKey = report
    ? `${report.id}:${report.version}:${report.status}`
    : null;

  const [contentHtml, setContentHtml] = useState(reportBody(report));
  const [criticalFinding, setCriticalFinding] = useState(
    report?.criticalFinding ?? false,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [uploading, setUploading] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const dirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const lastReportKeyRef = useRef<string | null>(reportKey);
  const latestFieldsRef = useRef<ReportFormFields>({
    contentHtml: reportBody(report),
    criticalFinding: report?.criticalFinding ?? false,
  });
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true));

  // Sync form state when the report identity/version changes. Background
  // refreshes must not clobber edits the radiologist is still typing.
  useEffect(() => {
    if (!report) return;
    const key = `${report.id}:${report.version}:${report.status}`;
    const keyChanged = key !== lastReportKeyRef.current;
    if (!keyChanged && dirtyRef.current) return;

    const body = reportBody(report);
    lastReportKeyRef.current = key;
    setContentHtml(body);
    setCriticalFinding(report.criticalFinding ?? false);
    latestFieldsRef.current = {
      contentHtml: body,
      criticalFinding: report.criticalFinding ?? false,
    };
    if (!isSignedReportStatus(report.status)) {
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

  useEffect(() => {
    let mounted = true;
    apiClient
      .get<{ data: CompanySettings | null }>("/company-settings")
      .then((res) => {
        if (mounted) setCompany(res.data ?? null);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const handleAmend = useCallback(async () => {
    if (amendBusy) return;
    const reason = window.prompt("Reason for amendment")?.trim();
    if (!reason) return;
    setAmendBusy(true);
    setAmendError(null);
    try {
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/amend`,
        { reason },
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
      if (!mountedRef.current) return false;
      const editVersion = editVersionRef.current;
      setSaveStatus("saving");
      setErrorMessage(null);
      try {
        await apiClient.patch(
          `/reports/${encodeURIComponent(studyInstanceUid)}/draft`,
          fields,
        );
        if (!mountedRef.current) return false;
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
        return true;
      } catch (e) {
        if (!mountedRef.current) return false;
        setSaveStatus("error");
        setErrorMessage(
          (e as { message?: string }).message ?? "Failed to save draft.",
        );
        return false;
      }
    },
    [studyInstanceUid, onReportSaved],
  );

  const enqueueSave = useCallback(() => {
    const task = saveChainRef.current.then(() => {
      const fields = latestFieldsRef.current;
      return saveDraft(fields);
    });
    saveChainRef.current = task.catch(() => false);
    return task;
  }, [saveDraft]);

  const flushPendingSave = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return enqueueSave();
  }, [enqueueSave]);

  useEffect(() => {
    if (!registerSaveFlush) return;
    registerSaveFlush(() => flushPendingSave());
    return () => registerSaveFlush(null);
  }, [registerSaveFlush, flushPendingSave]);

  const scheduleAutoSave = useCallback(
    (fields: ReportFormFields) => {
      latestFieldsRef.current = fields;
      if (timerRef.current) clearTimeout(timerRef.current);
      setSaveStatus("unsaved");
      setErrorMessage(null);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void enqueueSave();
      }, AUTOSAVE_DELAY_MS);
    },
    [enqueueSave],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const updateContent = useCallback(
    (html: string) => {
      if (!isEditable) return;
      setContentHtml(html);
      dirtyRef.current = true;
      editVersionRef.current += 1;
      scheduleAutoSave({ contentHtml: html, criticalFinding });
    },
    [isEditable, scheduleAutoSave, criticalFinding],
  );

  const updateCriticalFinding = useCallback(() => {
    if (!isEditable) return;
    const next = !criticalFinding;
    setCriticalFinding(next);
    dirtyRef.current = true;
    editVersionRef.current += 1;
    scheduleAutoSave({ contentHtml, criticalFinding: next });
  }, [isEditable, criticalFinding, contentHtml, scheduleAutoSave]);

  if (!report) {
    const canCreate = isRadiologist && studyInstanceUid;

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
            {canCreate && (
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
            {canCreate && (
              <p className="text-center text-[11px] text-text-muted">
                Choose a custom rich report or start from a saved template.
              </p>
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
          {isSigned &&
            isAssigned &&
            study?.status === "RADIOLOGIST_SIGNED" &&
            !isAmending && (
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
          {amendError && <p className="text-xs text-error">{amendError}</p>}
          {isAmending && (
            <div className="flex items-center gap-2 text-sm text-accent">
              <span>Amendment mode - editing enabled</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>v{report.version}</span>
            {report.author && (
              <span>
                by {report.author.displayName ?? report.author.email}
              </span>
            )}
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              disabled={!contentHtml.trim() || !study}
              className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Eye size={12} />
              Preview
            </button>
          </div>

          <RichReportEditor
            value={contentHtml}
            onChange={updateContent}
            studyUid={studyInstanceUid}
            disabled={!isEditable}
            enableImages={isEditable}
            minHeight={300}
            onUploadingChange={setUploading}
          />

          {isEditable ? (
            <div className="mt-1">
              <CriticalFindingToggle
                active={criticalFinding}
                onToggle={updateCriticalFinding}
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

          {isEditable && (
            <div className="flex items-center gap-2 border-t border-border pt-2 text-xs text-text-muted">
              {uploading && (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Uploading image...
                </>
              )}
              {!uploading && saveStatus === "saving" && (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Saving...
                </>
              )}
              {!uploading && saveStatus === "saved" && (
                <>
                  <Check size={12} className="text-success" />
                  Saved at {savedAt}
                </>
              )}
              {!uploading && saveStatus === "unsaved" && "Unsaved changes"}
              {!uploading && saveStatus === "error" && (
                <span className="text-error">{errorMessage}</span>
              )}
            </div>
          )}

          <div className="mt-2">
            <ReportVersionHistoryInline studyInstanceUid={studyInstanceUid} />
          </div>
        </div>
      )}

      {previewOpen && study && (
        <ReportPreview
          study={study}
          reportId={report.id}
          reportVersion={report.version}
          contentHtml={contentHtml}
          company={company}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

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
      // silently ignore - version history is informational
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
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
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
