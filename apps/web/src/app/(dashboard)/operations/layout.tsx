import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Operations",
  description: "Axis backup, retention, and operational controls.",
};

export default function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
