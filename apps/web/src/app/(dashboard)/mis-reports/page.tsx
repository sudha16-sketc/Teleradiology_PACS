"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSearch,
  Loader2,
} from "lucide-react";
import {
  apiClient,
  failureOf,
  type ApiDownloadResult,
} from "@/lib/api-client";

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INPUT_CLASS =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none";

function toIsoBoundary(value: string, boundary: "start" | "end"): string {
  if (!DATE_PATTERN.test(value)) {
    throw new Error("Enter dates in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Enter valid dates.");
  }
  const boundaryDate =
    boundary === "end" ? new Date(parsed.getTime() + DAY_MS - 1) : parsed;
  return boundaryDate.toISOString();
}

function triggerDownload(result: ApiDownloadResult) {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function MisReportsPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);

  const generate = async () => {
    if (isGenerating) return;
    setValidationError(null);
    setApiError(null);
    setNotice(null);
    setIsEmpty(false);

    if (fromDate && toDate && fromDate > toDate) {
      setValidationError("From Date cannot be later than To Date.");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await apiClient.download("/reports/mis/export", {
        params: {
          fromDate: fromDate ? toIsoBoundary(fromDate, "start") : undefined,
          toDate: toDate ? toIsoBoundary(toDate, "end") : undefined,
        },
      });
      const rowCountHeader = Number(result.headers.get("x-mis-row-count"));
      const rowCount = Number.isFinite(rowCountHeader) ? rowCountHeader : null;
      triggerDownload(result);
      if (rowCount === 0) {
        setIsEmpty(true);
        setNotice(
          "No study records found for the selected filters. A headers-only workbook was downloaded.",
        );
      } else {
        setNotice(
          rowCount === null
            ? "MIS Excel generated and downloaded."
            : `MIS Excel generated with ${rowCount} record${rowCount === 1 ? "" : "s"}.`,
        );
      }
    } catch (error) {
      setApiError(failureOf(error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          MIS Reports
        </h1>
        <p className="text-sm text-text-muted">
          Generate and download detailed study activity and turnaround-time reports.
        </p>
      </div>

      <section className="rounded-md border border-border bg-surface p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5 text-sm text-text-muted">
              From Date
              <input
                type="date"
                aria-label="From Date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(event) => setFromDate(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-text-muted">
              To Date
              <input
                type="date"
                aria-label="To Date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(event) => setToDate(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <button
              type="button"
              onClick={generate}
              disabled={isGenerating}
              aria-busy={isGenerating}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              {isGenerating ? "Generating..." : "Generate MIS Excel"}
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Date filters are optional, inclusive, and applied to the study date
            in UTC. Without dates, all records in your authorized scope are exported.
          </p>
        </div>
      </section>

      {validationError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          <AlertCircle size={16} />
          {validationError}
        </div>
      ) : null}

      {apiError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error"
        >
          <AlertCircle size={16} />
          {apiError}
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
        >
          {isEmpty ? <FileSearch size={16} /> : <CheckCircle2 size={16} />}
          {notice}
        </div>
      ) : null}
    </div>
  );
}
