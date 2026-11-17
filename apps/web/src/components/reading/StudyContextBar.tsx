import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface StudyContextBarProps {
  patientUid: string;
  accessionNumber: string;
}

export function StudyContextBar({
  patientUid,
  accessionNumber,
}: StudyContextBarProps) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      <Link
        href="/worklist"
        className="text-text-muted transition-colors hover:text-accent"
      >
        Axis
      </Link>
      <ChevronRight size={12} className="text-text-muted" />
      <Link
        href="/reading"
        className="text-text-muted transition-colors hover:text-accent"
      >
        Reading
      </Link>
      <ChevronRight size={12} className="text-text-muted" />
      <span className="break-all font-mono text-xs text-text-primary">
        {patientUid || "—"}
      </span>
      <ChevronRight size={12} className="text-text-muted" />
      <span className="font-mono text-xs text-text-primary">
        {accessionNumber}
      </span>
    </nav>
  );
}
