"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UserPlus,
  X,
  Search,
  Loader2,
  RefreshCw,
  Eye,
} from "lucide-react";
import { clsx } from "clsx";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { RoleBadge } from "@/components/admin/RoleBadge";
import type { ApiError, User, UserRole, UserStatus } from "@axis/types";

const ROLES: UserRole[] = [
  "ADMIN",
  "COORDINATOR",
  "RADIOLOGIST",
  "TECHNICIAN",
  "HOSPITAL_USER",
];

const STATUS_LABELS: Record<UserStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Active",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};

interface UserEnvelope {
  data: User[];
}

interface SingleUserEnvelope {
  data: User;
}

interface UserFormState {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;
  phone: string;
  organization: string;
  licenseNumber: string;
}

const INITIAL_FORM: UserFormState = {
  displayName: "",
  email: "",
  password: "",
  role: "RADIOLOGIST",
  phone: "",
  organization: "",
  licenseNumber: "",
};

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<UserFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<UserEnvelope>("/users", {
        params: {
          search: search || undefined,
          role: (roleFilter as UserRole) || undefined,
          status: (statusFilter as UserStatus) || undefined,
        },
      });
      setUsers(res.data);
    } catch (err) {
      setError((err as ApiError).message ?? "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setForm(INITIAL_FORM);
    setFormError(null);
    setDetailUser(null);
    setIsFormOpen(true);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);
    try {
      await apiClient.post<SingleUserEnvelope>("/users", {
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        phone: form.phone.trim() || undefined,
        organization: form.organization.trim() || undefined,
        licenseNumber: form.licenseNumber.trim() || undefined,
      });
      setIsFormOpen(false);
      await load();
    } catch (err) {
      setFormError((err as ApiError).message ?? "Failed to create user.");
    } finally {
      setFormSubmitting(false);
    }
  }

  async function changeRole(user: User, role: UserRole) {
    setActionError(null);
    try {
      await apiClient.patch<SingleUserEnvelope>(`/users/${user.id}`, { role });
      await load();
    } catch (err) {
      setActionError((err as ApiError).message ?? "Failed to update role.");
    }
  }

  async function setUserStatus(user: User, status: UserStatus) {
    setActionError(null);
    try {
      await apiClient.patch<SingleUserEnvelope>(`/users/${user.id}`, { status });
      setDetailUser(null);
      await load();
    } catch (err) {
      setActionError((err as ApiError).message ?? "Failed to update user.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-text-primary">
            User Management
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage accounts, roles, and account status. Changes apply to the
            next authenticated request.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
        >
          <UserPlus size={14} />
          Add User
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}
      {actionError && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {actionError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or organization…"
            className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
        >
          <option value="">All Roles</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role.replace("_", " ")}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
        >
          <option value="">All Statuses</option>
          {(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as UserStatus[]).map(
            (status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ),
          )}
        </select>

        <button
          onClick={() => load()}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted">
            <Loader2 size={16} className="animate-spin" />
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-sm text-text-muted">
            No users match your filters.
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
                  Role
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Organization
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                  Role & Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3 text-sm text-text-primary">
                    {user.displayName}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted">
                    {user.organization ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        (user.status ?? "APPROVED") === "APPROVED"
                          ? "bg-success/10 text-success"
                          : (user.status ?? "") === "SUSPENDED"
                            ? "bg-warning/10 text-warning"
                            : "bg-surface-raised text-text-muted",
                      )}
                    >
                      {STATUS_LABELS[user.status ?? "APPROVED"]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <select
                        value={user.role}
                        onChange={(e) =>
                          changeRole(user, e.target.value as UserRole)
                        }
                        className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none transition-colors focus:border-accent"
                        aria-label={`Change role for ${user.displayName}`}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setDetailUser(user)}
                        className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
                      >
                        <Eye size={14} /> View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add user modal */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !formSubmitting && setIsFormOpen(false)}
        >
          <form
            onSubmit={handleAdd}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-md border border-border bg-surface-raised p-6 shadow-lg"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-text-primary">
                Add User
              </h2>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="rounded p-1 text-text-muted transition-colors hover:text-text-primary"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {formError && (
              <div className="mb-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Full Name
                </span>
                <input
                  type="text"
                  required
                  value={form.displayName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, displayName: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Email
                </span>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Temporary Password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Role
                </span>
                <select
                  value={form.role}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, role: e.target.value as UserRole }))
                  }
                  className={inputClass}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Phone
                </span>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  Organization
                </span>
                <input
                  type="text"
                  value={form.organization}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, organization: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">
                  License Number
                </span>
                <input
                  type="text"
                  value={form.licenseNumber}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, licenseNumber: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                disabled={formSubmitting}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={formSubmitting}
                className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:opacity-60"
              >
                {formSubmitting && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Create User
              </button>
            </div>
          </form>
        </div>
      )}

      {/* User detail modal */}
      {detailUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDetailUser(null)}
        >
          <div
            className="w-full max-w-md rounded-md border border-border bg-surface-raised p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-text-primary">
                User Details
              </h2>
              <button
                type="button"
                onClick={() => setDetailUser(null)}
                className="rounded p-1 text-text-muted transition-colors hover:text-text-primary"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Name
                </dt>
                <dd className="text-right text-text-primary">
                  {detailUser.displayName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Email
                </dt>
                <dd className="font-mono text-xs text-text-primary">
                  {detailUser.email}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Role
                </dt>
                <dd className="text-right">
                  <RoleBadge role={detailUser.role} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Status
                </dt>
                <dd className="text-right text-text-primary">
                  {STATUS_LABELS[detailUser.status ?? "APPROVED"]}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Phone
                </dt>
                <dd className="text-right text-text-primary">
                  {detailUser.phone ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Organization
                </dt>
                <dd className="text-right text-text-primary">
                  {detailUser.organization ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  License
                </dt>
                <dd className="text-right text-text-primary">
                  {detailUser.licenseNumber ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Created
                </dt>
                <dd className="text-right font-mono text-xs text-text-primary">
                  {formatDateTime(detailUser.createdAt)}
                </dd>
              </div>
              {detailUser.status === "SUSPENDED" && (
                <div className="flex justify-between gap-4">
                  <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">
                    Info
                  </dt>
                  <dd className="text-right text-xs text-warning">
                    This user is suspended and cannot sign in.
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-6 flex justify-end gap-2">
              {detailUser.status === "SUSPENDED" ? (
                <button
                  type="button"
                  onClick={() => setUserStatus(detailUser, "APPROVED")}
                  className="flex items-center gap-1.5 rounded-md bg-success px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-success/90"
                >
                  <RefreshCw size={14} />
                  Reactivate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setUserStatus(detailUser, "SUSPENDED")}
                  className="flex items-center gap-1.5 rounded-md bg-error px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-error/90"
                >
                  Suspend
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}