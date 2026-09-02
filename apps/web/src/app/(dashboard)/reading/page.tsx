import Link from "next/link";
import { MonitorPlay } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ReadingHomePage() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<MonitorPlay size={48} strokeWidth={1} />}
        title="Select a study to begin reading"
        description="Choose a study from the worklist to open the reading workspace, viewer, and reporting tools."
        action={
          <Link
            href="/worklist"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
          >
            Go to Worklist
          </Link>
        }
      />
    </div>
  );
}