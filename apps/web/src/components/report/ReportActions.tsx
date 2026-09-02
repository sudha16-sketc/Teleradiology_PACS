"use client";

import { clsx } from "clsx";
import type { ReportStatus } from "@axis/types";

interface ReportActionsProps {
  status: ReportStatus;
  disabled?: boolean;
  onSaveDraft?: () => void;
  onSubmitSignoff?: () => void;
  onSignOff?: () => void;
  onAmend?: () => void;
}

export function ReportActions({
  status,
  disabled = false,
  onSaveDraft,
  onSubmitSignoff,
  onSignOff,
  onAmend,
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
        disabled={disabled || status === "FINAL"}
        className={clsx(
          "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors",
          "hover:bg-surface-raised",
          (disabled || status === "FINAL") && "cursor-not-allowed opacity-50",
        )}
      >
        Submit for Sign-off
      </button>
      <button
        type="button"
        onClick={onSignOff}
        disabled={disabled || status === "FINAL"}
        className={clsx(
          "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors",
          "hover:bg-accent/90",
          (disabled || status === "FINAL") && "cursor-not-allowed opacity-50",
        )}
      >
        Sign Off
      </button>
      {status === "FINAL" && (
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
