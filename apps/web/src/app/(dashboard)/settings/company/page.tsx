"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Save } from "lucide-react";
import type { ApiError, CompanySettings } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import {
  normalizePhone,
  phoneInputValue,
  PHONE_VALIDATION_MESSAGE,
} from "@/lib/phone";
import { PhoneField } from "@/components/PhoneField";
import { useAppStore } from "@/lib/store";

interface CompanyForm {
  name: string;
  phone: string;
  email: string;
  description: string;
  disclaimer: string;
}

const EMPTY_FORM: CompanyForm = {
  name: "",
  phone: "",
  email: "",
  description: "",
  disclaimer: "",
};

export default function CompanySettingsPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const canEdit =
    currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: CompanySettings | null }>(
        "/company-settings",
      );
      if (res.data) {
        setForm({
          name: res.data.name ?? "",
          phone: phoneInputValue(res.data.phone),
          email: res.data.email ?? "",
          description: res.data.description ?? "",
          disclaimer: res.data.disclaimer ?? "",
        });
      }
    } catch (e) {
      setError((e as ApiError)?.message ?? "Failed to load company settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (field: keyof CompanyForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setNotice(null);
    setError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    const phone = normalizePhone(form.phone);
    if (phone === null) {
      setError(PHONE_VALIDATION_MESSAGE);
      setSaving(false);
      return;
    }
    try {
      await apiClient.put("/company-settings", { ...form, phone });
      setNotice("Company footer settings saved.");
    } catch (e) {
      setError((e as ApiError)?.message ?? "Failed to save company settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Building2 size={20} className="text-text-muted" />
        <div>
          <h1 className="font-heading text-xl font-bold text-text-primary">
            Company Report Footer
          </h1>
          <p className="mt-0.5 text-xs text-text-muted">
            These details are printed at the bottom of every report, alongside
            the report barcode.
          </p>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Only administrators and managers can change company footer settings.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-md border border-border bg-surface py-16">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      ) : (
        <form
          onSubmit={save}
          className="space-y-5 rounded-md border border-border bg-surface p-6"
        >
          <Field label="Company / Practice Name">
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              disabled={!canEdit}
              maxLength={200}
              placeholder="e.g. Your radiology practice name"
              className={inputClasses}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Phone">
              <PhoneField
                value={form.phone}
                onChange={(value) => update("phone", value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                disabled={!canEdit}
                maxLength={200}
                placeholder="Contact email address"
                className={inputClasses}
              />
            </Field>
          </div>
          <Field label="Company Description">
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              disabled={!canEdit}
              maxLength={2000}
              rows={3}
              placeholder="Short description shown in the footer"
              className={inputClasses}
            />
          </Field>
          <Field label="Report Disclaimer">
            <textarea
              value={form.disclaimer}
              onChange={(e) => update("disclaimer", e.target.value)}
              disabled={!canEdit}
              maxLength={4000}
              rows={5}
              placeholder="Disclaimer printed on every report"
              className={inputClasses}
            />
          </Field>

          <div className="rounded-md border border-dashed border-border bg-surface-raised px-4 py-3 text-xs leading-relaxed text-text-muted">
            Empty fields are printed as explicit placeholders in the report
            footer. This makes missing configuration visible instead of
            silently producing an incomplete report.
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save settings
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClasses =
  "w-full rounded-md border border-border bg-editor px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-70";
