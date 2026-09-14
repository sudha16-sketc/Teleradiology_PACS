"use client";

import { useInView } from "@/components/landing/useInView";

const beforeSteps = [
  "Hospital",
  "DICOM files",
  "Multiple systems",
  "Manual communication",
  "Report delivery",
];

const solutionSteps = [
  "Hospital",
  "Secure DICOM Submission",
  "Managed Worklist",
  "Radiologist",
  "Structured Report",
  "Verification",
  "Hospital",
];

const stepDelays = [
  "delay-100",
  "delay-200",
  "delay-300",
  "delay-400",
  "delay-500",
  "delay-500",
  "delay-500",
];

function DownArrow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8 2.5v11M3.5 9l4.5 4.5L12.5 9" />
    </svg>
  );
}

function Panel({ steps, tone }: { steps: string[]; tone: "before" | "solution" }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const isBefore = tone === "before";

  return (
    <div
      ref={ref}
      className={`rounded-2xl border p-6 sm:p-8 ${
        isBefore ? "border-red-100 bg-red-50/40" : "border-teal-100 bg-teal-50/40"
      }`}
    >
      <span
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-widest ${
          isBefore
            ? "border-red-200 bg-red-100 text-red-600"
            : "border-teal-200 bg-teal-100 text-teal-700"
        }`}
      >
        {isBefore ? "Before" : "With the Platform"}
      </span>
      <h3 className="mt-4 text-xl font-semibold text-slate-900">
        {isBefore ? "Fragmented, manual, hard to audit" : "One connected, verifiable workflow"}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {isBefore
          ? "Studies move through disconnected tools. Reports get delayed, handoffs happen over email and phone, and nothing is centralized."
          : "Every handoff is tracked, every report is structured and verified, and everything lives in one place."}
      </p>
      <ol className="mt-8 flex flex-col">
        {steps.map((step, index) => (
          <li
            key={`${tone}-${step}`}
            className={`flex flex-col ${
              inView
                ? `animate-fade-in-up ${stepDelays[index]}`
                : "opacity-0-initial"
            }`}
          >
            <div
              className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm ${
                isBefore ? "border-red-100" : "border-teal-100"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isBefore ? "bg-red-50 text-red-500" : "bg-teal-50 text-teal-600"
                }`}
              >
                {index + 1}
              </span>
              <span className="text-sm font-medium text-slate-700">{step}</span>
            </div>
            {index < steps.length - 1 && (
              <div className="flex justify-center py-2">
                <DownArrow
                  className={isBefore ? "h-4 w-4 text-red-300" : "h-4 w-4 text-teal-300"}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function ProblemSolution() {
  return (
    <section id="platform" className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Radiology workflows shouldn&apos;t be fragmented.
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Hospitals juggle separate PACS viewers, messaging tools, and reporting
            documents. Studies move between disconnected systems, handoffs happen
            over email and phone, and nothing is auditable end to end.
          </p>
        </div>
        <div className="mt-14 grid items-start gap-6 lg:grid-cols-2">
          <Panel steps={beforeSteps} tone="before" />
          <Panel steps={solutionSteps} tone="solution" />
        </div>
      </div>
    </section>
  );
}