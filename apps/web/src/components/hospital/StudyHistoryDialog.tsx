"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { apiClient, failureOf } from "@/lib/api-client";
import { apiUrl } from "@/lib/platform";

interface HistoryAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

interface StudyHistory {
  patientName: string;
  patientAge: number | null;
  gender: string | null;
  referringPhysician: string;
  clinicalHistory: string;
  attachment: HistoryAttachment | null;
}

interface HistoryEnvelope {
  data: StudyHistory;
}

interface StudyHistoryDialogProps {
  studyUid: string;
  onClose: () => void;
}

export function StudyHistoryDialog({
  studyUid,
  onClose,
}: StudyHistoryDialogProps) {
  const [history, setHistory] = useState<StudyHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await apiClient.get<HistoryEnvelope>(
        `/studies/${encodeURIComponent(studyUid)}/history`,
      );
      setHistory(response.data);
    } catch (error: unknown) {
      setErrorMessage(failureOf(error).message);
    } finally {
      setIsLoading(false);
    }
  }, [studyUid]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-history-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface shadow-xl"
      >
        <header className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="study-history-title" className="text-lg font-semibold">
              Patient History
            </h2>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {studyUid}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 hover:bg-muted"
            aria-label="Close patient history"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading history…
          </div>
        ) : errorMessage ? (
          <div className="p-6" role="alert">
            <p className="text-sm text-destructive">{errorMessage}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Try again
            </button>
          </div>
        ) : history ? (
          <div className="space-y-5 p-6">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Patient Name</dt>
                <dd className="mt-1 font-medium">{history.patientName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Patient Age</dt>
                <dd className="mt-1 font-medium">
                  {history.patientAge ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Gender</dt>
                <dd className="mt-1 font-medium">{history.gender ?? "—"}</dd>
              </div>
            </dl>

            <div>
              <h3 className="text-xs font-medium text-muted-foreground">
                Referring Doctor
              </h3>
              <p className="mt-1 whitespace-pre-wrap">
                {history.referringPhysician || "—"}
              </p>
            </div>

            <div>
              <h3 className="text-xs font-medium text-muted-foreground">
                Clinical History
              </h3>
              <p className="mt-1 whitespace-pre-wrap break-words">
                {history.clinicalHistory || "—"}
              </p>
            </div>

            <div>
              <h3 className="text-xs font-medium text-muted-foreground">
                Supporting File
              </h3>
              {history.attachment ? (
                <a
                  href={apiUrl(
                    `/studies/history-attachments/${encodeURIComponent(history.attachment.id)}`,
                  )}
                  download={history.attachment.originalName}
                  className="mt-1 inline-flex items-center gap-2 break-all text-sm text-accent hover:underline"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  {history.attachment.originalName}
                </a>
              ) : (
                <p className="mt-1 text-sm">No supporting file attached.</p>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
