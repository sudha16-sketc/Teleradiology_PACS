"use client";

import { useInView } from "@/components/landing/useInView";

const capabilityBadges = [
  { label: "Draft", position: "-left-6 top-8 lg:-left-16" },
  { label: "Verify", position: "-right-4 top-24 lg:-right-16" },
  { label: "Sign", position: "-left-4 top-40 lg:-left-16" },
  { label: "Export", position: "-right-6 top-56 lg:-right-16" },
];

const reportSections = [
  { label: "Clinical Information", lines: 2 },
  { label: "Technique", lines: 1 },
  { label: "Findings", lines: 3 },
  { label: "Impression", lines: 2 },
];

function PlaceholderLines({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full bg-slate-200 ${
            i === count - 1 ? "w-3/5" : "w-full"
          }`}
        />
      ))}
    </div>
  );
}

function ToolbarIcon({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        className="h-5 w-5 text-blue-600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span className="text-[10px] font-medium text-slate-500">{label}</span>
    </div>
  );
}

export default function ReportingSection() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            A reporting workspace built around the radiologist.
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Radiologists receive a clean professional workspace to review
            imaging, write findings, create impressions, save drafts, verify,
            sign, and export reports.
          </p>
        </div>

        <div
          ref={ref}
          className={`relative mx-auto mt-14 max-w-2xl transition-all duration-700 ease-out ${
            inView ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          }`}
        >
          {capabilityBadges.map((badge) => (
            <div
              key={badge.label}
              className={`absolute ${badge.position} hidden items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 sm:flex`}
            >
              <span className="text-xs font-semibold text-blue-600">
                {badge.label}
              </span>
            </div>
          ))}

          <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
            <div className="rounded-t-2xl border-b border-slate-100 bg-slate-50 px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  Report Workspace
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-blue-600">
                  Interface illustration
                </span>
              </div>
            </div>

            <div className="space-y-6 px-6 py-8">
              {reportSections.map((section) => (
                <div key={section.label}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">
                      {section.label}
                    </span>
                    <span className="h-px flex-1 bg-slate-100 ml-3" />
                  </div>
                  <PlaceholderLines count={section.lines} />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-8 rounded-b-2xl border-t border-slate-100 bg-slate-50 px-6 py-4">
              {["Save", "Verify", "Sign", "Export"].map((action) => (
                <ToolbarIcon key={action} label={action} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}