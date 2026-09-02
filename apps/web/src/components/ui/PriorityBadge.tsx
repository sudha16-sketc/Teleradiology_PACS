import type { StudyPriority } from "@axis/types";
import { clsx } from "clsx";

const PRIORITY_STYLES: Record<StudyPriority, string> = {
  STAT: "bg-warning/10 text-warning",
  URGENT: "bg-warning/10 text-warning",
  ROUTINE: "bg-surface text-text-muted",
};

const PRIORITY_LABELS: Record<StudyPriority, string> = {
  STAT: "STAT",
  URGENT: "Urgent",
  ROUTINE: "Routine",
};

export function PriorityBadge({ priority }: { priority: StudyPriority }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
        PRIORITY_STYLES[priority],
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
