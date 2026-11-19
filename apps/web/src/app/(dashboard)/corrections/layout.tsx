import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Corrections",
  description: "Radiology report correction requests and resolutions in Axis.",
};

export default function CorrectionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
