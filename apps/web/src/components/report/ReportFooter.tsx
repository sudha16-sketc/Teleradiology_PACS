import type { CompanySettings } from "@axis/types";
import { Barcode } from "./Barcode";

interface ReportFooterProps {
  company?: CompanySettings | null;
  hospitalName?: string;
  reportId?: string;
  className?: string;
}

function valueOrPlaceholder(value: string | undefined, placeholder: string) {
  return value && value.trim() ? value : placeholder;
}

/**
 * Consistent footer shared by the on-screen preview and the print/PDF layout.
 * Missing configuration is shown as an explicit placeholder -- the application
 * never invents company information.
 */
export function ReportFooter({
  company,
  hospitalName,
  reportId,
  className,
}: ReportFooterProps) {
  const companyName = valueOrPlaceholder(
    company?.name,
    hospitalName?.trim() ? hospitalName : "[Company name not configured]",
  );
  const phone = valueOrPlaceholder(
    company?.phone,
    "[Company phone not configured]",
  );
  const email = valueOrPlaceholder(
    company?.email,
    "[Company email not configured]",
  );
  const description = valueOrPlaceholder(
    company?.description,
    "[Company description not configured]",
  );
  const disclaimer = valueOrPlaceholder(
    company?.disclaimer,
    "[Report disclaimer not configured - contact your administrator]",
  );

  return (
    <footer
      className={`mt-8 border-t pt-4 text-[10px] leading-relaxed text-neutral-700 ${className ?? ""}`}
      style={{ borderColor: "#c7c7c7" }}
    >
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">{companyName}</p>
          <p className="mt-1 whitespace-pre-line">{description}</p>
          <p className="mt-2">
            <span className="font-semibold">Phone:</span> {phone}
            <span className="mx-2">|</span>
            <span className="font-semibold">Email:</span> {email}
          </p>
          <p className="mt-2 border-t border-neutral-300 pt-2 text-[9px] italic text-neutral-600">
            {disclaimer}
          </p>
        </div>
        {reportId && (
          <div className="w-48 shrink-0 text-right">
            <Barcode value={reportId} height={42} />
          </div>
        )}
      </div>
    </footer>
  );
}
