"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import type { AuthUser, ApiError } from "@axis/types";

interface LoginResponse {
  data: AuthUser;
}

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent";

export default function LoginPage() {
  const router = useRouter();
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.post<LoginResponse>("/auth/login", {
        email,
        password,
      });
      setCurrentUser(res.data);
      router.replace("/worklist");
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message ?? "Unable to sign in. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <Activity size={24} className="text-accent" />
        <span className="font-heading text-xl font-bold tracking-tight text-text-primary">
          Axis
        </span>
      </div>

      <div className="w-full max-w-sm rounded-md border border-border bg-surface p-6">
        <h1 className="font-heading text-lg font-bold text-text-primary">
          Sign in to Axis
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Continue to your teleradiology worklist.
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@axisradiology.com"
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-text-muted">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-medium text-accent hover:text-accent/80"
          >
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}