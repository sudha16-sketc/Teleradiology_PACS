"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RotateCw } from "lucide-react";

interface OHIFViewerProps {
  studyInstanceUid: string;
}

function ohifStudyUrl(studyInstanceUid: string): string {
  const base = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/ohif`;
  return `${base}/viewer?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUid)}`;
}

const LOAD_TIMEOUT_MS = 30000;

export function OHIFViewer({ studyInstanceUid }: OHIFViewerProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryKey, setRetryKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetState = useCallback(() => {
    setStatus("loading");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setStatus((current) => (current === "ready" ? "ready" : "error"));
    }, LOAD_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    resetState();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [studyInstanceUid, retryKey, resetState]);

  const source = ohifStudyUrl(studyInstanceUid);

  return (
    <div className="relative h-full w-full bg-background/80">
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80">
          <Loader2 size={28} className="animate-spin text-accent" />
          <p className="text-sm text-text-muted">Loading DICOM viewer…</p>
        </div>
      )}

      {status === "error" ? (
        <div className="absolute inset-0 z-10 flex h-full w-full flex-col items-center justify-center gap-4 bg-background/90 px-6 text-center">
          <AlertTriangle size={40} strokeWidth={1.5} className="text-warning" />
          <div>
            <h2 className="font-heading text-lg font-semibold text-text-primary">
              Viewer could not be loaded
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
              The OHIF viewer is taking too long to respond for this study.
              Check that the OHIF service and Orthanc are running, then retry.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
            >
              <RotateCw size={14} />
              Retry
            </button>
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
            >
              <ExternalLink size={14} />
              Open in new tab
            </a>
          </div>
        </div>
      ) : (
        <iframe
          key={retryKey}
          src={source}
          title={`OHIF Viewer — ${studyInstanceUid}`}
          className="h-full w-full border-0"
          allow="cross-origin-isolated; fullscreen"
          onLoad={() => {
            setStatus("ready");
            if (timerRef.current) clearTimeout(timerRef.current);
          }}
        />
      )}
    </div>
  );
}