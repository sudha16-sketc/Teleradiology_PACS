import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorStateProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  icon,
  title = "Something went wrong",
  description,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="text-error">
        {icon ?? <AlertTriangle size={48} strokeWidth={1} />}
      </div>
      <div className="text-center">
        <h3 className="font-heading text-lg font-semibold text-text-primary">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-sm text-text-muted">{description}</p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
        >
          Retry
        </button>
      )}
    </div>
  );
}
