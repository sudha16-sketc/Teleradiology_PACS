"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { RoutingRuleBuilder } from "@/components/admin/RoutingRuleBuilder";
import { EmptyState } from "@/components/ui/EmptyState";

export default function RoutingPage() {
  const [showBuilder, setShowBuilder] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-text-primary">
          Routing Rules
        </h1>
        <button
          onClick={() => setShowBuilder(true)}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
        >
          <Plus size={14} />
          Create Rule
        </button>
      </div>

      {showBuilder && (
        <RoutingRuleBuilder
          onCancel={() => setShowBuilder(false)}
          onSave={() => setShowBuilder(false)}
        />
      )}

      <div className="rounded-md border border-border">
        <EmptyState
          title="No data available"
          description="Routing rules are not configured yet. Use Create Rule to add one."
        />
      </div>
    </div>
  );
}
