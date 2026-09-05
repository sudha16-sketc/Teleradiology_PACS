"use client";

import { AlertTriangle } from "lucide-react";
import { clsx } from "clsx";
import { formatDateTime } from "@/lib/format";

interface CriticalFindingToggleProps {
  active: boolean;
  onToggle: () => void;
  flaggedBy?: string;
  flaggedAt?: string;
  disabled?: boolean;
}

export function CriticalFindingToggle({
  active,
  onToggle,
  flaggedBy,
  flaggedAt,
  disabled = false,
}: CriticalFindingToggleProps) {
  return (
    <div
      className={clsx(
        "rounded-md border transition-colors",
        active
          ? "border-warning/40 bg-warning/10"
          : "border-border bg-surface",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className={clsx(
          "flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium transition-colors",
          active ? "text-warning" : "text-text-primary hover:bg-surface-raised/50",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <AlertTriangle
          size={16}
          className={clsx(active ? "text-warning" : "text-text-muted")}
        />
        {active ? "CRITICAL FINDING FLAGGED" : "Flag as Critical Finding"}
      </button>
      {active && (
        <div className="border-t border-warning/20 px-4 py-2 text-xs text-warning">
          <p>
            This report contains a critical finding that requires immediate
            clinical attention. Acknowledgement by the ordering physician is
            required.
          </p>
          {flaggedBy && flaggedAt && (
            <p className="mt-1 text-warning/80">
              Flagged by {flaggedBy} on {formatDateTime(flaggedAt)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
