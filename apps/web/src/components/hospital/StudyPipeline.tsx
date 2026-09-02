"use client";

import type { StudyStatus } from "@axis/types";
import { clsx } from "clsx";
import { Check } from "lucide-react";

const PIPELINE_STEPS: { status: StudyStatus; label: string }[] = [
  { status: "NEW", label: "New" },
  { status: "VALIDATED", label: "Validated" },
  { status: "UNASSIGNED", label: "Unassigned" },
  { status: "ASSIGNED", label: "Assigned" },
  { status: "IN_READING", label: "In Reading" },
  { status: "FINAL", label: "Final" },
  { status: "DELIVERED", label: "Delivered" },
];

function stepIndex(status: StudyStatus): number {
  return PIPELINE_STEPS.findIndex((s) => s.status === status);
}

interface StudyPipelineProps {
  currentStatus: StudyStatus;
}

export function StudyPipeline({ currentStatus }: StudyPipelineProps) {
  const activeIdx = stepIndex(currentStatus);

  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STEPS.map((step, i) => {
        const isCompleted = i < activeIdx;
        const isActive = i === activeIdx;

        return (
          <div key={step.status} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={clsx(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold",
                  isCompleted &&
                    "border-success bg-success/20 text-success",
                  isActive &&
                    "border-accent bg-accent/20 text-accent",
                  !isCompleted &&
                    !isActive &&
                    "border-border bg-surface text-text-muted",
                )}
              >
                {isCompleted ? <Check size={14} /> : i + 1}
              </div>
              <span
                className={clsx(
                  "whitespace-nowrap text-[10px] font-medium",
                  isActive ? "text-accent" : "text-text-muted",
                )}
              >
                {step.label}
              </span>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div
                className={clsx(
                  "mx-1 mb-5 h-px w-6",
                  i < activeIdx ? "bg-success" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
