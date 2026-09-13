"use client";

import type { ReactNode } from "react";
import { useInView } from "@/components/landing/useInView";

type Role = {
  title: string;
  subtitle: string;
  capabilities: string[];
  accent: string;
  accentBg: string;
  accentRing: string;
  icon: ReactNode;
};

const roles: Role[] = [
  {
    title: "Admin",
    subtitle: "Complete operational visibility and control",
    capabilities: [
      "Manage users and approvals",
      "Configure system settings",
      "Oversee all platform activity",
      "Control backup and retention policies",
    ],
    accent: "#2563eb",
    accentBg: "bg-blue-100",
    accentRing: "ring-blue-600",
    icon: (
      <svg className="h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2 3 7v6c0 5.25 3.75 10.74 9 12 5.25-1.26 9-6.75 9-12V7l-9-5Z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Manager",
    subtitle: "Coordinate studies, assignments and verification",
    capabilities: [
      "Receive incoming hospital studies",
      "Assign studies to radiologists",
      "Verify reports without altering content",
      "Monitor workflow status",
    ],
    accent: "#14b8a6",
    accentBg: "bg-teal-100",
    accentRing: "ring-teal-600",
    icon: (
      <svg className="h-5 w-5 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M12 11h4" />
        <path d="M12 16h4" />
        <path d="M8 11h.01" />
        <path d="M8 16h.01" />
      </svg>
    ),
  },
  {
    title: "Hospital",
    subtitle: "Submit studies and receive verified reports",
    capabilities: [
      "Upload DICOM ZIP files",
      "Submit patient information",
      "Track submitted studies",
      "Review and accept reports",
    ],
    accent: "#10b981",
    accentBg: "bg-emerald-100",
    accentRing: "ring-emerald-600",
    icon: (
      <svg className="h-5 w-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 21h18" />
        <path d="M5 21V7l8-4v18" />
        <path d="M19 21V11l-6-4" />
        <path d="M9 9v.01" />
        <path d="M9 12v.01" />
        <path d="M9 15v.01" />
        <path d="M9 18v.01" />
      </svg>
    ),
  },
  {
    title: "Radiologist",
    subtitle: "Read studies and create clinical reports",
    capabilities: [
      "View assigned studies",
      "Open DICOM in integrated viewer",
      "Write, verify, and sign reports",
      "Handle correction requests",
    ],
    accent: "#7c3aed",
    accentBg: "bg-violet-100",
    accentRing: "ring-violet-600",
    icon: (
      <svg className="h-5 w-5 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
        <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4" />
        <circle cx="20" cy="10" r="2" />
      </svg>
    ),
  },
];

function RoleCard({ role, index }: { role: Role; index: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      style={{
        borderLeftColor: role.accent,
        transitionDelay: `${index * 120}ms`,
      }}
      className={`group rounded-xl border-l-4 border-t border-r border-b border-t-slate-200 border-r-slate-200 border-b-slate-200 bg-white p-7 shadow-md shadow-slate-200/50 transition-all duration-500 ease-out hover:-translate-y-1 hover:shadow-lg ${
        inView ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      }`}
    >
      <div className="mb-5 flex items-center gap-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${role.accentBg} ring-1 ring-inset ${role.accentRing}/20`}
        >
          {role.icon}
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">{role.title}</h3>
          <p className="mt-0.5 text-sm leading-5 text-slate-500">
            {role.subtitle}
          </p>
        </div>
      </div>
      <ul className="space-y-2.5">
        {role.capabilities.map((cap) => (
          <li key={cap} className="flex items-start gap-2.5 text-sm leading-5 text-slate-600">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ color: role.accent }}
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
            {cap}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RolesSection() {
  const { ref: headingRef, inView: headingInView } = useInView<HTMLDivElement>();

  return (
    <section id="about" className="bg-slate-50 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <div
          ref={headingRef}
          className={`mx-auto max-w-2xl text-center transition-all duration-700 ease-out ${
            headingInView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            One platform. Four connected roles.
          </h2>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {roles.map((role, index) => (
            <RoleCard key={role.title} role={role} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}