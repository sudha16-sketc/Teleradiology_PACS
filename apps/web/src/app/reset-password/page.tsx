"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Eye, EyeOff } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { ApiError } from "@axis/types";

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent";

function isStrongPassword(value: string): boolean {
  if (value.length < 8 || value.length > 128) return false;
  return [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length >= 3;
}

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const resetToken = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(resetToken);
    if (resetToken) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!isStrongPassword(password)) {
      setError("Use 8–128 characters with at least three of lowercase, uppercase, number, and symbol.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post("/auth/reset-password", { token, password, confirmPassword });
      setComplete(true);
    } catch (err) {
      setError((err as ApiError).message ?? "Unable to reset your password. The link may be invalid or expired.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-light flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <Activity size={24} className="text-accent" />
        <span className="font-heading text-xl font-bold tracking-tight text-text-primary">
          Axis
        </span>
      </div>
      <div className="w-full max-w-sm rounded-md border border-border bg-surface p-6">
        <h1 className="font-heading text-lg font-bold text-text-primary">Reset your password</h1>
        <p className="mt-1 text-sm text-text-muted">
          Choose a new password for your Axis account.
        </p>

        {complete ? (
          <div role="status" aria-live="polite" className="mt-5 rounded-md border border-success/30 bg-success/10 px-3 py-3 text-sm text-text-primary">
            Your password has been reset. You can now sign in with your new password.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {error && (
              <div role="alert" className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {error}
              </div>
            )}
            {!token && (
              <div role="alert" className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                This reset link is invalid or expired.
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">New password</span>
              <span className="relative block">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-text-muted hover:text-text-primary"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              <span className="mt-1 block text-xs text-text-muted">
                8–128 characters; at least three character types (lowercase, uppercase, number, symbol).
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">Confirm new password</span>
              <span className="relative block">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((shown) => !shown)}
                  aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-text-muted hover:text-text-primary"
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <button
              type="submit"
              disabled={submitting || !token}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Reset Password"}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-text-muted">
          <Link href="/login" className="font-medium text-accent hover:text-accent/80">
            Return to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
