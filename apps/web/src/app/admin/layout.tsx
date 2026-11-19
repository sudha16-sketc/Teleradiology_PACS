import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { SessionGuard } from "@/components/auth/SessionGuard";

export const metadata: Metadata = {
  title: "Administration",
  description: "Axis account administration and approvals.",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionGuard requiredRole="ADMIN">
      <AppShell>{children}</AppShell>
    </SessionGuard>
  );
}