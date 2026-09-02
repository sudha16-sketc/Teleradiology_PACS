"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StudyStatus } from "@axis/types";

interface SignOffControlsProps {
  status: StudyStatus;
}

export function SignOffControls({ status }: SignOffControlsProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Sign Off
      </button>
      {isOpen && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Status:</span>
            <StatusBadge status={status} />
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
            >
              Sign Off
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
            >
              Request Amendment
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
            >
              Mark Delivered
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
