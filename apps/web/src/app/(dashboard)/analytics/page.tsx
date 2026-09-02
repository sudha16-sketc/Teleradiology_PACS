"use client";

import {
  Activity,
  Building2,
  Clock,
  TrendingUp,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import { MetricCard } from "@/components/hospital/MetricCard";

const TAT_DATA = [
  { range: "0-30 min", count: 12, percentage: 24 },
  { range: "30-60 min", count: 18, percentage: 36 },
  { range: "1-2 hr", count: 11, percentage: 22 },
  { range: "2-4 hr", count: 6, percentage: 12 },
  { range: "4+ hr", count: 3, percentage: 6 },
];

const MODALITY_DATA = [
  { modality: "CT", count: 18, percentage: 36 },
  { modality: "MRI", count: 12, percentage: 24 },
  { modality: "XR", count: 8, percentage: 16 },
  { modality: "US", count: 6, percentage: 12 },
  { modality: "MG", count: 4, percentage: 8 },
  { modality: "NM", count: 2, percentage: 4 },
];

const HOSPITAL_PERF = [
  { name: "Metro General Hospital", studies: 22, avgTAT: 47, slaCompliance: 96 },
  { name: "St. Luke's Medical Center", studies: 16, avgTAT: 52, slaCompliance: 91 },
  { name: "Riverside Clinic", studies: 12, avgTAT: 38, slaCompliance: 98 },
];

const SLA_BREACHES = [
  { patient: "Synth, Carlos", modality: "NM", hospital: "Riverside", overdue: 25, priority: "ROUTINE" },
  { patient: "Synth, Emily", modality: "XR", hospital: "Metro General", overdue: 12, priority: "ROUTINE" },
];

function BarFill({ percentage, color }: { percentage: number; color: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-surface-raised">
      <div
        className="h-2 rounded-full transition-all"
        style={{ width: `${percentage}%`, backgroundColor: color }}
      />
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Analytics
        </h1>
        <p className="text-sm text-text-muted">
          Operational insights and performance metrics
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Total Studies" value="50" change={{ value: 12 }} icon={<BarChart3 size={18} />} />
        <MetricCard title="Studies Today" value="10" icon={<Activity size={18} />} />
        <MetricCard title="Average TAT" value="46m" change={{ value: -8 }} icon={<Clock size={18} />} />
        <MetricCard title="SLA Compliance" value="95%" change={{ value: 2 }} icon={<TrendingUp size={18} />} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Clock size={18} className="text-accent" />
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              TAT Distribution
            </h2>
          </div>
          <div className="flex flex-col gap-3">
            {TAT_DATA.map((item) => (
              <div key={item.range} className="flex items-center gap-3">
                <span className="w-24 text-xs text-text-muted">{item.range}</span>
                <div className="flex-1">
                  <BarFill
                    percentage={item.percentage}
                    color="var(--accent-cyan)"
                  />
                </div>
                <span className="w-8 text-right font-mono text-xs text-text-muted">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity size={18} className="text-accent" />
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              Modality Distribution
            </h2>
          </div>
          <div className="flex flex-col gap-3">
            {MODALITY_DATA.map((item) => (
              <div key={item.modality} className="flex items-center gap-3">
                <span className="w-12 font-mono text-xs text-text-muted">
                  {item.modality}
                </span>
                <div className="flex-1">
                  <BarFill
                    percentage={item.percentage}
                    color="var(--accent-cyan)"
                  />
                </div>
                <span className="w-8 text-right font-mono text-xs text-text-muted">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-5">
        <div className="mb-4 flex items-center gap-2">
          <Building2 size={18} className="text-accent" />
          <h2 className="font-heading text-sm font-semibold text-text-primary">
            Hospital Performance
          </h2>
        </div>
        <div className="rounded-md border border-border">
          <div className="grid grid-cols-[1fr_0.6fr_0.6fr_0.6fr] gap-4 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <div>Hospital</div>
            <div>Studies</div>
            <div>Avg TAT</div>
            <div>SLA</div>
          </div>
          {HOSPITAL_PERF.map((h) => (
            <div
              key={h.name}
              className="grid grid-cols-[1fr_0.6fr_0.6fr_0.6fr] gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span className="text-sm text-text-primary">{h.name}</span>
              <span className="font-mono text-sm text-text-muted">
                {h.studies}
              </span>
              <span className="font-mono text-sm text-text-muted">
                {h.avgTAT}m
              </span>
              <span
                className={`font-mono text-sm ${h.slaCompliance >= 95 ? "text-success" : "text-warning"}`}
              >
                {h.slaCompliance}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-5">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle size={18} className="text-warning" />
          <h2 className="font-heading text-sm font-semibold text-text-primary">
            SLA Breaches
          </h2>
        </div>
        {SLA_BREACHES.length === 0 ? (
          <p className="text-sm text-text-muted">No active SLA breaches</p>
        ) : (
          <div className="rounded-md border border-border">
            <div className="grid grid-cols-[1fr_0.5fr_1fr_0.5fr_0.5fr] gap-4 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
              <div>Patient</div>
              <div>Modality</div>
              <div>Hospital</div>
              <div>Overdue</div>
              <div>Priority</div>
            </div>
            {SLA_BREACHES.map((b, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_0.5fr_1fr_0.5fr_0.5fr] gap-4 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="text-sm text-text-primary">{b.patient}</span>
                <span className="font-mono text-xs text-text-muted">
                  {b.modality}
                </span>
                <span className="text-sm text-text-muted">{b.hospital}</span>
                <span className="font-mono text-sm text-error">
                  +{b.overdue}m
                </span>
                <span className="text-sm text-text-muted">{b.priority}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
