import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MIS Reports",
  description: "Generate and download study activity and turnaround-time reports.",
};

export default function MisReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
