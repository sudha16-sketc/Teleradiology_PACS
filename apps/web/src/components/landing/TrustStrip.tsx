"use client";

import Link from "next/link";
import { useInView } from "@/components/landing/useInView";

const items = [
  {
    href: "#features",
    label: "Role-Based Access",
    sublabel: "Controlled permissions",
    icon: (
      <svg
        className="h-5 w-5"
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
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "#features",
    label: "DICOM Workflow",
    sublabel: "Submit, assign, report",
    icon: (
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    href: "#features",
    label: "Immutable Reports",
    sublabel: "Preserved versions",
    icon: (
      <svg
        className="h-5 w-5"
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
        <path d="M16 13H8" />
        <path d="M16 17H8" />
        <path d="M10 9H8" />
      </svg>
    ),
  },
  {
    href: "#features",
    label: "Audit Trail",
    sublabel: "Full accountability",
    icon: (
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </svg>
    ),
  },
];

export default function TrustStrip() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.1 });

  return (
    <section className="border-b border-border bg-white py-8" id="about">
      <div
        ref={ref}
        className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${
          inView ? "animate-fade-in-up" : "opacity-0-initial"
        }`}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              style={{ animationDelay: `${index * 100 + 200}ms` }}
              className={`group flex items-center gap-3 rounded-xl border border-border bg-surface-alt p-4 transition-colors hover:border-primary-100 hover:bg-primary-50 ${
                inView ? "animate-fade-in-up" : "opacity-0-initial"
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary transition-colors group-hover:bg-primary-100">
                {item.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {item.label}
                </p>
                <p className="text-xs text-text-muted">{item.sublabel}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}