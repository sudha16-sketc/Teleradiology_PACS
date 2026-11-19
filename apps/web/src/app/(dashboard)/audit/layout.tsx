import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audit Log",
  description: "Axis workflow audit events and actor history.",
};

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
