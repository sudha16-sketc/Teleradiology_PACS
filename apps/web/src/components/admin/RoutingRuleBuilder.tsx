"use client";

import { useState } from "react";
import type { RoutingCondition, RoutingAction } from "@axis/types";
import { Plus, X } from "lucide-react";

const CONDITION_FIELDS = [
  { value: "modality", label: "Modality" },
  { value: "subspecialty", label: "Subspecialty" },
  { value: "hospital", label: "Hospital" },
  { value: "timezone", label: "Time Zone" },
];

const OPERATORS = [
  { value: "EQUALS", label: "Equals" },
  { value: "NOT_EQUALS", label: "Not Equals" },
  { value: "IN", label: "In" },
  { value: "NOT_IN", label: "Not In" },
];

const ACTION_TYPES = [
  { value: "ASSIGN_POOL", label: "Assign Pool" },
  { value: "ASSIGN_USER", label: "Assign User" },
  { value: "SET_PRIORITY", label: "Set Priority" },
  { value: "SET_SUBSPECIALTY", label: "Set Subspecialty" },
];

interface RoutingRuleBuilderProps {
  onCancel?: () => void;
  onSave?: (rule: { name: string; conditions: RoutingCondition[]; actions: RoutingAction[] }) => void;
}

export function RoutingRuleBuilder({ onCancel, onSave }: RoutingRuleBuilderProps) {
  const [name, setName] = useState("");
  const [conditions, setConditions] = useState<RoutingCondition[]>([
    { field: "modality", operator: "EQUALS", value: "" },
  ]);
  const [actions, setActions] = useState<RoutingAction[]>([]);

  function updateCondition(index: number, patch: Partial<RoutingCondition>) {
    setConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }

  function removeCondition(index: number) {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }

  function addCondition() {
    setConditions((prev) => [...prev, { field: "modality", operator: "EQUALS", value: "" }]);
  }

  function updateAction(index: number, patch: Partial<RoutingAction>) {
    setActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  }

  function removeAction(index: number) {
    setActions((prev) => prev.filter((_, i) => i !== index));
  }

  function addAction() {
    setActions((prev) => [...prev, { type: "ASSIGN_POOL", value: "" }]);
  }

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <h3 className="font-heading text-base font-semibold text-text-primary">
        Rule Builder
      </h3>

      <div className="mt-4">
        <label className="block text-xs font-medium uppercase tracking-wider text-text-muted">
          Rule Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. STAT MRI Auto-Assign"
          className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
        />
      </div>

      <div className="mt-6">
        <h4 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Conditions
        </h4>
        <div className="mt-2 space-y-3">
          {conditions.map((cond, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={cond.field}
                onChange={(e) => updateCondition(i, { field: e.target.value })}
                className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {CONDITION_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={cond.operator}
                onChange={(e) =>
                  updateCondition(i, {
                    operator: e.target.value as RoutingCondition["operator"],
                  })
                }
                className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={typeof cond.value === "string" ? cond.value : cond.value.join(",")}
                onChange={(e) => updateCondition(i, { value: e.target.value })}
                placeholder="Value"
                className="flex-1 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
              />
              {conditions.length > 1 && (
                <button
                  onClick={() => removeCondition(i)}
                  className="rounded p-1 text-text-muted transition-colors hover:text-error"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addCondition}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
        >
          <Plus size={12} />
          Add Condition
        </button>
      </div>

      <div className="mt-6">
        <h4 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Actions
        </h4>
        <div className="mt-2 space-y-3">
          {actions.map((action, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={action.type}
                onChange={(e) =>
                  updateAction(i, {
                    type: e.target.value as RoutingAction["type"],
                  })
                }
                className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {ACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={action.value}
                onChange={(e) => updateAction(i, { value: e.target.value })}
                placeholder="Value"
                className="flex-1 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
              />
              <button
                onClick={() => removeAction(i)}
                className="rounded p-1 text-text-muted transition-colors hover:text-error"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addAction}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
        >
          <Plus size={12} />
          Add Action
        </button>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() =>
            onSave?.({ name, conditions, actions })
          }
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
        >
          Save Rule
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
