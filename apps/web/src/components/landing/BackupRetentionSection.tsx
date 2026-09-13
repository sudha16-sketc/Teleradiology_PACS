"use client";

import { useInView } from "@/components/landing/useInView";

const steps = [
  "Primary Data",
  "Archive / Backup",
  "Verification",
  "Retention Cleanup",
];

export default function BackupRetentionSection() {
  const { ref: headingRef, inView: headingInView } = useInView<HTMLDivElement>();
  const { ref: flowRef, inView: flowInView } = useInView<HTMLDivElement>();

  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div
          ref={headingRef}
          className={`mx-auto max-w-2xl text-center transition-all duration-700 ease-out ${
            headingInView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Control how long operational data remains available.
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Administrators configure operational retention and backup policies.
            Completed workflow data stays in the primary environment for a
            defined period before eligible data is archived according to policy.
          </p>
        </div>

        <div
          ref={flowRef}
          className={`mt-14 flex flex-col items-center gap-3 transition-all duration-700 ease-out sm:flex-row sm:justify-center sm:gap-0 ${
            flowInView ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          }`}
        >
          {steps.map((step, index) => (
            <div
              key={step}
              className="flex flex-col items-center gap-3 sm:flex-row"
            >
              <div className="flex h-14 w-40 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-center text-sm font-semibold text-slate-700">
                {step}
              </div>
              {index < steps.length - 1 && (
                <>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 rotate-90 text-slate-300 sm:mx-3 sm:rotate-0"
                    aria-hidden="true"
                  >
                    <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />
                  </svg>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}