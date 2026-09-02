"use client";

import { Fragment } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  options: FilterOption[];
}

interface FilterBarProps {
  filters: FilterConfig[];
  activeFilters: Record<string, string[]>;
  onChange: (key: string, values: string[]) => void;
}

export function FilterBar({ filters, activeFilters, onChange }: FilterBarProps) {
  const allActiveChips: { key: string; value: string; label: string }[] = [];

  for (const filter of filters) {
    const active = activeFilters[filter.key] ?? [];
    for (const val of active) {
      const option = filter.options.find((o) => o.value === val);
      allActiveChips.push({
        key: filter.key,
        value: val,
        label: option?.label ?? val,
      });
    }
  }

  function toggleFilter(key: string, value: string) {
    const current = activeFilters[key] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange(key, next);
  }

  function clearAll() {
    for (const filter of filters) {
      if ((activeFilters[filter.key]?.length ?? 0) > 0) {
        onChange(filter.key, []);
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <div key={filter.key} className="relative">
            <select
              aria-label={`Filter by ${filter.label}`}
              className={clsx(
                "appearance-none rounded-md border bg-surface px-3 py-1.5 pr-8 text-xs font-medium text-text-primary transition-colors",
                "hover:border-accent focus:border-accent focus:outline-none",
                (activeFilters[filter.key]?.length ?? 0) > 0
                  ? "border-accent/50"
                  : "border-border",
              )}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  toggleFilter(filter.key, e.target.value);
                  e.target.value = "";
                }
              }}
            >
              <option value="" disabled>
                {filter.label}
              </option>
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {allActiveChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {allActiveChips.map((chip) => (
            <Fragment key={`${chip.key}-${chip.value}`}>
              <button
                type="button"
                onClick={() => toggleFilter(chip.key, chip.value)}
                className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-xs text-accent transition-colors hover:bg-accent/10"
              >
                {chip.label}
                <X size={12} />
              </button>
            </Fragment>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-text-muted transition-colors hover:text-text-primary"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
