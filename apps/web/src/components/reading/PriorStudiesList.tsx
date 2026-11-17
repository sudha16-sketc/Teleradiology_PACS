"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Study } from "@axis/types";
import { apiClient, failureOf } from "@/lib/api-client";

interface PriorStudiesEnvelope {
  data: Study[];
}

export function PriorStudiesList({ studyUid }: { studyUid: string }) {
  const [isOpen, setIsOpen] = useState(true);
  const [priors, setPriors] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<PriorStudiesEnvelope>(
        `/studies/${encodeURIComponent(studyUid)}/priors`,
      );
      if (requestId === requestIdRef.current) {
        setPriors(response.data ?? []);
      }
    } catch (requestError: unknown) {
      if (requestId === requestIdRef.current) {
        setError(failureOf(requestError).message);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [studyUid]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Patient Records
        <span className="ml-auto rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-muted">
          {loading ? "…" : priors.length}
        </span>
      </button>
      {isOpen && (
        <div>
          {loading ? (
            <p className="px-4 py-3 text-xs text-text-muted">
              Loading authorized prior studies…
            </p>
          ) : error ? (
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <p className="text-xs text-error">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="shrink-0 text-xs font-medium text-accent hover:underline"
              >
                Retry
              </button>
            </div>
          ) : priors.length === 0 ? (
            <p className="px-4 py-3 text-xs text-text-muted">
              No prior finalized studies are visible for this assignment.
            </p>
          ) : (
            <ul>
              {priors.map((study) => (
                <li key={study.studyInstanceUid}>
                  <Link
                    href={`/reading/${encodeURIComponent(study.studyInstanceUid)}`}
                    className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 transition-colors hover:bg-surface-raised/50"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-text-primary">
                        {study.studyDescription || study.modality}
                      </span>
                      <span className="text-xs text-text-muted">
                        {new Date(study.studyDate).toLocaleDateString()} ·{" "}
                        {study.modality}
                      </span>
                    </span>
                    <StatusBadge status={study.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
