import { AppShell } from "@/components/layout/AppShell";
import { SessionGuard } from "@/components/auth/SessionGuard";

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