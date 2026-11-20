"use client";

import { useEffect, useState } from "react";
import {
  Database,
  DatabaseBackup,
  Settings2,
  Archive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/ErrorState";
import type {
  RetentionExecutionResult,
  RetentionJobView,
  RetentionPreviewResult,
  RetentionSkipSummary,
} from "@axis/types";

interface SlaRow {
  priority: "STAT" | "URGENT" | "ROUTINE";
  minutes: number;
  isActive: boolean;
}

interface BackupRow {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  databaseArtifact?: string | null;
  dicomArtifact?: string | null;
  databaseObjectKey?: string | null;
  dicomObjectKey?: string | null;
  databaseVerified?: boolean;
  dicomVerified?: boolean;
  storageProvider?: string | null;
  environment?: string | null;
  sizeBytes?: string | null;
  checksum?: string | null;
  failureReason?: string | null;
}

const MINUTES_LABEL: Record<string, string> = {
  STAT: "STAT (urgent)",
  URGENT: "URGENT",
  ROUTINE: "ROUTINE",
};

const RETENTION_REASON_LABEL: Record<string, string> = {
  NOT_TERMINAL: "Not in terminal state",
  MISSING_COMPLETION_TIMESTAMP: "Missing completion timestamp",
  MISSING_LIFECYCLE_ANCHOR: "Missing lifecycle anchor",
  RETENTION_NOT_ELAPSED: "Retention period not elapsed",
  LEGAL_HOLD: "Legal hold",
  INVALID_TENANT: "Invalid hospital/tenant linkage",
  INACTIVE_HOSPITAL: "Inactive hospital",
  IMAGING_NOT_AVAILABLE: "Imaging not available",
  ACTIVE_CORRECTION: "Active correction",
  ACTIVE_REPORT_WORKFLOW: "Active report workflow",
  ACTIVE_DELIVERY: "Active delivery",
  ACTIVE_WORKLIST: "Active worklist item",
  UNSIGNED_REPORT: "Report not signed",
  REPORT_NOT_DELIVERED: "Report not delivered",
  AWAITING_HOSPITAL_ACCEPTANCE: "Awaiting hospital acceptance",
  MANDATORY_RETENTION: "Mandatory retention",
  NO_VERIFIED_FULL_BACKUP: "No verified full backup",
  ARCHIVE_FAILED: "Archive failed",
};

const RETENTION_LOCK_REASONS = [
  "LEGAL_HOLD",
  "ACTIVE_DISPUTE",
  "HOSPITAL_RETENTION_REQUEST",
  "PENDING_REPORT_DELIVERY",
  "MANDATORY_RETENTION",
  "INVESTIGATION",
];

function retentionReasonLabel(reason?: string): string {
  if (!reason) return "Eligible";
  return RETENTION_REASON_LABEL[reason] ?? reason;
}

function formatRetentionDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default function OperationsPage() {
  const [error, setError] = useState(false);
  const [slaRows, setSlaRows] = useState<SlaRow[]>([]);
  const [slaDefaults, setSlaDefaults] = useState<Record<string, number>>({});
  const [slaDraft, setSlaDraft] = useState<Record<string, string>>({});
  const [slaSaving, setSlaSaving] = useState(false);

  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [backupType, setBackupType] = useState("DATABASE");
  const [backupRunning, setBackupRunning] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  const [retentionPreview, setRetentionPreview] =
    useState<RetentionPreviewResult | null>(null);
  const [retentionExecution, setRetentionExecution] =
    useState<RetentionExecutionResult | null>(null);
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [retentionJobs, setRetentionJobs] = useState<RetentionJobView[]>([]);
  const [holdStudyId, setHoldStudyId] = useState("");
  const [holdReason, setHoldReason] = useState("LEGAL_HOLD");
  const [holdExpiresAt, setHoldExpiresAt] = useState("");
  const [holdBusy, setHoldBusy] = useState(false);

  const loadSla = async () => {
    try {
      const res = await apiClient.get<{ data: SlaRow[]; defaults: Record<string, number> }>(
        "/sla/config",
      );
      setSlaRows(res.data ?? []);
      setSlaDefaults(res.defaults ?? {});
      const draft: Record<string, string> = {};
      for (const row of res.data ?? []) draft[row.priority] = String(row.minutes);
      setSlaDraft(draft);
    } catch (e) {
      console.error(e);
      setError(true);
    }
  };

  const loadBackups = async () => {
    try {
      const res = await apiClient.get<{ data: BackupRow[] }>("/admin/backups");
      setBackups(res.data ?? []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadRetentionJobs = async () => {
    try {
      const res = await apiClient.get<{ data: RetentionJobView[] }>(
        "/admin/retention/jobs",
      );
      setRetentionJobs(res.data ?? []);
    } catch (e) {
      console.error(e);
    }
  };

  const load = async () => {
    setError(false);
    await Promise.all([loadSla(), loadBackups(), loadRetentionJobs()]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSla = async () => {
    setSlaSaving(true);
    try {
      for (const [priority, minutes] of Object.entries(slaDraft)) {
        const n = Number(minutes);
        if (!Number.isFinite(n) || n <= 0) continue;
        await apiClient.post("/sla/config", { priority, minutes: n });
      }
      await loadSla();
    } catch (e) {
      console.error(e);
    } finally {
      setSlaSaving(false);
    }
  };

  const runBackup = async () => {
    setBackupRunning(true);
    try {
      await apiClient.post("/admin/backups", { type: backupType });
      await loadBackups();
    } catch (e) {
      console.error(e);
    } finally {
      setBackupRunning(false);
    }
  };

  const verifyBackup = async (id: string) => {
    try {
      await apiClient.post(`/admin/backups/${id}/verify`);
      await loadBackups();
    } catch (e) {
      console.error(e);
    }
  };

  const restoreBackup = async (row: BackupRow) => {
    const confirmed = window.confirm(
      `Restore ${row.type} backup ${row.id}? Database restore requires an explicitly configured empty target.`,
    );
    if (!confirmed) return;
    setRestoreBusy(true);
    setRestoreMessage(null);
    try {
      const result = await apiClient.post<{ data: unknown }>(
        `/admin/backups/${row.id}/restore`,
        { type: row.type, confirm: true },
      );
      setRestoreMessage(`Restore completed: ${JSON.stringify(result.data)}`);
    } catch (e) {
      setRestoreMessage(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoreBusy(false);
    }
  };

  const runRetentionPreview = async () => {
    setRetentionBusy(true);
    setRetentionMessage(null);
    try {
      const res = await apiClient.get<{ data: RetentionPreviewResult }>(
        "/admin/retention/preview",
      );
      setRetentionPreview(res.data ?? null);
      setRetentionExecution(null);
    } catch (e) {
      console.error(e);
      setRetentionMessage("Preview failed. Check permissions and try again.");
    } finally {
      setRetentionBusy(false);
    }
  };

  const runRetentionExecute = async () => {
    const confirmed = window.confirm(
      "Mark all currently eligible studies as archived? Data is retained and every change is audited.",
    );
    if (!confirmed) return;
    setRetentionBusy(true);
    setRetentionMessage(null);
    try {
      const res = await apiClient.post<{ data: RetentionExecutionResult }>(
        "/admin/retention/execute",
      );
      setRetentionExecution(res.data ?? null);
      setRetentionPreview(res.data ?? null);
      setRetentionMessage(`Archived ${res.data?.archived ?? 0} study/studies.`);
      await loadBackups();
    } catch (e) {
      console.error(e);
      setRetentionMessage("Archival failed. No partial changes were applied.");
    } finally {
      setRetentionBusy(false);
    }
  };

  const retryRetentionJob = async (id: string) => {
    try {
      await apiClient.post(`/admin/retention/jobs/${id}/retry`);
      await loadRetentionJobs();
    } catch (e) {
      console.error(e);
    }
  };

  const applyHold = async () => {
    const studyId = holdStudyId.trim();
    if (!studyId) return;
    setHoldBusy(true);
    setRetentionMessage(null);
    try {
      await apiClient.post(
        `/admin/retention/holds/${encodeURIComponent(studyId)}`,
        {
          reason: holdReason,
          ...(holdExpiresAt
            ? { expiresAt: new Date(holdExpiresAt).toISOString() }
            : {}),
        },
      );
      setRetentionMessage(`Legal hold applied to ${studyId}.`);
      setHoldStudyId("");
      setHoldExpiresAt("");
      await runRetentionPreview();
    } catch (e) {
      console.error(e);
      setRetentionMessage("Could not apply the legal hold.");
    } finally {
      setHoldBusy(false);
    }
  };

  const releaseHold = async (studyId: string) => {
    setHoldBusy(true);
    setRetentionMessage(null);
    try {
      await apiClient.delete(
        `/admin/retention/holds/${encodeURIComponent(studyId)}`,
      );
      setRetentionMessage(`Legal hold released for ${studyId}.`);
      await runRetentionPreview();
    } catch (e) {
      console.error(e);
      setRetentionMessage("Could not release the legal hold.");
    } finally {
      setHoldBusy(false);
    }
  };

  if (error) {
    return (
      <ErrorState title="Failed to load operations data" description="Check that you are an administrator." onRetry={() => load()} />
    );
  }

  const retentionResult = retentionExecution ?? retentionPreview;
  const skippedReasons: RetentionSkipSummary[] =
    retentionResult?.skippedReasons ?? [];
  const heldCandidates = (retentionResult?.candidates ?? []).filter(
    (candidate) => candidate.retentionLocked,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Operations
        </h1>
        <p className="text-sm text-text-muted">
          Production controls: SLA thresholds, backups, and data retention
        </p>
      </div>

      {/* SLA configuration */}
      <section className="rounded-md border border-border p-5">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 size={18} className="text-accent" />
          <h2 className="font-heading text-lg font-semibold text-text-primary">
            SLA Thresholds
          </h2>
        </div>
        <p className="mb-4 text-sm text-text-muted">
          Deadlines, remaining time, and breach state are computed server-side
          from these minutes-per-priority values.
        </p>

        <div className="overflow-hidden rounded-md border border-border">
          <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-border bg-surface-raised px-4 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <div>Priority</div>
            <div>Target (minutes)</div>
            <div>Applied</div>
          </div>
          {(Object.keys(MINUTES_LABEL) as Array<"STAT" | "URGENT" | "ROUTINE">).map((priority) => (
            <div
              key={priority}
              className="grid grid-cols-[1fr_1fr_1fr] items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span className="text-sm text-text-primary">{MINUTES_LABEL[priority]}</span>
              <input
                type="number"
                min={1}
                value={slaDraft[priority] ?? slaDefaults[priority] ?? ""}
                onChange={(e) => setSlaDraft((d) => ({ ...d, [priority]: e.target.value }))}
                className="w-24 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-text-muted">
                {slaRows.find((r) => r.priority === priority)?.isActive
                  ? "Configured"
                  : "Default"}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={saveSla}
          disabled={slaSaving}
          className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {slaSaving ? "Saving..." : "Save SLA thresholds"}
        </button>
      </section>

      {/* Backup */}
      <section className="rounded-md border border-border p-5">
        <div className="mb-4 flex items-center gap-2">
          <DatabaseBackup size={18} className="text-accent" />
          <h2 className="font-heading text-lg font-semibold text-text-primary">
            Backups
          </h2>
        </div>
        <p className="mb-4 text-sm text-text-muted">
          PostgreSQL dumps and DICOMweb archives, checksummed, uploaded to the
          configured storage provider, and recorded in the audit log.
        </p>

        <div className="flex items-center gap-3">
          <select
            value={backupType}
            onChange={(e) => setBackupType(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="DATABASE">Database only</option>
            <option value="DICOM">DICOM (DICOMweb archive)</option>
            <option value="FULL">Full (DB + DICOM)</option>
          </select>
          <button
            onClick={runBackup}
            disabled={backupRunning}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Database size={14} />
            {backupRunning ? "Running..." : "Run backup"}
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {backups.length === 0 ? (
            <p className="text-sm text-text-muted">No backups have been recorded yet.</p>
          ) : (
            backups.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-raised/50 px-4 py-2.5"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        b.status === "VERIFIED"
                          ? "text-success"
                          : b.status === "FAILED"
                            ? "text-error"
                            : "text-accent"
                      }
                    >
                      {b.status}
                    </span>
                    <span className="text-sm text-text-primary">{b.type}</span>
                    <span className="font-mono text-xs text-text-muted">
                      {new Date(b.startedAt).toLocaleString()}
                    </span>
                    {b.sizeBytes && (
                      <span className="font-mono text-xs text-text-muted">
                        {(Number(b.sizeBytes) / 1024).toFixed(1)} KB
                      </span>
                    )}
                    {b.storageProvider && (
                      <span className="text-xs text-text-muted">
                        {b.storageProvider}
                        {b.environment ? ` / ${b.environment}` : ""}
                      </span>
                    )}
                  </div>
                  {(b.databaseObjectKey || b.dicomObjectKey) && (
                    <div className="flex flex-wrap gap-3 font-mono text-[11px] text-text-muted">
                      {b.databaseObjectKey && (
                        <span>DB: {b.databaseObjectKey}{b.databaseVerified ? " ✓" : ""}</span>
                      )}
                      {b.dicomObjectKey && (
                        <span>DICOM: {b.dicomObjectKey}{b.dicomVerified ? " ✓" : ""}</span>
                      )}
                    </div>
                  )}
                  {b.failureReason && (
                    <span className="text-xs text-error">{b.failureReason}</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {b.status === "COMPLETED" && (
                    <button
                      onClick={() => verifyBackup(b.id)}
                      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs font-medium text-text-primary hover:bg-surface-raised"
                    >
                      <ShieldCheck size={13} />
                      Verify
                    </button>
                  )}
                  {(b.status === "COMPLETED" || b.status === "VERIFIED") && (
                    <button
                      onClick={() => restoreBackup(b)}
                      disabled={restoreBusy}
                      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
                    >
                      <RotateCcw size={13} />
                      Restore
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        {restoreMessage && (
          <p className="mt-3 rounded-md border border-border bg-surface-raised/50 p-3 text-xs text-text-muted">
            {restoreMessage}
          </p>
        )}
      </section>

      {/* Retention */}
      <section className="rounded-md border border-border p-5">
        <div className="mb-4 flex items-center gap-2">
          <Archive size={18} className="text-accent" />
          <h2 className="font-heading text-lg font-semibold text-text-primary">
            Retention & Archival
          </h2>
        </div>
        <p className="mb-4 text-sm text-text-muted">
          Dry-run preview of studies eligible for archival, then mark them as
          archived (data is retained; records are marked and audited).
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={runRetentionPreview}
            disabled={retentionBusy}
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Preview
          </button>
          <button
            onClick={runRetentionExecute}
            disabled={retentionBusy}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Archive size={14} />
            Execute archival
          </button>
        </div>

        {retentionMessage && (
          <p className="mt-3 text-sm text-text-muted">{retentionMessage}</p>
        )}

        {retentionResult && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">Reviewed</div>
                <div className="font-mono text-lg text-text-primary">
                  {retentionResult.reviewed}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">Eligible</div>
                <div className="font-mono text-lg text-success">
                  {retentionResult.eligibleCount}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">Skipped</div>
                <div className="font-mono text-lg text-text-primary">
                  {retentionResult.skipped}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">
                  Retention
                </div>
                <div className="font-mono text-lg text-text-primary">
                  {retentionResult.policy.retentionDays}d
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">
                  {retentionExecution ? "Archived" : "Backup required"}
                </div>
                <div className="font-mono text-lg text-text-primary">
                  {retentionExecution
                    ? retentionExecution.archived
                    : retentionResult.policy.requiresVerifiedBackup
                      ? "Yes"
                      : "No"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">On hold</div>
                <div className="font-mono text-lg text-text-primary">
                  {retentionResult.onHold}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">
                  Awaiting response
                </div>
                <div className="font-mono text-lg text-text-primary">
                  {retentionResult.awaitingUserResponse}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">
                  Ready for archive
                </div>
                <div className="font-mono text-lg text-text-primary">
                  {retentionResult.readyForArchive}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="text-xs uppercase tracking-wide text-text-muted">
                  Failed archives
                </div>
                <div className="font-mono text-lg text-text-primary">
                  {retentionResult.failedArchives}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border bg-surface-raised/50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Lifecycle policy
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-text-muted md:grid-cols-3">
                <div>Initial hold: {retentionResult.policy.initialRetentionDays}d</div>
                <div>
                  CANCEL: {retentionResult.policy.cancelReminderDays}d ×{" "}
                  {retentionResult.policy.cancelMaxCount}
                </div>
                <div>
                  IGNORE: {retentionResult.policy.ignoreResponseHours}h /{" "}
                  {retentionResult.policy.ignoreReminderDays}d ×{" "}
                  {retentionResult.policy.ignoreMaxCount}
                </div>
                <div>
                  Archive expiry: {retentionResult.policy.dicomBackupRetentionDays}d DICOM /{" "}
                  {retentionResult.policy.metadataBackupRetentionDays}d metadata
                </div>
                <div>Dry-run: {retentionResult.policy.dryRun ? "on" : "off"}</div>
                <div>
                  Scheduler: {retentionResult.policy.schedulerEnabled ? "enabled" : "disabled"}
                </div>
              </div>
              {retentionResult.upcomingActions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {retentionResult.upcomingActions.map((action, index) => (
                    <span
                      key={`${action.type}-${action.studyId ?? "global"}-${index}`}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted"
                    >
                      {action.type} · {formatRetentionDate(action.dueAt)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {skippedReasons.length > 0 && (
              <div className="rounded-md border border-border bg-surface-raised/50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Skip reasons
                </div>
                <div className="flex flex-wrap gap-2">
                  {skippedReasons.map((item) => (
                    <span
                      key={item.reason}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted"
                    >
                      {retentionReasonLabel(item.reason)}: {item.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {retentionResult.candidates.length === 0 ? (
              <p className="text-sm text-text-muted">
                No old non-archived studies matched the retention window.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-surface-raised text-xs uppercase tracking-wide text-text-muted">
                    <tr>
                      <th className="px-3 py-2">Study</th>
                      <th className="px-3 py-2">Hospital</th>
                      <th className="px-3 py-2">Age</th>
                      <th className="px-3 py-2">Backup</th>
                      <th className="px-3 py-2">Result</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retentionResult.candidates.map((candidate) => (
                      <tr
                        key={candidate.studyId}
                        className="border-t border-border text-text-muted"
                      >
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs text-text-primary">
                            {candidate.accessionNumber}
                          </div>
                          <div className="max-w-[220px] truncate font-mono text-[11px]">
                            {candidate.studyInstanceUid}
                          </div>
                        </td>
                        <td className="px-3 py-2">{candidate.hospitalName}</td>
                        <td className="px-3 py-2">
                          {candidate.daysSinceAnchor}d
                          <div className="text-[11px]">
                            from {formatRetentionDate(candidate.retentionAnchorAt)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {candidate.verifiedBackupExists ? "Verified" : "None"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              candidate.eligible ? "text-success" : "text-error"
                            }
                          >
                            {candidate.eligible ? "Eligible" : "Skipped"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {retentionReasonLabel(candidate.reason)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-border p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Retention job queue
            </div>
            {retentionJobs.length === 0 ? (
              <p className="text-sm text-text-muted">No retention jobs are queued.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {retentionJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-raised/50 px-3 py-2"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-3 text-sm text-text-primary">
                        <span>{job.type}</span>
                        <span className="text-xs text-text-muted">{job.status}</span>
                        <span className="font-mono text-[11px] text-text-muted">
                          {job.attempts}/{job.maxAttempts}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-muted">
                        due {formatRetentionDate(job.dueAt)}
                        {job.studyId ? ` · ${job.studyId}` : ""}
                      </div>
                      {job.lastError && (
                        <span className="text-xs text-error">{job.lastError}</span>
                      )}
                    </div>
                    {(job.status === "FAILED" || job.status === "DEAD") && (
                      <button
                        type="button"
                        onClick={() => void retryRetentionJob(job.id)}
                        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-raised"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Legal holds
            </div>
            <div className="flex flex-col gap-2">
              <input
                value={holdStudyId}
                onChange={(e) => setHoldStudyId(e.target.value)}
                placeholder="Study ID"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                >
                  {RETENTION_LOCK_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={holdExpiresAt}
                  onChange={(e) => setHoldExpiresAt(e.target.value)}
                  aria-label="Hold expiry"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => void applyHold()}
                disabled={holdBusy || !holdStudyId.trim()}
                className="self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
              >
                Apply hold
              </button>
            </div>

            {heldCandidates.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {heldCandidates.map((candidate) => (
                  <div
                    key={candidate.studyId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised/50 px-3 py-2"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs text-text-primary">
                        {candidate.accessionNumber}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {candidate.lockReason ?? "LEGAL_HOLD"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void releaseHold(candidate.studyId)}
                      disabled={holdBusy}
                      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface-raised disabled:opacity-50"
                    >
                      Release
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
