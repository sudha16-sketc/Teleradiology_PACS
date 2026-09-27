"use client";

import { Printer } from "lucide-react";
import { clsx } from "clsx";
import type { ReportStatus } from "@axis/types";

interface ReportActionsProps {
  status: ReportStatus;
  disabled?: boolean;
  onSaveDraft?: () => void;
  onSubmitSignoff?: () => void;
  onSignOff?: () => void;
  onAmend?: () => void;
  /**
   * Study the report belongs to. When present, a Print action opens the
   * print-optimised view of the saved report.
   */
  studyInstanceUid?: string;
}

export function ReportActions({
  status,
  disabled = false,
  onSaveDraft,
  onSubmitSignoff,
  onSignOff,
  onAmend,
  studyInstanceUid,
}: ReportActionsProps) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-6 py-4">
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={disabled}
        className={clsx(
          "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors",
          "hover:bg-surface-raised",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        Save Draft
      </button>
      <button
        type="button"
        onClick={onSubmitSignoff}
        disabled={disabled || status === "SIGNED"}
        className={clsx(
          "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors",
          "hover:bg-surface-raised",
          (disabled || status === "SIGNED") && "cursor-not-allowed opacity-50",
        )}
      >
        Submit for Sign-off
      </button>
      <button
        type="button"
        onClick={onSignOff}
        disabled={disabled || status === "SIGNED"}
        className={clsx(
          "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors",
          "hover:bg-accent/90",
          (disabled || status === "SIGNED") && "cursor-not-allowed opacity-50",
        )}
      >
        Sign Off
      </button>
      {status === "CORRECTION_REQUESTED" && (
        <button
          type="button"
          onClick={onAmend}
          disabled={disabled}
          className={clsx(
            "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors",
            "hover:bg-surface-raised",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          Amend
        </button>
      )}

      {/*
        Print opens the saved report, not the editor buffer.

        A radiologist printing mid-edit wants what is on screen, but the canonical
        artefact is the server's report: printing unsaved edits would put a
        document on paper that no stored version matches, and that paper would be
        the one a colleague acts on. Unsaved work is the user's to save first.
      */}
      {studyInstanceUid ? (
        <a
          href={`/reports/print/${encodeURIComponent(studyInstanceUid)}`}
          target="_blank"
          rel="noreferrer"
          className={clsx(
            "ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary transition-colors",
            "hover:bg-surface-raised",
          )}
          title={
            status === "DRAFT"
              ? "This report is a draft. Save it before printing."
              : "Open a print-optimised view of this report"
          }
        >
          <Printer className="h-4 w-4" />
          Print
        </a>
      ) : null}
    </div>
  );
}
