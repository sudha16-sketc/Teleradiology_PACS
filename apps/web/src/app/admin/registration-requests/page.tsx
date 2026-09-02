"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  X,
  UserPlus,
  Info,
  ClipboardList,
  Loader2,
} from "lucide-react";
import { clsx } from "clsx";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { RegistrationRequest, UserRole, ApiError } from "@axis/types";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "ADMIN", label: "Administrator" },
  { value: "COORDINATOR", label: "Coordinator" },
  { value: "RADIOLOGIST", label: "Radiologist" },
  { value: "TECHNICIAN", label: "Technician" },
  { value: "HOSPITAL_USER", label: "Hospital User" },
];

interface RequestEnvelope {
  data: RegistrationRequest[];
}

export default function RegistrationRequestsPage() {
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"PENDING" | "ALL">("PENDING");

  const [approving, setApproving] = useState<RegistrationRequest | null>(null);
  const [finalRole, setFinalRole] = useState<UserRole>("RADIOLOGIST");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<RegistrationRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<RequestEnvelope>(
        "/auth/registration-requests",
        statusFilter === "PENDING" ? { params: { status: "PENDING" } } : undefined,
      );
      setRequests(res.data);
    } catch (err) {
      setError((err as ApiError).message ?? "Failed to load registration requests.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove() {
    if (!approving) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await apiClient.post(`/auth/registration-requests/${approving.id}/approve`, {
        role: finalRole,
      });
      setApproving(null);
      await load();
    } catch (err) {
      setActionError((err as ApiError).message ?? "Failed to approve request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!rejecting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await apiClient.post(`/auth/registration-requests/${rejecting.id}/reject`, {
        reason: rejectReason || undefined,
      });
      setRejecting(null);
      setRejectReason("");
      await load();
    } catch (err) {
      setActionError((err as ApiError).message ?? "Failed to reject request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <ClipboardList size={20} className="text-text-muted" />
            <h1 className="font-heading text-xl font-bold text-text-primary">
              Registration Requests
            </h1>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Review applicants and assign their final role. Requested roles are
            never auto-trusted.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["PENDING", "ALL"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={clsx(
              "relative px-4 py-2 text-sm font-medium transition-colors",
              statusFilter === tab
                ? "text-accent"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            {tab === "PENDING" ? "Pending" : "All"}
            {statusFilter === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div className="rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted">
            <Loader2 size={16} className="animate-spin" />
            Loading requests…
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <UserPlus size={40} strokeWidth={1} className="text-text-muted" />
            <p className="text-sm text-text-muted">
              {statusFilter === "PENDING"
                ? "No pending registration requests."
                : "No registration requests found."}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Name
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Email
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Requested Role
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Organization
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Submitted
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr
                  key={req.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3 text-sm text-text-primary">
                    {req.displayName}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">
                    {req.email}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-primary">
                    {req.requestedRole
                      ? req.requestedRole.replace("_", " ")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted">
                    {req.organization ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">
                    {formatDateTime(req.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        req.status === "PENDING"
                          ? "bg-warning/10 text-warning"
                          : req.status === "APPROVED"
                            ? "bg-success/10 text-success"
                            : "bg-error/10 text-error",
                      )}
                    >
                      {req.status.charAt(0) + req.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {req.status === "PENDING" ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setApproving(req)}
                          className="flex items-center gap-1 text-xs font-medium text-success hover:text-success/80"
                        >
                          <Check size={14} /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejecting(req)}
                          className="flex items-center gap-1 text-xs font-medium text-error hover:text-error/80"
                        >
                          <X size={14} /> Reject
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setApproving(req);
                          setFinalRole(req.role);
                        }}
                        className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
                      >
                        <Info size={14} /> View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Approve modal */}
      {approving && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !submitting && setApproving(null)}
        >
          <div
            className="w-full max-w-md rounded-md border border-border bg-surface-raised p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-heading text-base font-bold text-text-primary">
              Review & Approve
            </h2>

            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="inline text-xs font-medium uppercase tracking-wider text-text-muted">
                  Applicant
                </dt>
                <dd className="text-text-primary">
                  {approving.displayName}
                </dd>
              </div>
              <div>
                <dt className="inline text-xs font-medium uppercase tracking-wider text-text-muted">
                  Email
                </dt>
                <dd className="font-mono text-xs text-text-primary">
                  {approving.email}
                </dd>
              </div>
              <div>
                <dt className="inline text-xs font-medium uppercase tracking-wider text-text-muted">
                  Phone
                </dt>
                <dd className="text-text-primary">
                  {approving.phone ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="inline text-xs font-medium uppercase tracking-wider text-text-muted">
                  Organization
                </dt>
                <dd className="text-text-primary">
                  {approving.organization ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="inline text-xs font-medium uppercase tracking-wider text-text-muted">
                  License Number
                </dt>
                <dd className="text-text-primary">
                  {approving.licenseNumber ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="inline text-xs font-medium uppercase tracking-wider text-text-muted">
                  Requested Role
                </dt>
                <dd className="text-text-primary">
                  {approving.requestedRole
                    ? approving.requestedRole.replace("_", " ")
                    : "—"}
                </dd>
              </div>
            </dl>

            <label className="mt-5 block">
              <span className="mb-1 block text-xs font-medium text-text-muted">
                Final Role (admin decides)
              </span>
              <select
                value={finalRole}
                onChange={(e) => setFinalRole(e.target.value as UserRole)}
                disabled={submitting}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            {actionError && (
              <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {actionError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApproving(null)}
                disabled={submitting}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-md bg-success px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-success/90 disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                Approve as {finalRole.replace("_", " ")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejecting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !submitting && setRejecting(null)}
        >
          <div
            className="w-full max-w-md rounded-md border border-border bg-surface-raised p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-heading text-base font-bold text-text-primary">
              Reject Registration
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Rejecting <span className="font-medium text-text-primary">{rejecting.displayName}</span>{" "}
              (<span className="font-mono">{rejecting.email}</span>).
            </p>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-medium text-text-muted">
                Reason (optional)
              </span>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="e.g. Professional credentials could not be verified."
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-error"
              />
            </label>

            {actionError && (
              <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {actionError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejecting(null)}
                disabled={submitting}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-md bg-error px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-error/90 disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <X size={14} />
                )}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}