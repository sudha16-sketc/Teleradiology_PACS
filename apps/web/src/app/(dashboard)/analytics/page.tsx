"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Building2,
  Clock,
  TrendingUp,
  BarChart3,
  Loader2,
} from "lucide-react";
import { MetricCard } from "@/components/hospital/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { apiClient } from "@/lib/api-client";

interface OverviewData {
  totalStudies: number;
  studiesToday: number;
  averageTAT: number;
  slaComplianceRate: number;
  backlogCount: number;
  deliverySuccessRate: number;
}

interface TATBucket {
  range: string;
  count: number;
  percentage: number;
}

interface HospitalPerf {
  hospitalId: string;
  hospitalName: string;
  totalStudies: number;
  averageTAT: number;
  slaCompliance: number;
  deliverySuccessRate: number;
}

function BarFill({ percentage, color }: { percentage: number; color: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-surface-raised">
      <div
        className="h-2 rounded-full transition-all"
        style={{ width: `${Math.max(percentage, 1)}%`, backgroundColor: color }}
      />
    </div>
  );
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [tatData, setTatData] = useState<TATBucket[]>([]);
  const [hospitalPerf, setHospitalPerf] = useState<HospitalPerf[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const [overviewRes, tatRes, perfRes] = await Promise.allSettled([
        apiClient.get<{ data: OverviewData }>("/analytics/overview"),
        apiClient.get<{ data: TATBucket[] }>("/analytics/tat"),
        apiClient.get<{ data: HospitalPerf[] }>("/analytics/hospital-performance"),
      ]);

      if (overviewRes.status === "fulfilled") setOverview(overviewRes.value.data);
      if (tatRes.status === "fulfilled") setTatData(tatRes.value.data);
      if (perfRes.status === "fulfilled") setHospitalPerf(perfRes.value.data);

      if (overviewRes.status === "rejected") throw overviewRes.reason;
    } catch (e) {
      console.error("Failed to load analytics", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load analytics"
        description="Unable to fetch analytics data. Please try again."
        onRetry={() => void load()}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-text-muted">
        <Loader2 size={16} className="animate-spin" />
        Loading analytics...
      </div>
    );
  }

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
        <MetricCard
          title="Total Studies"
          value={overview?.totalStudies ?? 0}
          icon={<BarChart3 size={18} />}
        />
        <MetricCard
          title="Studies Today"
          value={overview?.studiesToday ?? 0}
          icon={<Activity size={18} />}
        />
        <MetricCard
          title="Average TAT"
          value={`${overview?.averageTAT ?? 0}m`}
          icon={<Clock size={18} />}
        />
        <MetricCard
          title="SLA Compliance"
          value={`${overview?.slaComplianceRate ?? 100}%`}
          icon={<TrendingUp size={18} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Clock size={18} className="text-accent" />
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              TAT Distribution
            </h2>
          </div>
          {tatData.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-muted">
              No turnaround time data available yet.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {tatData.map((item) => (
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
          )}
        </div>

        <div className="rounded-md border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity size={18} className="text-accent" />
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              Delivery Success Rate
            </h2>
          </div>
          <div className="flex flex-col items-center justify-center py-8">
            <span className="font-heading text-4xl font-bold text-text-primary">
              {overview?.deliverySuccessRate ?? 100}%
            </span>
            <span className="mt-1 text-sm text-text-muted">
              of reports successfully delivered
            </span>
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
        {hospitalPerf.length === 0 ? (
          <EmptyState
            title="No hospital data"
            description="Hospital performance metrics will appear once studies are submitted."
          />
        ) : (
          <div className="rounded-md border border-border">
            <div className="grid grid-cols-[1fr_0.5fr_0.5fr_0.5fr_0.5fr] gap-4 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
              <div>Hospital</div>
              <div>Studies</div>
              <div>Avg TAT</div>
              <div>SLA</div>
              <div>Delivery</div>
            </div>
            {hospitalPerf.map((h) => (
              <div
                key={h.hospitalId}
                className="grid grid-cols-[1fr_0.5fr_0.5fr_0.5fr_0.5fr] gap-4 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="text-sm text-text-primary">{h.hospitalName}</span>
                <span className="font-mono text-sm text-text-muted">
                  {h.totalStudies}
                </span>
                <span className="font-mono text-sm text-text-muted">
                  {h.averageTAT}m
                </span>
                <span
                  className={`font-mono text-sm ${h.slaCompliance >= 95 ? "text-success" : "text-warning"}`}
                >
                  {h.slaCompliance}%
                </span>
                <span className="font-mono text-sm text-text-muted">
                  {h.deliverySuccessRate}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
