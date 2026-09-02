"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: { value: number; label?: string };
  icon?: ReactNode;
}

export function MetricCard({ title, value, change, icon }: MetricCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{title}</span>
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-heading text-2xl font-bold text-text-primary">
          {value}
        </span>
        {change && (
          <span
            className={clsx(
              "flex items-center gap-0.5 text-xs font-medium",
              change.value >= 0 ? "text-success" : "text-error",
            )}
          >
            {change.value >= 0 ? (
              <TrendingUp size={12} />
            ) : (
              <TrendingDown size={12} />
            )}
            {change.value >= 0 ? "+" : ""}
            {change.value}%
            {change.label && (
              <span className="text-text-muted"> {change.label}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
