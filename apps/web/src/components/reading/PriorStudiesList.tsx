"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Study } from "@axis/types";
import { apiClient } from "@/lib/api-client";

interface PriorStudiesEnvelope {
  data: Study[];
}

export function PriorStudiesList({ studyUid }: { studyUid: string }) {
  const [isOpen, setIsOpen] = useState(true);
  const [priors, setPriors] = useState<Study[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    apiClient
      .get<PriorStudiesEnvelope>(`/studies/${encodeURIComponent(studyUid)}/priors`)
      .then((res) => {
        if (!cancelled) setPriors(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setPriors([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studyUid]);

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Prior Studies
        <span className="ml-auto rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-muted">
          {loaded ? priors.length : "—"}
        </span>
      </button>
      {isOpen &&
        (loaded ? (
          priors.length === 0 ? (
            <div className="px-4 py-3 text-xs text-text-muted">
              No prior finalized studies for this patient.
            </div>
          ) : (
            <div className="flex flex-col">
              {priors.map((study) => (
                <div
                  key={study.studyInstanceUid}
                  className="flex items-center justify-between border-b border-border px-4 py-2.5 transition-colors hover:bg-surface-raised/50"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    window.location.href = `/reports/${study.studyInstanceUid}`;
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-text-primary">
                      {study.studyDescription || study.modality}
                    </span>
                    <span className="text-xs text-text-muted">
                      {new Date(study.studyDate).toLocaleDateString()} ·{" "}
                      {study.modality}
                    </span>
                  </div>
                  <StatusBadge status={study.status} />
                </div>
              ))}
            </div>
          )
        ) : null)}
    </div>
  );
}
