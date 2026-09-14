"use client";

import type { ReactNode } from "react";
import { useInView } from "@/components/landing/useInView";

type SecurityFeature = {
  title: string;
  description: string;
  icon: ReactNode;
};

const features: SecurityFeature[] = [
  {
    title: "Role-Based Access",
    description: "Each user sees only what their role permits.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: "Hospital Data Isolation",
    description: "Hospitals access only their own organizational data.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 21h18" />
        <path d="M5 21V7l8-4v18" />
        <path d="M19 21V11l-6-4" />
        <path d="M9 9v.01" />
        <path d="M9 12v.01" />
        <path d="M9 15v.01" />
      </svg>
    ),
  },
  {
    title: "Assignment Isolation",
    description: "Radiologists access only studies assigned to them.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Controlled Permissions",
    description: "Managers manage workflow without altering clinical content.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    title: "Immutable Reports",
    description: "Signed report versions remain preserved and unaltered.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
        <path d="M10 9H8" />
      </svg>
    ),
  },
  {
    title: "Audit Trail",
    description: "Important workflow actions are tracked throughout.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </svg>
    ),
  },
  {
    title: "Secure DICOM Handling",
    description: "DICOM studies are processed in a controlled environment.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="m8 13 3-3 4 4 2-2 3 3" />
        <path d="M8 21h8" />
      </svg>
    ),
  },
  {
    title: "Retention Controls",
    description: "Administrators configure backup and retention policies.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </svg>
    ),
  },
];

function SecurityCard({ feature, index }: { feature: SecurityFeature; index: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${index * 80}ms` }}
      className={`group rounded-xl border border-white/10 bg-white/5 p-6 transition-all duration-500 ease-out hover:border-teal-400/30 hover:bg-white/10 hover:shadow-lg hover:shadow-teal-500/5 ${
        inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400 transition-colors duration-300 group-hover:bg-teal-500/20">
        {feature.icon}
      </div>
      <h3 className="text-base font-semibold text-white">{feature.title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-slate-300">{feature.description}</p>
    </div>
  );
}

export default function SecuritySection() {
  const { ref: headingRef, inView: headingInView } = useInView<HTMLDivElement>();

  return (
    <section id="security" className="relative overflow-hidden bg-[#040e1a] py-24 sm:py-32">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(20,184,166,0.12),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div
          ref={headingRef}
          className={`mx-auto max-w-2xl text-center transition-all duration-700 ease-out ${
            headingInView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Designed around controlled access and accountability.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Managers and administrators manage workflow and verification without
            altering the clinical content authored by radiologists. Hospitals
            access only their own organizational data, and radiologists access
            only the studies assigned to them.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {features.map((feature, index) => (
            <SecurityCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}