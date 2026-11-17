"use client";

import { clsx } from "clsx";
import type { ReportStatus, StudyStatus } from "@axis/types";
import {
  canAmendReport,
  canSaveOrSignReport,
} from "@/lib/report-access";

interface ReportActionsProps {
  status: ReportStatus;
  studyStatus: StudyStatus;
  disabled?: boolean;
  onSaveDraft?: () => void;
  onSignOff?: () => void;
  onAmend?: () => void;
}

export function ReportActions({
  status,
  studyStatus,
  disabled = false,
  onSaveDraft,
  onSignOff,
  onAmend,
}: ReportActionsProps) {
  const locked = disabled || !canSaveOrSignReport(status);
  const canAmend =
    canAmendReport(status) && studyStatus === "RADIOLOGIST_SIGNED";

  return (
    <div className="flex items-center gap-3 border-t border-border px-6 py-4">
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={locked}
        className={clsx(
          "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors",
          "hover:bg-surface-raised",
          locked && "cursor-not-allowed opacity-50",
        )}
      >
        Save Draft
      </button>
      <button
        type="button"
        onClick={onSignOff}
        disabled={locked}
        className={clsx(
          "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors",
          "hover:bg-accent/90",
          locked && "cursor-not-allowed opacity-50",
        )}
      >
        Sign Off
      </button>
      {canAmend && onAmend && (
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
    </div>
  );
}
