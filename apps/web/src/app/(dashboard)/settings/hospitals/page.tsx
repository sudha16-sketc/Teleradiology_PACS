"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Plus } from "lucide-react";
import type { ApiError, Hospital } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

interface HospitalsEnvelope {
  data: Hospital[];
}

interface HospitalEnvelope {
  data: Hospital;
}

interface HospitalForm {
  name: string;
  code: string;
  address: string;
  timezone: string;
}

const EMPTY_FORM: HospitalForm = {
  name: "",
  code: "",
  address: "",
  timezone: "UTC",
};

const inputClasses =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent disabled:opacity-60";

export default function HospitalManagementPage() {
  const currentUser = useAppStore((state) => state.currentUser);
  const canManage = currentUser?.role === "ADMIN";
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<HospitalsEnvelope>("/hospitals");
      setHospitals(response.data);
    } catch (err) {
      setError((err as ApiError).message ?? "Failed to load hospitals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update(field: keyof HospitalForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
    setNotice(null);
  }

  async function createHospital(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.post<HospitalEnvelope>(
        "/hospitals",
        form,
      );
      setHospitals((current) =>
        [...current, response.data].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setForm(EMPTY_FORM);
      setNotice(`${response.data.name} is now available for user approval.`);
    } catch (err) {
      setError((err as ApiError).message ?? "Failed to add hospital.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Building2 size={20} className="text-text-muted" />
        <div>
          <h1 className="font-heading text-xl font-bold text-text-primary">
            Hospital Management
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Add hospitals that administrators can link to approved hospital
            accounts.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
          {!loading && hospitals.length === 0 && (
            <button
              type="button"
              onClick={() => void load()}
              className="ml-2 font-medium underline"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      )}

      {canManage ? (
        <form
          onSubmit={createHospital}
          className="space-y-5 rounded-md border border-border bg-surface p-4 sm:p-6"
        >
          <h2 className="font-heading text-sm font-semibold text-text-primary">
            Add a hospital
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                Hospital name *
              </span>
              <input
                required
                minLength={2}
                maxLength={120}
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                disabled={saving}
                className={inputClasses}
                placeholder="e.g. City General Hospital"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                Hospital code *
              </span>
              <input
                required
                minLength={2}
                maxLength={30}
                pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                value={form.code}
                onChange={(event) => update("code", event.target.value)}
                disabled={saving}
                className={inputClasses}
                placeholder="e.g. CITY-GENERAL"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                Address
              </span>
              <input
                maxLength={500}
                value={form.address}
                onChange={(event) => update("address", event.target.value)}
                disabled={saving}
                className={inputClasses}
                placeholder="Optional"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                Time zone
              </span>
              <input
                maxLength={100}
                value={form.timezone}
                onChange={(event) => update("timezone", event.target.value)}
                disabled={saving}
                className={inputClasses}
                placeholder="UTC"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              Add hospital
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Only administrators can add hospitals.
        </div>
      )}

      <section className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-heading text-sm font-semibold text-text-primary">
            Hospitals
          </h2>
          <span className="text-xs text-text-muted">
            {hospitals.length} total
          </span>
        </div>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={18} className="animate-spin text-text-muted" />
          </div>
        ) : hospitals.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-text-muted">
            No hospitals yet. Add one above to make it available in registration
            approval.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Address</th>
                  <th className="px-4 py-3 font-medium">Time zone</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {hospitals.map((hospital) => (
                  <tr
                    key={hospital.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {hospital.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">
                      {hospital.code}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {hospital.address || "—"}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {hospital.timezone}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          hospital.isActive
                            ? "text-success"
                            : "text-text-muted"
                        }
                      >
                        {hospital.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
