"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import type { Study } from "@axis/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PriorityBadge } from "@/components/ui/PriorityBadge";

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-raised/50"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function FieldRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-xs text-text-muted">{label}</span>
      <span
        className={clsx(
          "text-right text-sm text-text-primary",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
    </div>
  );
}

interface StudyMetadataPanelProps {
  study: Study;
}

export function StudyMetadataPanel({ study }: StudyMetadataPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <StatusBadge status={study.status} />
        <PriorityBadge priority={study.priority} />
      </div>

      <CollapsibleSection title="Patient / Study">
        <div className="flex flex-col gap-1">
          <FieldRow label="Name" value={study.patient.displayName} />
          <FieldRow label="Patient ID" value={study.patient.patientId} mono />
          <FieldRow label="Gender" value={study.patient.gender} />
          <FieldRow label="Accession" value={study.accessionNumber} mono />
          <FieldRow label="Study" value={study.studyDescription} />
          <FieldRow label="Modality" value={study.modality} />
          <FieldRow label="Body Part" value={study.bodyPart} />
          <FieldRow
            label="Date / Time"
            value={`${study.studyDate} ${study.studyTime}`}
          />
          <FieldRow label="Hospital" value={study.hospital.name} />
          <FieldRow label="Referring" value={study.referringPhysician} />
          <FieldRow label="Subspecialty" value={study.subspecialty} />
          <FieldRow
            label="Series / Instances"
            value={`${study.seriesCount} / ${study.instanceCount}`}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Study UID" defaultOpen={false}>
        <div className="flex flex-col gap-1">
          <FieldRow
            label="Study Instance UID"
            value={study.studyInstanceUid}
            mono
          />
          <FieldRow label="Accession Number" value={study.accessionNumber} mono />
        </div>
      </CollapsibleSection>
    </div>
  );
}
