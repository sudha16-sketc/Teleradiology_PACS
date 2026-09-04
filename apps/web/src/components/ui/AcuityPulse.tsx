import type { StudyPriority, StudyStatus } from "@axis/types";
import { clsx } from "clsx";

function getIndicatorColor(priority: StudyPriority, status: StudyStatus): string {
  if (status === "COMPLETED" || status === "MANAGER_APPROVED" || status === "DELIVERED_TO_HOSPITAL") {
    return "bg-success";
  }
  if (status === "IN_READING" || status === "REPORT_DRAFT") {
    return "bg-accent";
  }
  if (priority === "STAT") {
    return "bg-warning";
  }
  if (priority === "URGENT") {
    return "bg-warning";
  }
  return "bg-muted";
}

export function AcuityPulse({
  priority,
  status,
}: {
  priority: StudyPriority;
  status: StudyStatus;
}) {
  const color = getIndicatorColor(priority, status);
  const shouldPulse = priority === "STAT" && status !== "COMPLETED" && status !== "MANAGER_APPROVED" && status !== "DELIVERED_TO_HOSPITAL";

  return (
    <div className="flex h-full items-center">
      <div
        className={clsx(
          "h-8 w-0.5 rounded-full",
          color,
          shouldPulse && "acuity-pulse-stat",
        )}
      />
    </div>
  );
}
