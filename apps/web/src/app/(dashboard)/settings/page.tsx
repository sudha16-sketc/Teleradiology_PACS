"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings, Users, GitBranch, ClipboardList, Brain, ClipboardCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";

const OVERVIEW_LINKS: {
  label: string;
  description: string;
  icon: React.ReactNode;
  href: string;
}[] = [
  {
    label: "User Management",
    description: "Add, edit, and deactivate user accounts",
    icon: <Users size={20} />,
    href: "/settings/users",
  },
  {
    label: "Registration Requests",
    description: "Review and approve pending account requests",
    icon: <ClipboardCheck size={20} />,
    href: "/admin/registration-requests",
  },
  {
    label: "Routing Rules",
    description: "Configure study assignment and routing logic",
    icon: <GitBranch size={20} />,
    href: "/settings/routing",
  },
  {
    label: "Audit Log",
    description: "Review system activity and compliance records",
    icon: <ClipboardList size={20} />,
    href: "/settings/audit",
  },
  {
    label: "AI Queue Monitor",
    description: "Monitor AI processing tasks and job status",
    icon: <Brain size={20} />,
    href: "/settings/ai",
  },
];

interface OverviewData {
  totalStudies: number;
  studiesToday: number;
}

export default function SettingsOverviewPage() {
  const [userCount, setUserCount] = useState<number | null>(null);
  const [hospitalCount, setHospitalCount] = useState<number | null>(null);
  const [studyStats, setStudyStats] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [usersRes, hospitalsRes, overviewRes] = await Promise.allSettled([
        apiClient.get<{ data: unknown[] }>("/users"),
        apiClient.get<{ data: unknown[] }>("/hospitals"),
        apiClient.get<{ data: OverviewData }>("/analytics/overview"),
      ]);

      if (usersRes.status === "fulfilled")
        setUserCount(usersRes.value.data.length);
      if (hospitalsRes.status === "fulfilled")
        setHospitalCount(hospitalsRes.value.data.length);
      if (overviewRes.status === "fulfilled")
        setStudyStats(overviewRes.value.data);
    } catch {
      // partial loads are fine
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings size={20} className="text-text-muted" />
        <h1 className="font-heading text-xl font-bold text-text-primary">
          Admin Console
        </h1>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading ? (
            <>
              {[...Array(4)].map((_, i) => (
                <div key={i} className="rounded-md border border-border bg-surface p-5">
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-text-muted" />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="rounded-md border border-border bg-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Total Users
                </p>
                <p className="mt-2 font-heading text-2xl font-bold text-text-primary">
                  {userCount ?? "—"}
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Active Hospitals
                </p>
                <p className="mt-2 font-heading text-2xl font-bold text-text-primary">
                  {hospitalCount ?? "—"}
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Total Studies
                </p>
                <p className="mt-2 font-heading text-2xl font-bold text-text-primary">
                  {studyStats?.totalStudies ?? "—"}
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  Studies Today
                </p>
                <p className="mt-2 font-heading text-2xl font-bold text-text-primary">
                  {studyStats?.studiesToday ?? "—"}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="rounded-md border border-border bg-surface p-5">
          <h2 className="font-heading text-sm font-semibold text-text-primary">
            Organization Information
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                Name
              </p>
              <p className="mt-1 text-sm text-text-primary">
                Axis Teleradiology
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                Organization Code
              </p>
              <p className="mt-1 font-mono text-sm text-text-primary">
                AXIS-001
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                Timezone
              </p>
              <p className="mt-1 text-sm text-text-primary">
                America/New_York (ET)
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface p-5">
          <h2 className="font-heading text-sm font-semibold text-text-primary">
            Quick Links
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {OVERVIEW_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="flex items-start gap-3 rounded-md border border-border bg-surface-raised p-4 transition-colors hover:border-accent/40"
              >
                <div className="mt-0.5 text-accent">{link.icon}</div>
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {link.label}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {link.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
