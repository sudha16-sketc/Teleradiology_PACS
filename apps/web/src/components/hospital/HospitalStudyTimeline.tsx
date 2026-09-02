"use client";

import type { StudyStatus } from "@axis/types";
import { clsx } from "clsx";
import { formatDateTime } from "@/lib/format";

interface TimelineEvent {
  status: StudyStatus;
  timestamp: string;
  actor: string;
}

interface HospitalStudyTimelineProps {
  events: TimelineEvent[];
  currentStatus: StudyStatus;
}

const STATUS_LABELS: Record<StudyStatus, string> = {
  NEW: "New",
  SUBMITTED: "Submitted",
  VALIDATED: "Validated",
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Assigned",
  IN_READING: "In Reading",
  DRAFT_REPORT: "Draft Report",
  FINAL: "Final",
  AMENDED: "Amended",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export function HospitalStudyTimeline({
  events,
  currentStatus,
}: HospitalStudyTimelineProps) {
  return (
    <div className="relative ml-3 border-l border-border pl-6">
      {events.map((event, i) => {
        const isCurrent = event.status === currentStatus;
        const isLast = i === events.length - 1;

        return (
          <div key={i} className={clsx("relative pb-6", isLast && "pb-0")}>
            <div
              className={clsx(
                "absolute -left-[25px] top-0.5 h-3 w-3 rounded-full border-2",
                isCurrent
                  ? "border-accent bg-accent"
                  : "border-border bg-surface",
              )}
            />
            <div className="flex flex-col gap-0.5">
              <span
                className={clsx(
                  "text-sm font-medium",
                  isCurrent ? "text-text-primary" : "text-text-muted",
                )}
              >
                {STATUS_LABELS[event.status]}
              </span>
              <span className="text-xs text-text-muted">
                {formatDateTime(event.timestamp)}
              </span>
              <span className="text-xs text-text-muted">{event.actor}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
