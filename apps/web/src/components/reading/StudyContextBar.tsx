import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface StudyContextBarProps {
  patientName: string;
  accessionNumber: string;
}

export function StudyContextBar({
  patientName,
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
      <span className="text-text-primary">{patientName}</span>
      <ChevronRight size={12} className="text-text-muted" />
      <span className="text-text-primary">{accessionNumber}</span>
    </nav>
  );
}
