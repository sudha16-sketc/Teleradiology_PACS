import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Turnaround and workflow analytics in Axis.",
};

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
