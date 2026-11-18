"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Building2,
  ChevronRight,
  Database,
  FileText,
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

const SECTIONS = [
  { id: "overview", title: "Overview", keywords: "purpose product teleradiology workflow hospitals radiologists" },
  { id: "why-axis", title: "Why Axis", keywords: "motivation coordination handoffs multiple hospitals" },
  { id: "features", title: "Features", keywords: "DICOM reports worklist SLA analytics corrections audit backup retention" },
  { id: "workflow", title: "How It Works", keywords: "submit ingest assign read sign review deliver accept" },
  { id: "user-guide", title: "User Guide", keywords: "hospital radiologist manager admin steps" },
  { id: "security", title: "Security & Privacy", keywords: "authentication authorization cookies audit privacy" },
  { id: "desktop", title: "Desktop Application", keywords: "desktop download native app release" },
  { id: "faq", title: "FAQ", keywords: "AI automatic routing HL7 FHIR real data" },
  { id: "resources", title: "Support & Resources", keywords: "support repository contact DICOM security" },
];

const desktopDownloadUrl = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL?.trim();

function SectionHeading({
  number,
  title,
  lead,
}: {
  number: string;
  title: string;
  lead: string;
}) {
  return (
    <header className="mb-6 max-w-3xl">
      <p className="font-mono text-xs font-semibold uppercase text-teal-700">
        {number} / Axis guide
      </p>
      <h2 className="mt-2 font-heading text-2xl font-bold text-navy-900 sm:text-3xl">
        {title}
      </h2>
      <p className="mt-3 text-base leading-7 text-slate-600">{lead}</p>
    </header>
  );
}

export default function DocumentationContent() {
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState("overview");
  const [showBackToTop, setShowBackToTop] = useState(false);

  const results = query.trim()
    ? SECTIONS.filter((section) =>
        `${section.title} ${section.keywords}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : [];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -68% 0px", threshold: 0 },
    );
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function toc(className = "") {
    return (
      <nav aria-label="Documentation sections" className={className}>
        <ol className="space-y-1">
          {SECTIONS.map((section, index) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={activeSection === section.id ? "location" : undefined}
                className={`flex items-start gap-2 rounded-sm border-l-2 px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  activeSection === section.id
                    ? "border-teal-600 bg-teal-50 font-semibold text-navy-900"
                    : "border-transparent text-slate-600 hover:bg-white hover:text-navy-900"
                }`}
              >
                <span className="w-5 shrink-0 font-mono text-[11px] text-slate-400">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    );
  }

  return (
    <div className="documentation-page min-h-screen bg-slate-50 text-navy-900">
      <a
        href="#documentation-main"
        className="sr-only z-[60] rounded bg-white p-3 text-navy-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to documentation
      </a>

      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xl font-extrabold text-navy-900">
              A<span className="text-primary">xis</span>
            </Link>
            <span className="hidden h-6 border-l border-slate-200 sm:block" />
            <span className="hidden text-sm font-medium text-slate-600 sm:block">
              Product documentation
            </span>
          </div>

          <div className="relative order-3 w-full sm:order-none sm:w-auto sm:max-w-sm sm:flex-1 sm:px-4">
            <label htmlFor="docs-search" className="sr-only">Search documentation</label>
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 sm:left-7" />
            <input
              id="docs-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documentation"
              autoComplete="off"
              aria-controls="docs-search-results"
              className="h-10 w-full rounded border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm text-navy-900 outline-none placeholder:text-slate-500 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
            {query.trim() && (
              <div id="docs-search-results" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded border border-slate-200 bg-white p-2 shadow-lg sm:left-4" aria-live="polite">
                {results.length ? (
                  <ul>
                    {results.map((section) => (
                      <li key={section.id}>
                        <a href={`#${section.id}`} onClick={() => setQuery("")} className="block rounded px-3 py-2 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                          <span className="block text-sm font-semibold">{section.title}</span>
                          <span className="block text-xs text-slate-500">Jump to this section</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-3 py-2 text-sm text-slate-600">No matching sections.</p>}
              </div>
            )}
          </div>

          <Link href="/login" className="inline-flex min-h-10 items-center rounded border border-slate-300 px-3 text-sm font-semibold text-navy-900 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
            Sign in <ChevronRight size={15} className="ml-1" />
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-12 lg:px-8 lg:py-12">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
            <div className="mb-4 flex items-center gap-2 px-3 text-xs font-semibold uppercase text-slate-500">
              <BookOpen size={15} /> On this page
            </div>
            {toc()}
            <p className="mt-6 border-t border-slate-200 px-3 pt-4 text-xs leading-5 text-slate-500">
              Product behavior described here reflects the code in this repository.
            </p>
          </div>
        </aside>

        <main id="documentation-main" className="min-w-0">
          <details className="mb-8 rounded border border-slate-200 bg-white p-4 lg:hidden">
            <summary className="cursor-pointer font-semibold text-navy-900">Documentation contents</summary>
            <div className="mt-3">{toc()}</div>
          </details>

          <article>
            <div className="border-b border-slate-200 pb-9 sm:pb-12">
              <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase text-teal-700">
                <Activity size={15} /> AXIS / FIELD GUIDE
              </p>
              <h1 className="mt-4 max-w-4xl font-heading text-4xl font-bold leading-tight text-navy-900 sm:text-5xl">
                Clinical imaging, one managed workflow.
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
                Axis is a web-based teleradiology workflow and clinical reporting platform. It
                coordinates imaging studies between hospital teams, radiologists, and operational
                reviewers. Orthanc stores the DICOM objects; OHIF provides the image viewer.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href="#user-guide" className="inline-flex min-h-11 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                  User guide <ArrowRight size={16} />
                </a>
                <a href="#workflow" className="inline-flex min-h-11 items-center rounded border border-slate-300 px-4 text-sm font-semibold text-navy-900 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                  Follow a study
                </a>
              </div>
              <div className="mt-8 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-3">
                <div><p className="font-mono text-xs uppercase text-slate-500">Primary users</p><p className="mt-1 text-sm font-semibold">Hospital, radiology, operations, admin</p></div>
                <div><p className="font-mono text-xs uppercase text-slate-500">Client</p><p className="mt-1 text-sm font-semibold">Browser-based web application</p></div>
                <div><p className="font-mono text-xs uppercase text-slate-500">Imaging</p><p className="mt-1 text-sm font-semibold">Orthanc + OHIF over guarded DICOMweb</p></div>
              </div>
            </div>

            <section id="overview" className="scroll-mt-24 border-b border-slate-200 py-10 sm:py-12">
              <SectionHeading number="01" title="Overview" lead="Axis manages the operational handoffs around diagnostic imaging rather than replacing the PACS archive or image renderer." />
              <p className="max-w-3xl leading-7 text-slate-700">
                A hospital can submit study information or upload DICOM files. Axis indexes the
                case, tracks its state, and provides role-specific views for assignment, reading,
                report review, delivery, and hospital follow-up. Workflow records live in
                PostgreSQL, while DICOM instances are stored in Orthanc.
              </p>
              <div className="mt-6 border-l-4 border-teal-600 bg-teal-50 px-5 py-4 text-sm leading-6 text-slate-700">
                <strong className="text-navy-900">Scope:</strong> Axis is workflow and reporting
                software. It does not provide an independent DICOM archive, rendering engine, or
                automated clinical interpretation.
              </div>
            </section>

            <section id="why-axis" className="scroll-mt-24 border-b border-slate-200 py-10 sm:py-12">
              <SectionHeading number="02" title="Why Axis" lead="The product is designed to give multi-hospital teleradiology teams one traceable workflow for study ownership, report state, and follow-up." />
              <div className="grid gap-6 md:grid-cols-2">
                <div className="border-t-2 border-slate-300 pt-4">
                  <h3 className="font-heading text-lg font-bold">The coordination problem</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Intake, assignment, clinical reporting, quality review, and hospital acknowledgement can be separate manual handoffs. That makes current ownership and case progress difficult to see consistently.</p>
                </div>
                <div className="border-t-2 border-teal-600 pt-4">
                  <h3 className="font-heading text-lg font-bold">What Axis centralizes</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Role-specific worklists, explicit study states, report versions, manager review, hospital acceptance, correction requests, and an audit trail are connected to the same workflow data.</p>
                </div>
              </div>
              <p className="mt-6 max-w-3xl text-sm leading-6 text-slate-500">This motivation is inferred from the implemented roles and workflow. The repository does not include comparative research or deployment outcome data.</p>
            </section>

            <section id="features" className="scroll-mt-24 border-b border-slate-200 py-10 sm:py-12">
              <SectionHeading number="03" title="Features" lead="The items below are present in the current UI and/or API. Capabilities that are only represented by data models or setup scaffolding are identified separately." />
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                <div className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">DICOM intake</h3><p className="text-sm leading-6 text-slate-600">Hospital users can upload raw DICOM instances, folders, or ZIP archives. The API validates the archive and DICOM identifiers, limits a request to one study, stores instances in Orthanc, and indexes patient/study/series/instance metadata in PostgreSQL. The default limit is 1 GiB per instance and up to 4,000 instances per upload.</p></div>
                <div className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">Worklists & assignment</h3><p className="text-sm leading-6 text-slate-600">Managers see incoming cases and assign eligible studies to approved radiologists. Radiologists see their own assigned queue. Assignment history and transitions are recorded; in-progress cases cannot be reassigned through the normal assignment route.</p></div>
                <div className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">Reading room</h3><p className="text-sm leading-6 text-slate-600">The study view brings metadata, prior-study context, report actions, and the OHIF viewer together. OHIF requests DICOMweb data through the Axis API proxy, which scopes access to the user&apos;s role and study assignment or hospital.</p></div>
                <div className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">Reports & versions</h3><p className="text-sm leading-6 text-slate-600">Radiologists can save drafts, enter clinical history, findings, impression, technique, comparison, and recommendations, flag critical findings, sign, and amend reports. Signed versions are retained as report-version records.</p></div>
                <div className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">Review & hospital delivery</h3><p className="text-sm leading-6 text-slate-600">Managers review and approve signed reports before making them available in the destination hospital portal. Hospital users can review, accept, request a change, and download a report PDF. External HL7/FHIR, email, and fax transport are not implemented.</p></div>
                <div className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">Corrections & notifications</h3><p className="text-sm leading-6 text-slate-600">Correction requests pass through manager review and radiologist follow-up. Workflow notifications are persisted for users; the API determines recipients and messages do not include report content.</p></div>
                <div className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">SLA, analytics & audit</h3><p className="text-sm leading-6 text-slate-600">Operational views summarize turnaround and hospital performance. Managers configure priority-based SLA thresholds; the server computes deadlines and breach state. Audit entries record actor, action, resource, time, and request correlation details.</p></div>
                <div className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">Operations & administration</h3><p className="text-sm leading-6 text-slate-600">Administrators manage users and registration requests, add hospitals from Settings &gt; Hospitals for registration approval, inspect audit events, initiate and verify database/DICOM backups, and preview or execute non-destructive archival of eligible completed studies.</p></div>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-slate-700"><strong className="text-navy-900">Routing rules:</strong> a rule editor and data model exist, but automatic rule evaluation is not connected. Assignments are manual.</div>
                <div className="border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-slate-700"><strong className="text-navy-900">AI jobs:</strong> job records can be monitored, but no inference provider or image-analysis pipeline is integrated.</div>
              </div>
            </section>

            <section id="workflow" className="scroll-mt-24 border-b border-slate-200 py-10 sm:py-12">
              <SectionHeading number="04" title="How It Works" lead="The API validates each transition and stores workflow state separately from the imaging objects." />
              <ol className="space-y-0 border-l border-slate-300 pl-5 sm:pl-7">
                {[
                  ["01", "Submit", "A hospital account submits metadata or uploads DICOM files. Hospital ownership is taken from the authenticated account."],
                  ["02", "Validate & index", "The API checks DICOM identifiers and archive contents, writes instances to Orthanc, and stores the study hierarchy in PostgreSQL."],
                  ["03", "Assign", "A manager reviews the incoming queue and assigns the study to an approved radiologist."],
                  ["04", "Read & report", "The radiologist opens the case, views available images in OHIF, saves a draft, and signs the report."],
                  ["05", "Review & approve", "A manager reviews the signed report and approves it before delivery."],
                  ["06", "Deliver & accept", "The approved report becomes available to the destination hospital in Axis. Hospital staff review and accept it or request changes."],
                  ["07", "Complete or correct", "The manager can complete the case. A correction workflow creates a revised report while retaining version history."],
                ].map(([step, title, description]) => (
                  <li key={step} className="relative pb-6 last:pb-0">
                    <span className="absolute -left-[1.95rem] top-0 flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white font-mono text-[10px] font-semibold text-teal-700 sm:-left-[2.45rem]">{step}</span>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
                  </li>
                ))}
              </ol>
              <div className="mt-8 overflow-x-auto rounded border border-slate-200 bg-white p-4 sm:p-5">
                <p className="mb-3 font-mono text-xs uppercase text-slate-500">Typical study-state path</p>
                <div className="flex min-w-[780px] items-center gap-2 text-xs font-semibold">
                  {["HOSPITAL_SUBMITTED", "RECEIVING / VALIDATING", "UNASSIGNED", "ASSIGNED", "IN_READING", "REPORT_DRAFT", "RADIOLOGIST_SIGNED", "MANAGER_REVIEW", "MANAGER_APPROVED", "DELIVERED_TO_HOSPITAL", "HOSPITAL_REVIEW", "HOSPITAL_ACCEPTED", "COMPLETED"].map((state, index, states) => (
                    <div key={state} className="flex items-center gap-2"><span className="whitespace-nowrap rounded-sm bg-slate-100 px-2 py-1.5 text-navy-800">{state}</span>{index < states.length - 1 && <ArrowRight size={13} className="shrink-0 text-teal-700" aria-hidden="true" />}</div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">Correction, cancellation, and hospital-change requests follow separate guarded paths. A case may be assigned before DICOM is attached.</p>
              </div>
            </section>

            <section id="user-guide" className="scroll-mt-24 border-b border-slate-200 py-10 sm:py-12">
              <SectionHeading number="05" title="User Guide" lead="The available pages and actions depend on the account role approved by an administrator. The API enforces role and study boundaries as well." />
              <div className="space-y-7">
                <div className="grid gap-3 md:grid-cols-[190px_1fr]"><div className="flex items-start gap-2 font-semibold"><Building2 size={17} className="mt-0.5 text-teal-700" /> Hospital user</div><ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-600"><li>Sign in with an approved account linked to your hospital.</li><li>Open Submit Study and choose DICOM files, a ZIP archive, or a folder of files. Submit one study at a time.</li><li>Track the case from My Studies or Study Tracker. Delivered reports appear in Received Reports, where you can open or download a PDF.</li><li>Move a delivered report into review, accept it, or submit a change request.</li></ol></div>
                <div className="grid gap-3 border-t border-slate-200 pt-6 md:grid-cols-[190px_1fr]"><div className="flex items-start gap-2 font-semibold"><Stethoscope size={17} className="mt-0.5 text-teal-700" /> Radiologist</div><ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-600"><li>Open My Worklist and select an assigned study. Filter by state, priority, or modality.</li><li>Review study metadata and priors. If DICOM is available, inspect images in OHIF.</li><li>Complete the report fields, save a draft, and sign when ready.</li><li>For an assigned correction, respond through the correction workflow and create a revised report version.</li></ol></div>
                <div className="grid gap-3 border-t border-slate-200 pt-6 md:grid-cols-[190px_1fr]"><div className="flex items-start gap-2 font-semibold"><Activity size={17} className="mt-0.5 text-teal-700" /> Manager</div><ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-600"><li>Review Incoming Studies and assign eligible cases to approved radiologists.</li><li>Review and approve signed reports, then deliver them to the destination hospital.</li><li>Use analytics and SLA views to monitor turnaround; use Corrections to approve or reject requests.</li></ol></div>
                <div className="grid gap-3 border-t border-slate-200 pt-6 md:grid-cols-[190px_1fr]"><div className="flex items-start gap-2 font-semibold"><ShieldCheck size={17} className="mt-0.5 text-teal-700" /> Administrator</div><ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-600"><li>Add hospitals from Settings &gt; Hospitals before approving a HOSPITAL registration request.</li><li>Approve or reject pending registrations and assign roles and hospital links.</li><li>Manage users, review audit events, and configure SLA thresholds.</li><li>Initiate backups and verify artifacts before using retention tools. Archival marks eligible studies; it does not delete their records.</li></ol></div>
              </div>
            </section>

            <section id="security" className="scroll-mt-24 border-b border-slate-200 py-10 sm:py-12">
              <SectionHeading number="06" title="Security & Privacy" lead="These controls are verifiable in source. They are implementation details, not a certification or guarantee of regulatory compliance." />
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Authentication", "Local email/password login; bcrypt password hashes; signed axis_session JWT in an HttpOnly, SameSite=Lax cookie. Secure is enabled in production."],
                  ["Account approval", "Self-registration cannot select ADMIN. New accounts remain pending until an administrator approves and assigns a role; hospital accounts are linked to a hospital."],
                  ["Authorization", "Global API guards require an approved account and enforce role metadata. Study and DICOM operations apply hospital and radiologist-assignment scope."],
                  ["DICOM proxy", "Client cookies and authorization headers are not forwarded upstream. Traversal paths and unknown study UIDs are rejected."],
                  ["Request controls", "DTO validation, configured CORS, security headers, request correlation/logging, upload limits, and targeted in-process rate limits are implemented."],
                  ["Audit and data", "Workflow actions create audit events. Notifications carry minimal metadata, not report text. PostgreSQL holds workflow records; Orthanc holds DICOM objects."],
                ].map(([title, detail]) => <div key={title} className="border-t border-slate-300 pt-3"><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-teal-700" />{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p></div>)}
              </div>
              <div className="mt-7 border-l-4 border-red-600 bg-red-50 px-5 py-4 text-sm leading-6 text-slate-700"><strong className="text-navy-900">Deployment caution:</strong> bundled Orthanc authentication is disabled for local development. Session revocation and rate limiting use in-process stores and assume one API replica. Production needs operator-managed secrets, HTTPS, protected storage, policy controls, and an independent compliance review. The project makes no HIPAA-compliance claim. Do not use development fixtures or unsecured local environments for real patient data.</div>
            </section>

            <section id="desktop" className="scroll-mt-24 border-b border-slate-200 py-10 sm:py-12">
              <SectionHeading number="07" title="Desktop Application" lead="Axis is currently delivered as a browser-based product. This repository contains no native desktop package, installer, or desktop-specific runtime." />
              <div className="border border-navy-800 bg-navy-950 p-5 text-white sm:p-7">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="max-w-2xl"><p className="font-mono text-xs uppercase text-teal-300">Desktop release</p><h3 className="mt-2 font-heading text-xl font-bold">A desktop download is not available yet.</h3><p className="mt-2 text-sm leading-6 text-slate-300">Use the Axis website in a supported browser. OHIF is a separate web service, not a packaged desktop client.</p></div>
                  {desktopDownloadUrl ? <a href={desktopDownloadUrl} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded bg-white px-4 text-sm font-semibold text-navy-900 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">Download desktop app</a> : <div className="max-w-full border border-dashed border-slate-500 px-4 py-3 font-mono text-xs leading-5 text-slate-200 sm:text-sm">[ DESKTOP APPLICATION DOWNLOAD LINK — COMING SOON ]</div>}
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">When a release URL exists, set <code className="font-mono text-xs">NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL</code> at build time. When it is unset, the placeholder remains plain text and cannot be clicked.</p>
            </section>

            <section id="faq" className="scroll-mt-24 border-b border-slate-200 py-10 sm:py-12">
              <SectionHeading number="08" title="FAQ" lead="Answers describe the current implementation, not roadmap assumptions." />
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {[
                  ["Does Axis analyze images with AI?", "No. AI jobs can be listed and monitored, but no inference engine or image-analysis pipeline is integrated."],
                  ["Are studies assigned automatically?", "No. Managers assign studies manually. A routing-rule editor exists, but automatic evaluation is not connected."],
                  ["How are reports delivered?", "Approved reports become available to authorized hospital users in the Axis web app, with PDF download. HL7, FHIR, email, fax, and external EHR delivery are not implemented."],
                  ["Can I view DICOM images in the web app?", "Yes, when Orthanc and OHIF are configured and the study is indexed. OHIF retrieves images through the session- and role-protected Axis DICOMweb proxy."],
                  ["Is there a native desktop app?", "No. The repository contains a web application and separate imaging services, but no desktop installer."],
                  ["Is Axis HIPAA certified?", "The repository includes authentication, role checks, audit logging, and other controls, but does not establish a compliance certification. Deployment and organizational controls need independent review."],
                  ["Can I use real patient data for local testing?", "Do not upload real patient information to a development environment. The included seed data is synthetic; use an approved, secured deployment and your organization's data-handling process for real data."],
                ].map(([question, answer]) => <details key={question} className="group py-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">{question}<ChevronRight size={17} className="shrink-0 text-teal-700 transition-transform group-open:rotate-90" /></summary><p className="mt-3 max-w-3xl pr-8 text-sm leading-6 text-slate-600">{answer}</p></details>)}
              </div>
            </section>

            <section id="resources" className="scroll-mt-24 py-10 sm:py-12">
              <SectionHeading number="09" title="Support & Resources" lead="No public support address, issue tracker, or external repository URL is configured in this project." />
              <div className="grid gap-5 md:grid-cols-2">
                <div className="border-t-2 border-teal-600 pt-4"><h3 className="flex items-center gap-2 font-semibold"><FileText size={17} className="text-teal-700" />Maintainer references</h3><p className="mt-2 text-sm leading-6 text-slate-600">The source tree includes <code className="font-mono text-xs">DICOM_SETUP.md</code> for imaging setup, <code className="font-mono text-xs">apps/api/SECURITY.md</code> for verified security notes, and <code className="font-mono text-xs">apps/api/PRODUCTION_OPERATIONS.md</code> for operations.</p></div>
                <div className="border-t-2 border-slate-300 pt-4"><h3 className="flex items-center gap-2 font-semibold"><Database size={17} className="text-teal-700" />Project references</h3><p className="mt-2 text-sm leading-6 text-slate-600">Product and workflow notes are also in the repository&apos;s <code className="font-mono text-xs">README.md</code> and <code className="font-mono text-xs">PROJECT_DOCUMENTATION.md</code>. Security reporting guidance is in <code className="font-mono text-xs">apps/api/SECURITY.md</code>.</p></div>
              </div>
              <div className="mt-8 border-t border-slate-200 pt-5"><Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Return to Axis <ArrowRight size={15} /></Link></div>
            </section>
          </article>
        </main>
      </div>

      {showBackToTop && <a href="#documentation-main" aria-label="Back to top" title="Back to top" className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-navy-900 shadow-md transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"><ArrowUp size={18} /></a>}
    </div>
  );
}