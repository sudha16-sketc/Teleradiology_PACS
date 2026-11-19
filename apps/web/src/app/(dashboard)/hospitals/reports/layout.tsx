import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Received Reports",
  description: "Radiology reports delivered to your hospital in Axis.",
};

export default function HospitalReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
