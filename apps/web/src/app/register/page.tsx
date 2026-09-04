"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { ApiError, UserRole } from "@axis/types";

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent";

const REQUESTABLE_ROLES: { value: UserRole; label: string }[] = [
  { value: "HOSPITAL", label: "Hospital" },
  { value: "RADIOLOGIST", label: "Radiologist" },
  { value: "MANAGER", label: "Manager" },
];

interface RegisterPayload {
  displayName: string;
  email: string;
  phone?: string;
  organization?: string;
  requestedRole: UserRole;
  licenseNumber?: string;
  password: string;
  confirmPassword: string;
}

export default function RegisterPage() {
  const [form, setForm] = useState<RegisterPayload>({
    displayName: "",
    email: "",
    phone: "",
    organization: "",
    requestedRole: "RADIOLOGIST",
    licenseNumber: "",
    password: "",
    confirmPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function update<K extends keyof RegisterPayload>(key: K, value: RegisterPayload[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/auth/register", form);
      setSubmitted(true);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message ?? "Unable to submit registration. Please try again.");
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm rounded-md border border-border bg-surface p-8 text-center">
          <CheckCircle2 size={40} className="mx-auto text-success" strokeWidth={1.5} />
          <h1 className="mt-4 font-heading text-lg font-bold text-text-primary">
            Registration Submitted
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Your account request has been submitted and is awaiting
            administrator approval. You will be able to sign in once an
            administrator approves your account.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent/90"
          >
            Return to Sign In
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <Activity size={24} className="text-accent" />
        <span className="font-heading text-xl font-bold tracking-tight text-text-primary">
          Axis
        </span>
      </div>

      <div className="w-full max-w-md rounded-md border border-border bg-surface p-6">
        <h1 className="font-heading text-lg font-bold text-text-primary">
          Create your Axis account
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Submit a registration request. An administrator must approve it before
          you can sign in.
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Full Name
            </span>
            <input
              type="text"
              required
              value={form.displayName}
              onChange={(e) => update("displayName", e.target.value)}
              placeholder="Dr. Rahul Sharma"
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
              onChange={(e) => update("email", e.target.value)}
              placeholder="you@axisradiology.com"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Phone Number
            </span>
            <input
              type="tel"
              value={form.phone ?? ""}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="+91 98765 43210"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Hospital / Organization
            </span>
            <input
              type="text"
              value={form.organization ?? ""}
              onChange={(e) => update("organization", e.target.value)}
              placeholder="Metro General Hospital"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Requested Role
            </span>
            <select
              value={form.requestedRole}
              onChange={(e) => update("requestedRole", e.target.value as UserRole)}
              className={inputClass}
            >
              {REQUESTABLE_ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-text-muted">
              Administrator access cannot be requested and is only granted by an
              administrator.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              License / Registration Number (if applicable)
            </span>
            <input
              type="text"
              value={form.licenseNumber ?? ""}
              onChange={(e) => update("licenseNumber", e.target.value)}
              placeholder="MCI-123456"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Password
            </span>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              placeholder="Minimum 8 characters"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Confirm Password
            </span>
            <input
              type="password"
              required
              minLength={8}
              value={form.confirmPassword}
              onChange={(e) => update("confirmPassword", e.target.value)}
              placeholder="Repeat your password"
              className={inputClass}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit Registration"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-text-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-accent hover:text-accent/80"
          >
            Sign In
          </Link>
        </p>
      </div>
    </main>
  );
}