"use client";

import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { Report } from "@axis/types";

interface CriticalFindingBannerProps {
  report: Report | null;
}

export function CriticalFindingBanner({ report }: CriticalFindingBannerProps) {
  const [isAcknowledged, setIsAcknowledged] = useState(
    report?.criticalFindingAcknowledged ?? false,
  );
  const isFlagged = report?.criticalFinding ?? false;

  return (
    <div className="border-b border-border">
      <div className="px-4 py-3">
        {isFlagged ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-warning">
                  CRITICAL FINDING — Immediate communication required
                </span>
                {report?.signedOffBy && (
                  <span className="text-xs text-text-muted">
                    Flagged by {report.signedOffBy}
                  </span>
                )}
              </div>
            </div>
            {!isAcknowledged ? (
              <button
                type="button"
                onClick={() => setIsAcknowledged(true)}
                className="self-start rounded-md border border-warning/30 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/10"
              >
                Acknowledge
              </button>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-success">
                <Check size={14} />
                Acknowledged
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-text-muted">
              No critical finding flagged
            </span>
            <button
              type="button"
              className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
            >
              Flag as Critical Finding
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
