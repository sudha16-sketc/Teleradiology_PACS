import type { ReactNode } from "react";
import { clsx } from "clsx";

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: { value: number; direction: "up" | "down" };
  icon?: ReactNode;
}

export function MetricCard({ title, value, change, icon }: MetricCardProps) {
  return (
    <div className="rounded-md border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {title}
          </p>
          <p className="mt-2 font-heading text-2xl font-bold text-text-primary">
            {value}
          </p>
          {change && (
            <p
              className={clsx(
                "mt-1 text-xs font-medium",
                change.direction === "up" ? "text-success" : "text-error",
              )}
            >
              {change.direction === "up" ? "+" : "-"}
              {change.value}%
            </p>
          )}
        </div>
        {icon && (
          <div className="rounded-md bg-surface-raised p-2 text-accent">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
