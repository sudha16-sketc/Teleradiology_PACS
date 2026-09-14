"use client";

import { useInView } from "@/components/landing/useInView";

const metrics = [
  { value: "4", label: "Core user roles" },
  { value: "End-to-End", label: "Radiology workflow" },
  { value: "DICOM", label: "Medical imaging ready" },
  { value: "Versioned", label: "Clinical reporting history" },
];

function MetricCard({ metric, index }: { metric: (typeof metrics)[number]; index: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${index * 75}ms` }}
      className={`transition-all duration-700 ease-out ${
        inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      <div className="h-full rounded-xl border border-slate-200 bg-white p-8 text-center transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-200/70">
        <div className="text-4xl font-bold tracking-tight text-navy-900 sm:text-5xl">
          {metric.value}
        </div>
        <p className="mt-3 text-sm font-medium text-slate-500">
          {metric.label}
        </p>
      </div>
    </div>
  );
}

export default function MetricsSection() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric, index) => (
            <MetricCard key={metric.label} metric={metric} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}