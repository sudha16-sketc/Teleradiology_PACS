"use client";

import { useInView } from "@/components/landing/useInView";

const steps = [
  {
    title: "DICOM ZIP",
    description: "Hospitals submit studies",
    icon: (
      <svg
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        <path d="M9 13h6" />
        <path d="M12 10v6" />
      </svg>
    ),
  },
  {
    title: "Study Processing",
    description: "Automated organization",
    icon: (
      <svg
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
      </svg>
    ),
  },
  {
    title: "DICOM Viewer",
    description: "Integrated imaging",
    icon: (
      <svg
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="m8 13 3-3 4 4 2-2 3 3" />
        <path d="M8 21h8" />
      </svg>
    ),
  },
  {
    title: "Radiologist",
    description: "Authorized access",
    icon: (
      <svg
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </svg>
    ),
  },
  {
    title: "Clinical Report",
    description: "Delivered result",
    icon: (
      <svg
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h8" />
      </svg>
    ),
  },
];

function Arrow({ vertical }: { vertical?: boolean }) {
  if (vertical) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto h-4 w-4 text-blue-600"
        aria-hidden="true"
      >
        <path d="M8 2.5v11M3.5 9l4.5 4.5L12.5 9" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="hidden h-6 w-6 shrink-0 text-blue-600 lg:block"
      aria-hidden="true"
    >
      <path d="M2.5 8h11M9 3.5L13.5 8 9 12.5" />
    </svg>
  );
}

export default function DicomSection() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            From DICOM acquisition to clinical report.
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Hospitals submit DICOM ZIP files with patient information. The
            platform processes and organizes studies so authorized radiologists
            can access them through the integrated medical imaging viewer.
          </p>
        </div>

        <div
          ref={ref}
          className={`mt-14 flex flex-col items-stretch gap-4 transition-all duration-700 ease-out lg:flex-row lg:items-center ${
            inView ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          }`}
        >
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-center"
            >
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-6 text-center lg:flex-1">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm">
                  {step.icon}
                </div>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-1 text-xs text-slate-500">{step.description}</p>
              </div>
              {index < steps.length - 1 && (
                <>
                  <Arrow vertical />
                  <Arrow />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}