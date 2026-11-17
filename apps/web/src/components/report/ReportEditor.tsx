"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  FileText,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import { clsx } from "clsx";
import type { Editor } from "@tiptap/core";
import type { ReportRichContent, ReportStatus, Study } from "@axis/types";
import {
  buildReportRichContent,
  extractReportRichFields,
  isReportRichContent,
} from "@axis/types";
import { CriticalFindingToggle } from "./CriticalFindingToggle";
import { ReportActions } from "./ReportActions";
import { ReportDocumentCanvas } from "./ReportDocumentCanvas";
import { apiClient } from "@/lib/api-client";

interface ReportEditorProps {
  study: Study;
  studyInstanceUid: string;
  initialClinicalHistory?: string;
  initialFindings?: string;
  initialImpression?: string;
  initialTechnique?: string;
  initialComparison?: string;
  initialRecommendations?: string;
  initialRichContent?: ReportRichContent | null;
  initialCriticalFinding?: boolean;
  status?: ReportStatus;
  hasSavedReport?: boolean;
}

const FONT_FAMILIES = [
  { value: "", label: "Report font" },
  { value: "Arial", label: "Arial" },
  { value: "Calibri", label: "Calibri" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Verdana", label: "Verdana" },
];

export function ReportEditor({
  study,
  studyInstanceUid,
  initialClinicalHistory = "",
  initialFindings = "",
  initialImpression = "",
  initialTechnique = "",
  initialComparison = "",
  initialRecommendations = "",
  initialRichContent,
  initialCriticalFinding = false,
  status = "DRAFT",
  hasSavedReport = false,
}: ReportEditorProps) {
  const initialContent = useMemo(
    () =>
      isReportRichContent(initialRichContent)
        ? initialRichContent
        : buildReportRichContent({
            clinicalHistory: initialClinicalHistory,
            findings: initialFindings,
            impression: initialImpression,
            technique: initialTechnique,
            comparison: initialComparison,
            recommendations: initialRecommendations,
          }),
    [
      initialClinicalHistory,
      initialComparison,
      initialFindings,
      initialImpression,
      initialRecommendations,
      initialRichContent,
      initialTechnique,
    ],
  );
  const [reportStatus, setReportStatus] = useState<ReportStatus>(status);
  const [criticalFinding, setCriticalFinding] = useState(initialCriticalFinding);
  const [hasReport, setHasReport] = useState(hasSavedReport);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saved" | "error">(
    "idle",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const savingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const revisionRef = useRef(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = reportStatus === "DRAFT" || reportStatus === "CORRECTION_REQUESTED";

  const onEditorReady = useCallback((readyEditor: Editor | null) => {
    editorRef.current = readyEditor;
    setEditor(readyEditor);
  }, []);

  const markChanged = useCallback(() => {
    setSaveState("unsaved");
    setNotice(null);
    revisionRef.current += 1;
    setRevision((value) => value + 1);
  }, []);

  const onContentChange = useCallback(() => markChanged(), [markChanged]);

  const persistDraft = useCallback(async () => {
    if (!canEdit) return false;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (savingRef.current) {
      saveQueuedRef.current = true;
      return false;
    }

    const activeEditor = editorRef.current;
    const richContent = activeEditor?.getJSON();
    if (!richContent || !isReportRichContent(richContent)) {
      setSaveState("error");
      setNotice("The report editor is not ready. Your changes have not been saved.");
      return false;
    }

    const fields = extractReportRichFields(richContent);
    const payload = { ...fields, criticalFinding, richContent };
    const savedRevision = revisionRef.current;
    savingRef.current = true;
    setSaving(true);
    setSaveState("idle");
    setNotice(null);

    try {
      if (reportStatus === "CORRECTION_REQUESTED") {
        await apiClient.post(
          `/reports/${encodeURIComponent(studyInstanceUid)}/amend`,
          payload,
        );
      } else {
        await apiClient.patch(
          `/reports/${encodeURIComponent(studyInstanceUid)}/draft`,
          payload,
        );
      }
      setHasReport(true);
      setReportStatus("DRAFT");
      const currentAtSaveComplete = savedRevision === revisionRef.current;
      setSaveState(currentAtSaveComplete ? "saved" : "unsaved");
      setNotice("Draft saved.");
      return currentAtSaveComplete;
    } catch (error: unknown) {
      setSaveState("error");
      setNotice(
        error instanceof Error ? error.message : "Failed to save the report.",
      );
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        setRevision((value) => value + 1);
      }
    }
  }, [canEdit, criticalFinding, reportStatus, studyInstanceUid]);

  const persistDraftRef = useRef(persistDraft);
  useEffect(() => {
    persistDraftRef.current = persistDraft;
  }, [persistDraft]);

  useEffect(() => {
    if (!canEdit || revision === 0) return;
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistDraftRef.current();
    }, 900);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [canEdit, revision]);

  const saveDraft = useCallback(() => {
    void persistDraft();
  }, [persistDraft]);

  const submitSignoff = useCallback(async () => {
    if (await persistDraft()) setNotice("Draft is ready for sign-off.");
  }, [persistDraft]);

  const signOff = useCallback(async () => {
    if (!(await persistDraft())) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await apiClient.post(
        `/reports/${encodeURIComponent(studyInstanceUid)}/sign`,
        {},
      );
      setReportStatus("SIGNED");
      setSaveState("saved");
      setNotice("Report signed off.");
    } catch (error: unknown) {
      setSaveState("error");
      setNotice(
        error instanceof Error ? error.message : "Failed to sign off the report.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        setRevision((value) => value + 1);
      }
    }
  }, [persistDraft, studyInstanceUid]);

  const amend = useCallback(async () => {
    if (reportStatus !== "CORRECTION_REQUESTED") return;
    if (await persistDraft()) setNotice("Amended report saved as a draft.");
  }, [persistDraft, reportStatus]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-5 py-3">
        <FileText size={17} className="text-accent" />
        <div>
          <p className="text-sm font-semibold text-text-primary">Axis Radiology</p>
          <p className="text-xs text-text-muted">Clinical report template · A4</p>
        </div>
        <span className="ml-auto text-xs font-medium uppercase tracking-wider text-text-muted">
          {reportStatus.replace(/_/g, " ")}
        </span>
      </div>

      <div
        className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-3 py-2"
        role="toolbar"
        aria-label="Report formatting"
      >
        {editor && (
          <>
            <ToolbarButton
              label="Bold"
              active={editor.isActive("bold")}
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Italic"
              active={editor.isActive("italic")}
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Underline"
              active={editor.isActive("underline")}
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <Underline size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Strikethrough"
              active={editor.isActive("strike")}
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough size={16} />
            </ToolbarButton>
            <span className="mx-1 h-6 border-l border-border" aria-hidden="true" />
            <ToolbarButton
              label="Bulleted list"
              active={editor.isActive("bulletList")}
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Numbered list"
              active={editor.isActive("orderedList")}
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Align left"
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().setTextAlign("left").run()}
            >
              <AlignLeft size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Center align"
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().setTextAlign("center").run()}
            >
              <AlignCenter size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Align right"
              disabled={!canEdit || saving}
              onClick={() => editor.chain().focus().setTextAlign("right").run()}
            >
              <AlignRight size={16} />
            </ToolbarButton>
            <select
              aria-label="Font family"
              value={editor.getAttributes("textStyle").fontFamily ?? ""}
              disabled={!canEdit || saving}
              onChange={(event) => {
                const fontFamily = event.target.value;
                const chain = editor.chain().focus();
                if (fontFamily) chain.setFontFamily(fontFamily).run();
                else chain.unsetFontFamily().run();
              }}
              className="ml-1 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            >
              {FONT_FAMILIES.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
            <ToolbarButton
              label="Insert table"
              disabled={!canEdit || saving}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
                  .run()
              }
            >
              <Table2 size={16} />
            </ToolbarButton>
            <span className="mx-1 h-6 border-l border-border" aria-hidden="true" />
            <ToolbarButton
              label="Undo"
              disabled={!canEdit || saving || !editor.can().undo()}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Redo"
              disabled={!canEdit || saving || !editor.can().redo()}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 size={16} />
            </ToolbarButton>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-editor px-4 py-6">
        <ReportDocumentCanvas
          content={initialContent}
          study={study}
          editable={canEdit && !saving}
          onChange={onContentChange}
          onEditorReady={onEditorReady}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <CriticalFindingToggle
          active={criticalFinding}
          disabled={!canEdit || saving}
          onToggle={() => {
            if (!canEdit || saving) return;
            setCriticalFinding((active) => !active);
            markChanged();
          }}
        />
        <span
          className={clsx(
            "text-xs",
            saveState === "error" ? "text-error" : "text-text-muted",
          )}
          aria-live="polite"
        >
          {saving
            ? "Saving report..."
            : notice ??
              (saveState === "unsaved"
                ? "Unsaved changes"
                : saveState === "saved"
                  ? "All changes saved"
                  : null)}
        </span>
      </div>

      {saving ? (
        <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-sm text-text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          Saving...
        </div>
      ) : (
        <ReportActions
          status={reportStatus}
          disabled={!canEdit}
          studyInstanceUid={hasReport ? studyInstanceUid : undefined}
          onSaveDraft={saveDraft}
          onSubmitSignoff={submitSignoff}
          onSignOff={signOff}
          onAmend={amend}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={clsx(
        "inline-flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active && "bg-accent/10 text-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}
