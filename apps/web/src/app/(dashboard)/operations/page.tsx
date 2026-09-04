"use client";

import { useEffect, useState } from "react";
import {
  Database,
  DatabaseBackup,
  Settings2,
  Archive,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/ErrorState";

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
  sizeBytes?: string | null;
  checksum?: string | null;
}

const MINUTES_LABEL: Record<string, string> = {
  STAT: "STAT (urgent)",
  URGENT: "URGENT",
  ROUTINE: "ROUTINE",
};

export default function OperationsPage() {
  const [error, setError] = useState(false);
  const [slaRows, setSlaRows] = useState<SlaRow[]>([]);
  const [slaDefaults, setSlaDefaults] = useState<Record<string, number>>({});
  const [slaDraft, setSlaDraft] = useState<Record<string, string>>({});
  const [slaSaving, setSlaSaving] = useState(false);

  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [backupType, setBackupType] = useState("DATABASE");
  const [backupRunning, setBackupRunning] = useState(false);

  const [retentionPreview, setRetentionPreview] = useState<object | null>(null);
  const [retentionBusy, setRetentionBusy] = useState(false);

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

  const load = async () => {
    setError(false);
    await Promise.all([loadSla(), loadBackups()]);
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

  const runRetentionPreview = async () => {
    setRetentionBusy(true);
    try {
      const res = await apiClient.get<object>("/admin/retention/preview");
      setRetentionPreview(res);
    } catch (e) {
      console.error(e);
    } finally {
      setRetentionBusy(false);
    }
  };

  const runRetentionExecute = async () => {
    setRetentionBusy(true);
    try {
      const res = await apiClient.post<object>("/admin/retention/execute");
      setRetentionPreview(res);
      await loadBackups();
    } catch (e) {
      console.error(e);
    } finally {
      setRetentionBusy(false);
    }
  };

  if (error) {
    return (
      <ErrorState title="Failed to load operations data" description="Check that you are an administrator." onRetry={() => load()} />
    );
  }

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
          PostgreSQL dumps and Orthanc volume snapshots, checksummed and recorded
          in the audit log.
        </p>

        <div className="flex items-center gap-3">
          <select
            value={backupType}
            onChange={(e) => setBackupType(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="DATABASE">Database only</option>
            <option value="DICOM">DICOM (Orthanc volume)</option>
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
                className="flex items-center justify-between rounded-md border border-border bg-surface-raised/50 px-4 py-2.5"
              >
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
                </div>
                {b.status === "COMPLETED" && (
                  <button
                    onClick={() => verifyBackup(b.id)}
                    className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs font-medium text-text-primary hover:bg-surface-raised"
                  >
                    <ShieldCheck size={13} />
                    Verify
                  </button>
                )}
              </div>
            ))
          )}
        </div>
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

        {retentionPreview && (
          <div className="mt-4 rounded-md border border-border bg-surface-raised/50 p-4 text-sm">
            <pre className="whitespace-pre-wrap font-mono text-xs text-text-muted">
              {JSON.stringify(retentionPreview, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
