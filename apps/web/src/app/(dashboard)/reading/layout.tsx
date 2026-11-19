import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reading Room",
  description: "Radiology reporting and DICOM review workspace in Axis.",
};

export default function ReadingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
