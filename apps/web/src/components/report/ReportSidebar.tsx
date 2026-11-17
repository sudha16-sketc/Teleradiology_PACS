"use client";

import { ExternalLink, User } from "lucide-react";

interface ReportSidebarProps {
  patientUid: string;
  accessionNumber: string;
  modality: string;
  studyDescription: string;
  bodyPart: string;
  hospitalName: string;
  assignedRadiologist: string;
  studyInstanceUid: string;
}

export function ReportSidebar({
  patientUid,
  accessionNumber,
  modality,
  studyDescription,
  bodyPart,
  hospitalName,
  assignedRadiologist,
  studyInstanceUid,
}: ReportSidebarProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Patient UID
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
            <User size={16} />
          </div>
          <p className="min-w-0 break-all font-mono text-xs text-text-primary">
            {patientUid || "—"}
          </p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Study Details
        </h3>
        <dl className="flex flex-col gap-2.5">
          <div>
            <dt className="text-xs text-text-muted">Accession</dt>
            <dd className="font-mono text-sm text-text-primary">
              {accessionNumber}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Modality</dt>
            <dd className="font-mono text-sm text-text-primary">{modality}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Description</dt>
            <dd className="text-sm text-text-primary">{studyDescription}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Body Part</dt>
            <dd className="text-sm text-text-primary">{bodyPart}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Assignment
        </h3>
        <dl className="flex flex-col gap-2.5">
          <div>
            <dt className="text-xs text-text-muted">Hospital</dt>
            <dd className="text-sm text-text-primary">{hospitalName}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Radiologist</dt>
            <dd className="text-sm text-text-primary">{assignedRadiologist}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Identifiers
        </h3>
        <dl className="flex flex-col gap-1.5">
          <div>
            <dt className="text-xs text-text-muted">Study UID</dt>
            <dd className="break-all font-mono text-[11px] text-text-primary">
              {studyInstanceUid || "—"}
            </dd>
          </div>
        </dl>
      </div>

      <a
        href={`/reading/${studyInstanceUid}`}
        className="flex items-center gap-1.5 text-sm text-accent transition-colors hover:text-accent/80"
      >
        <ExternalLink size={14} />
        Open Reading View
      </a>
    </div>
  );
}
