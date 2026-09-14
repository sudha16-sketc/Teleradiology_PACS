import Link from "next/link";

export default function CtaSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-navy-950 to-navy-900 py-24 sm:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(37,99,235,0.12),transparent_65%)]"
      />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
          Bring your radiology workflow into one connected platform.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
          Connect study submission, DICOM imaging, radiologist reporting,
          verification and hospital delivery in a controlled workflow.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-semibold text-navy-900 transition-colors hover:bg-slate-100"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="inline-flex h-12 items-center justify-center rounded-full border border-white/30 px-8 text-sm font-semibold text-white transition-colors hover:border-white/60 hover:bg-white/10"
          >
            Request Access
          </Link>
        </div>
      </div>
    </section>
  );
}