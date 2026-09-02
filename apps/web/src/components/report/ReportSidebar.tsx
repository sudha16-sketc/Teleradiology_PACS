"use client";

import { ExternalLink, User } from "lucide-react";

interface ReportSidebarProps {
  patientName: string;
  patientId: string;
  accessionNumber: string;
  modality: string;
  studyDescription: string;
  bodyPart: string;
  hospitalName: string;
  assignedRadiologist: string;
  studyInstanceUid: string;
}

export function ReportSidebar({
  patientName,
  patientId,
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
          Patient
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
            <User size={16} />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {patientName}
            </p>
            <p className="font-mono text-xs text-text-muted">{patientId}</p>
          </div>
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
          <div className="flex items-center justify-between">
            <dt className="text-xs text-text-muted">Study UID</dt>
            <dd className="font-mono text-[11px] text-text-muted">
              {studyInstanceUid.length > 24
                ? `${studyInstanceUid.slice(0, 24)}...`
                : studyInstanceUid}
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
