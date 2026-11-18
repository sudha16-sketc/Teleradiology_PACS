"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { ApiError } from "@axis/types";

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/auth/forgot-password", { email });
      setSubmitted(true);
    } catch (err) {
      setError((err as ApiError).message ?? "Unable to process your request. Please try again.");
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
        <h1 className="font-heading text-lg font-bold text-text-primary">
          Forgot your password?
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Enter your registered email and we&apos;ll send reset instructions if an account matches.
        </p>

        {submitted ? (
          <div
            role="status"
            className="mt-5 rounded-md border border-success/30 bg-success/10 px-3 py-3 text-sm text-text-primary"
          >
            If an account exists for that email, password reset instructions will be sent.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {error && (
              <div role="alert" className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {error}
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send Reset Instructions"}
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
