"use client";

import { clsx } from "clsx";
import type { ReportStatus } from "@axis/types";

interface ReportActionsProps {
  status: ReportStatus;
  disabled?: boolean;
  onSaveDraft?: () => void;
  onSignOff?: () => void;
  onAmend?: () => void;
}

export function ReportActions({
  status,
  disabled = false,
  onSaveDraft,
  onSignOff,
  onAmend,
}: ReportActionsProps) {
  const isSigned = status === "SIGNED" || status === "RADIOLOGIST_SIGNED";
  const canAmend = isSigned || status === "CORRECTION_REQUESTED";

  return (
    <div className="flex items-center gap-3 border-t border-border px-6 py-4">
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={disabled || isSigned}
        className={clsx(
          "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors",
          "hover:bg-surface-raised",
          (disabled || isSigned) && "cursor-not-allowed opacity-50",
        )}
      >
        Save Draft
      </button>
      <button
        type="button"
        onClick={onSignOff}
        disabled={disabled || isSigned}
        className={clsx(
          "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors",
          "hover:bg-accent/90",
          (disabled || isSigned) && "cursor-not-allowed opacity-50",
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
