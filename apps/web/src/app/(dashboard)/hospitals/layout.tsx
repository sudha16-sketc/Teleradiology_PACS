import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Studies",
  description: "Hospital study submission and tracking in Axis.",
};

export default function HospitalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
