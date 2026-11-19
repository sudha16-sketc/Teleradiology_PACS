import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports",
  description: "Signed and approved radiology reports in Axis.",
};

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
