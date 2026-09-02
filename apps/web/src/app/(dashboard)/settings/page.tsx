"use client";

import { useState } from "react";
import { Settings, Users, GitBranch, ClipboardList, Brain, ClipboardCheck } from "lucide-react";
import { AdminTabs, type AdminTab } from "@/components/admin/AdminTabs";
import { MetricCard } from "@/components/admin/MetricCard";

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

export default function SettingsOverviewPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings size={20} className="text-text-muted" />
        <h1 className="font-heading text-xl font-bold text-text-primary">
          Admin Console
        </h1>
      </div>

      <AdminTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Total Users"
              value={42}
              change={{ value: 8, direction: "up" }}
            />
            <MetricCard
              title="Active Hospitals"
              value={12}
              change={{ value: 2, direction: "up" }}
            />
            <MetricCard title="Routing Rules" value={7} />
            <MetricCard
              title="Studies Today"
              value={156}
              change={{ value: 12, direction: "up" }}
            />
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
                <a
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
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
