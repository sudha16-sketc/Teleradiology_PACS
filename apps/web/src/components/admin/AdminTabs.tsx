"use client";

import { clsx } from "clsx";

export type AdminTab =
  | "overview"
  | "users"
  | "routing"
  | "audit"
  | "ai";

interface AdminTabsProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}

const TABS: { id: AdminTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "routing", label: "Routing Rules" },
  { id: "audit", label: "Audit Log" },
  { id: "ai", label: "AI Queue" },
];

export function AdminTabs({ activeTab, onTabChange }: AdminTabsProps) {
  return (
    <nav className="flex gap-1 border-b border-border" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(e) => {
            const idx = TABS.findIndex((t) => t.id === activeTab);
            if (e.key === "ArrowRight") {
              e.preventDefault();
              onTabChange(TABS[(idx + 1) % TABS.length].id);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              onTabChange(TABS[(idx - 1 + TABS.length) % TABS.length].id);
            }
          }}
          className={clsx(
            "relative px-4 py-3 text-sm font-medium transition-colors",
            activeTab === tab.id
              ? "text-accent"
              : "text-text-muted hover:text-text-primary",
          )}
        >
          {tab.label}
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
          )}
        </button>
      ))}
    </nav>
  );
}
