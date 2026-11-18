"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RotateCw } from "lucide-react";
import { isDesktop, ohifViewerUrl } from "@/lib/platform";
import { openViewerWindow } from "@/lib/desktop-bridge";
import { apiClient, failureOf } from "@/lib/api-client";
import type { ApiFailure } from "@/lib/api-error";
import { loginUrl } from "@/lib/return-to";
import { ErrorPanel } from "@/components/ErrorPanel";
import { DicomRecoveryPanel } from "@/components/reading/DicomRecoveryPanel";
import {
  IMAGING_AVAILABILITY_TITLES,
  isAvailabilityRetryable,
  shouldShowRecoveryPanel,
} from "@/lib/imaging-availability";
import type { ImagingAvailabilityResult } from "@axis/types";

interface OHIFViewerProps {
  studyInstanceUid: string;
  onAvailabilityChange?: (result: ImagingAvailabilityResult) => void;
}

interface AvailabilityEnvelope {
  data: ImagingAvailabilityResult;
}

const LOAD_TIMEOUT_MS = 30000;
const SESSION_CHECK_MS = 60000;

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  window.location.assign(
    loginUrl(window.location.pathname + window.location.search),
  );
}

function AvailabilityPanel({
  result,
  studyInstanceUid,
  onRetry,
}: {
  result: ImagingAvailabilityResult;
  studyInstanceUid: string;
  onRetry: () => void;
}) {
  const retryable = isAvailabilityRetryable(result.state);
  return (
    <div className="absolute inset-0 z-10 overflow-auto bg-background/95 p-6">
      <div className="mx-auto max-w-xl rounded-lg border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              {IMAGING_AVAILABILITY_TITLES[result.state]}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{result.reason}</p>
            <p className="mt-2 text-xs text-text-muted">
              Expected series: {result.expectedSeriesCount} · Found series:{" "}
              {result.actualSeriesCount} · Expected instances:{" "}
              {result.expectedInstanceCount} · Found instances:{" "}
              {result.actualInstanceCount}
            </p>
            {retryable ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-accent/90"
              >
                <RotateCw size={13} />
                Retry verification
              </button>
            ) : null}
          </div>
        </div>
        {shouldShowRecoveryPanel(result.state) ? (
          <DicomRecoveryPanel
            studyInstanceUid={studyInstanceUid}
            result={result}
            onRecovered={onRetry}
          />
        ) : null}
      </div>
    </div>
  );
}

export function OHIFViewer({
  studyInstanceUid,
  onAvailabilityChange,
}: OHIFViewerProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [availability, setAvailability] =
    useState<ImagingAvailabilityResult | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [popoutFailed, setPopoutFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);

  const resetState = useCallback(() => {
    setStatus("loading");
    setFailure(null);
    setAvailability(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setStatus((current) => (current === "ready" ? "ready" : "error"));
    }, LOAD_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    resetState();

    void apiClient
      .get<AvailabilityEnvelope>(
        `/dicom-web/availability/${encodeURIComponent(studyInstanceUid)}`,
      )
      .then((envelope) => {
        if (cancelled) return;
        setAvailability(envelope.data);
        onAvailabilityChange?.(envelope.data);
        if (envelope.data.state !== "AVAILABLE") {
          setStatus("error");
          if (timerRef.current) clearTimeout(timerRef.current);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const detected = failureOf(error);
        if (detected.kind === "unauthenticated") {
          redirectToLogin();
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
  }, [studyInstanceUid, retryKey, resetState, onAvailabilityChange]);

  useEffect(() => {
    const checkSession = () => {
      void apiClient.get("/auth/me").catch((error: unknown) => {
        if (failureOf(error).kind === "unauthenticated") redirectToLogin();
      });
    };
    const interval = setInterval(checkSession, SESSION_CHECK_MS);
    window.addEventListener("focus", checkSession);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", checkSession);
    };
  }, []);

  const source = ohifViewerUrl(studyInstanceUid);
  const showAvailabilityPanel =
    status === "error" && !!availability && availability.state !== "AVAILABLE";

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
          <p className="text-sm text-text-muted">Verifying imaging availability…</p>
        </div>
      )}

      {showAvailabilityPanel && availability ? (
        <AvailabilityPanel
          result={availability}
          studyInstanceUid={studyInstanceUid}
          onRetry={retry}
        />
      ) : status === "error" ? (
        failure ? (
          <div className="absolute inset-0 z-10 overflow-auto bg-background/95 p-6">
            <ErrorPanel
              failure={failure}
              title="Images could not be loaded"
              onRetry={retry}
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
                Check that the OHIF service is running, then retry.
              </p>
            </div>
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
            >
              <RotateCw size={14} />
              Retry
            </button>
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
