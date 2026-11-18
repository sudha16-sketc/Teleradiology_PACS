"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RotateCw } from "lucide-react";
import { isDesktop, ohifViewerUrl } from "@/lib/platform";
import { openViewerWindow } from "@/lib/desktop-bridge";
import { apiClient, failureOf } from "@/lib/api-client";
import type { ApiFailure } from "@/lib/api-error";
import { ErrorPanel } from "@/components/ErrorPanel";

interface OHIFViewerProps {
  studyInstanceUid: string;
}

const LOAD_TIMEOUT_MS = 30000;

export function OHIFViewer({ studyInstanceUid }: OHIFViewerProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [popoutFailed, setPopoutFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetState = useCallback(() => {
    setStatus("loading");
    setFailure(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setStatus((current) => (current === "ready" ? "ready" : "error"));
    }, LOAD_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    resetState();

    // An error document returned by the /ohif rewrite still fires the iframe's
    // load event. Probe the same protected DICOMweb proxy the viewer uses so a
    // 503/504 is reported as an imaging failure instead of a blank "ready"
    // viewer. This is a one-item QIDO request, not an image download.
    void apiClient
      .get(
        `/dicom-web/studies/${encodeURIComponent(studyInstanceUid)}/series`,
        {
          params: { limit: 1 },
          headers: { Accept: "application/dicom+json" },
        },
      )
      .catch((error: unknown) => {
        if (cancelled) return;
        const detected = failureOf(error);
        if (detected.kind === "unauthenticated" || detected.kind === "forbidden") {
          return;
        }
        setFailure(detected);
        setStatus("error");
        if (timerRef.current) clearTimeout(timerRef.current);
      });

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [studyInstanceUid, retryKey, resetState]);

  const source = ohifViewerUrl(studyInstanceUid);

  return (
    <div className="relative h-full w-full bg-background/80">
      {isDesktop() && (
        <button
          type="button"
          onClick={async () => {
            const result = await openViewerWindow(studyInstanceUid);
            setPopoutFailed(!result.ok);
          }}
          className="absolute right-3 top-3 z-20 rounded-md border border-border bg-surface-raised p-2 text-text-muted shadow-sm transition-colors hover:text-text-primary"
          aria-label="Open viewer in a separate window"
          title="Open viewer in a separate window"
        >
          <ExternalLink size={15} />
        </button>
      )}
      {popoutFailed && (
        <p
          role="alert"
          className="absolute left-3 top-3 z-20 rounded-md border border-error/30 bg-surface-raised px-3 py-2 text-xs text-error"
        >
          Could not open the viewer window. Try again.
        </p>
      )}

      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80">
          <Loader2 size={28} className="animate-spin text-accent" />
          <p className="text-sm text-text-muted">Loading DICOM viewer…</p>
        </div>
      )}

      {status === "error" ? (
        failure ? (
          <div className="absolute inset-0 z-10 overflow-auto bg-background/95 p-6">
            <ErrorPanel
              failure={failure}
              title="Images could not be loaded"
              onRetry={() => setRetryKey((k) => k + 1)}
            />
          </div>
        ) : (
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
        )
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