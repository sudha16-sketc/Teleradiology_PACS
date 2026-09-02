import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="font-heading text-5xl font-bold tracking-tight text-accent">
        Axis
      </h1>
      <p className="text-lg text-text-muted">
        Teleradiology PACS Workflow Platform
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Link
          href="/login"
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          Sign In
        </Link>
        <Link
          href="/register"
          className="rounded-md border border-border px-6 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-surface"
        >
          Register
        </Link>
      </div>
    </main>
  );
}