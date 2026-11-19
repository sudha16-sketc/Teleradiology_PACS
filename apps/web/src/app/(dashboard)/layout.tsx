import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { SessionGuard } from "@/components/auth/SessionGuard";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Axis radiology workflow workspace.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionGuard>
      <AppShell>{children}</AppShell>
    </SessionGuard>
  );
}