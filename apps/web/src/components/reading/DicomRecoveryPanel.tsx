"use client";

import { useRef, useState } from "react";
import { AlertTriangle, RotateCw, Upload } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import type { ImagingAvailabilityResult } from "@axis/types";

interface DicomRecoveryPanelProps {
  studyInstanceUid: string;
  result: ImagingAvailabilityResult;
  onRecovered: () => void;
}

const RECOVERY_ROLES = new Set(["ADMIN", "MANAGER", "HOSPITAL"]);

export function DicomRecoveryPanel({
  studyInstanceUid,
  result,
  onRecovered,
}: DicomRecoveryPanelProps) {
  const currentUser = useAppStore((s) => s.currentUser);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRecover = !!currentUser && RECOVERY_ROLES.has(currentUser.role);

  async function upload() {
    const files = Array.from(fileInput.current?.files ?? []);
    if (files.length === 0) {
      setError("Select the original DICOM files or ZIP archive first.");
      return;
    }
    setUploading(true);
    setError(null);
    const body = new FormData();
    for (const file of files) body.append("file", file);
    try {
      await apiClient.post(
        `/dicom/reingest/${encodeURIComponent(studyInstanceUid)}`,
        body,
        { timeoutMs: 10 * 60 * 1000 },
      );
      onRecovered();
    } catch (err) {
      setError((err as { message?: string }).message ?? "Recovery failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-border bg-surface-raised p-4">
      <p className="text-sm font-medium text-text-primary">
        {result.state === "INCOMPLETE"
          ? "Some expected series or instances are missing"
          : "Imaging data is unavailable"}
      </p>
      <p className="mt-1 text-xs text-text-muted">{result.reason}</p>
      <p className="mt-2 text-xs text-text-muted">
        Reports, assignments, and study metadata remain available. Recovering images
        requires the original DICOM files from the source facility; they cannot be
        recreated from study metadata.
      </p>

      {canRecover ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".dcm,.dicom,.zip,application/dicom,application/zip"
            className="max-w-full text-xs text-text-muted file:mr-2 file:rounded file:border-0 file:bg-accent file:px-2 file:py-1 file:text-background"
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => void upload()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {uploading ? <RotateCw size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? "Recovering…" : "Upload original files"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-text-muted">
          Contact an administrator or the source hospital to recover the original
          DICOM files.
        </p>
      )}

      {error ? (
        <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs text-error">
          <AlertTriangle size={13} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
