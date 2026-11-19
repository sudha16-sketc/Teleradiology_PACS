import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Registration Requests",
  description: "Pending Axis account approvals and role assignments.",
};

export default function RegistrationRequestsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
