import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-16 text-slate-200">
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-navy-900/70 p-8 text-center shadow-xl">
        <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-teal-300">
          404 / Not found
        </p>
        <h1 className="mt-4 font-heading text-3xl font-bold text-white">
          This page does not exist
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          The address may be incorrect, or the page may have moved. Use the links
          below to return to a known destination.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-navy-950 transition-colors hover:bg-teal-400"
          >
            Home
          </Link>
          <Link
            href="/documentation"
            className="rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-teal-300 hover:text-teal-200"
          >
            Documentation
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-teal-300 hover:text-teal-200"
          >
            Sign In
          </Link>
        </div>
      </div>
    </main>
  );
}
