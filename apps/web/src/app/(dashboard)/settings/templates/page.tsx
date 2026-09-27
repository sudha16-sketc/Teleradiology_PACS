"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Filter,
  Edit,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileText,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { ReportTemplate, UserRole } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

const MODALITIES = ["CT", "MRI", "XR", "US", "NM", "PET", "MG", "DX", "CR", "Fluoro"] as const;
const SUBSPECIALTIES = [
  "NEURO",
  "MSK",
  "CHEST",
  "ABDOMEN",
  "CARDIOVASCULAR",
  "MAMMOGRAPHY",
  "MUSCULOSKELETAL",
  "GENERAL",
  "PEDIATRIC",
  "ONCOLOGY",
  "INTERVENTIONAL",
] as const;

interface TemplateFormData {
  name: string;
  description: string;
  modality: string;
  subspecialty: string;
  bodyPart: string;
  clinicalHistory: string;
  findings: string;
  impression: string;
  technique: string;
  comparison: string;
  recommendations: string;
  isActive: boolean;
}

const EMPTY_FORM: TemplateFormData = {
  name: "",
  description: "",
  modality: "",
  subspecialty: "",
  bodyPart: "",
  clinicalHistory: "",
  findings: "",
  impression: "",
  technique: "",
  comparison: "",
  recommendations: "",
  isActive: true,
};

export default function TemplatesPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const userRole = currentUser?.role as UserRole;
  const isAdminOrManager = userRole === "ADMIN" || userRole === "MANAGER";
  const isRadiologist = userRole === "RADIOLOGIST";

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalityFilter, setModalityFilter] = useState("");
  const [subspecialtyFilter, setSubspecialtyFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReportTemplate | null>(null);
  const [formData, setFormData] = useState<TemplateFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<TemplateFormData>>({});
  const [submitting, setSubmitting] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (modalityFilter) params.set("modality", modalityFilter);
      if (subspecialtyFilter) params.set("subspecialty", subspecialtyFilter);
      if (activeFilter !== "all") params.set("isActive", activeFilter);

      const res = await apiClient.get<{ data: ReportTemplate[] }>(
        `/templates?${params.toString()}`,
      );
      setTemplates(res.data ?? []);
    } catch (e) {
      console.error("Failed to load templates:", e);
    } finally {
      setLoading(false);
    }
  }, [search, modalityFilter, subspecialtyFilter, activeFilter]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setFormData(EMPTY_FORM);
    setFormErrors({});
    setShowForm(true);
  };

  const handleEdit = (template: ReportTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description ?? "",
      modality: template.modality ?? "",
      subspecialty: template.subspecialty ?? "",
      bodyPart: template.bodyPart ?? "",
      clinicalHistory: template.clinicalHistory ?? "",
      findings: template.findings ?? "",
      impression: template.impression ?? "",
      technique: template.technique ?? "",
      comparison: template.comparison ?? "",
      recommendations: template.recommendations ?? "",
      isActive: template.isActive,
    });
    setFormErrors({});
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingTemplate(null);
    setFormData(EMPTY_FORM);
    setFormErrors({});
  };

  const validateForm = (): boolean => {
    const errors: Partial<TemplateFormData> = {};
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!formData.findings.trim()) errors.findings = "Findings is required";
    if (!formData.impression.trim()) errors.impression = "Impression is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      if (editingTemplate) {
        await apiClient.patch<{ data: ReportTemplate }>(
          `/templates/${encodeURIComponent(editingTemplate.id)}`,
          formData,
        );
      } else {
        await apiClient.post<{ data: ReportTemplate }>("/templates", formData);
      }
      handleCloseForm();
      await loadTemplates();
    } catch (e) {
      console.error("Failed to save template:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (template: ReportTemplate) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    try {
      await apiClient.delete(`/templates/${encodeURIComponent(template.id)}`);
      await loadTemplates();
    } catch (e) {
      console.error("Failed to delete template:", e);
    }
  };

  const handleChange = (field: keyof TemplateFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const filteredTemplates = templates;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <FileText size={20} className="text-text-muted" />
          <h1 className="font-heading text-xl font-bold text-text-primary">
            Report Templates
          </h1>
        </div>
        {(isAdminOrManager || isRadiologist) && (
          <button
            type="button"
            onClick={handleOpenCreate}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
          >
            <Plus size={16} />
            Create Template
          </button>
        )}
      </div>

      <div className="rounded-md border border-border bg-surface">
        <div className="border-b border-border p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search templates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-md border border-border bg-editor text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setFilterOpen(!filterOpen)}
                className={clsx(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  filterOpen
                    ? "bg-accent text-background border-accent"
                    : "bg-surface text-text-primary border-border hover:bg-surface-raised",
                )}
              >
                <Filter size={14} />
                Filters
                {filterOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          {filterOpen && (
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <select
                value={modalityFilter}
                onChange={(e) => setModalityFilter(e.target.value)}
                className="flex-1 rounded-md border border-border bg-editor px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="">All Modalities</option>
                {MODALITIES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={subspecialtyFilter}
                onChange={(e) => setSubspecialtyFilter(e.target.value)}
                className="flex-1 rounded-md border border-border bg-editor px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="">All Subspecialties</option>
                {SUBSPECIALTIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value)}
                className="flex-1 rounded-md border border-border bg-editor px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="all">All</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-text-muted" />
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <FileText size={48} className="text-text-muted" />
              <p className="mt-4 text-text-muted">
                {search || modalityFilter || subspecialtyFilter || activeFilter !== "all"
                  ? "No templates match your filters"
                  : "No templates yet"}
              </p>
              {(isAdminOrManager || isRadiologist) && !loading && (
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="mt-4 flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90"
                >
                  <Plus size={16} />
                  Create First Template
                </button>
              )}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-raised">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Modality
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Subspecialty
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Body Part
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Created By
                  </th>
                  {(isAdminOrManager || isRadiologist) && (
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((template) => (
                  <tr
                    key={template.id}
                    className="border-b border-border/50 hover:bg-surface-raised/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-text-primary">{template.name}</div>
                      {template.description && (
                        <div className="text-xs text-text-muted mt-0.5 line-clamp-1">
                          {template.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {template.modality ? (
                        <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                          {template.modality}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {template.subspecialty ? (
                        <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                          {template.subspecialty}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {template.bodyPart ? (
                        <span className="text-sm text-text-primary">{template.bodyPart}</span>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          template.isActive
                            ? "bg-success/10 text-success"
                            : "bg-surface text-text-muted",
                        )}
                      >
                        {template.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-primary">
                        {template.creator?.displayName ?? template.creator?.email ?? "Unknown"}
                      </span>
                    </td>
                    {(isAdminOrManager || isRadiologist) && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {(isAdminOrManager || (isRadiologist && template.createdById === currentUser?.id)) && (
                            <button
                              type="button"
                              onClick={() => handleEdit(template)}
                              className="p-1.5 rounded-md text-text-muted hover:bg-surface-raised hover:text-text-primary transition-colors"
                              title="Edit"
                            >
                              <Edit size={14} />
                            </button>
                          )}
                          {isAdminOrManager && (
                            <button
                              type="button"
                              onClick={() => handleDelete(template)}
                              className="p-1.5 rounded-md text-text-muted hover:bg-surface-raised hover:text-error transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface p-4">
              <h2 className="font-heading text-lg font-semibold text-text-primary">
                {editingTemplate ? "Edit Template" : "Create Template"}
              </h2>
              <button
                type="button"
                onClick={handleCloseForm}
                className="p-1 rounded-md text-text-muted hover:bg-surface-raised hover:text-text-primary transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Template Name <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleChange("name", e.target.value)}
                      className={clsx(
                        "w-full rounded-md border bg-editor px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none",
                        formErrors.name ? "border-error" : "border-border",
                      )}
                      placeholder="e.g., CT Chest with Contrast"
                    />
                    {formErrors.name && (
                      <p className="mt-1 text-xs text-error">{formErrors.name}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => handleChange("description", e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-border bg-editor px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                      placeholder="Brief description of when to use this template"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Modality
                      </label>
                      <select
                        value={formData.modality}
                        onChange={(e) => handleChange("modality", e.target.value)}
                        className="w-full rounded-md border border-border bg-editor px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                      >
                        <option value="">Select modality</option>
                        {MODALITIES.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Subspecialty
                      </label>
                      <select
                        value={formData.subspecialty}
                        onChange={(e) => handleChange("subspecialty", e.target.value)}
                        className="w-full rounded-md border border-border bg-editor px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                      >
                        <option value="">Select subspecialty</option>
                        {SUBSPECIALTIES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Body Part
                    </label>
                    <input
                      type="text"
                      value={formData.bodyPart}
                      onChange={(e) => handleChange("bodyPart", e.target.value)}
                      className="w-full rounded-md border border-border bg-editor px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                      placeholder="e.g., Chest, Left Knee"
                    />
                  </div>
                </div>

                <div className="space-y-4 lg:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Clinical History
                  </label>
                  <textarea
                    value={formData.clinicalHistory}
                    onChange={(e) => handleChange("clinicalHistory", e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-editor px-3 py-2 font-serif text-sm leading-relaxed text-editor-ink placeholder-editor-ink/40 focus:border-accent focus:bg-editor focus:outline-none"
                    placeholder="Relevant clinical history..."
                  />

                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Technique
                  </label>
                  <textarea
                    value={formData.technique}
                    onChange={(e) => handleChange("technique", e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-editor px-3 py-2 font-serif text-sm leading-relaxed text-editor-ink placeholder-editor-ink/40 focus:border-accent focus:bg-editor focus:outline-none"
                    placeholder="Imaging technique / protocol..."
                  />

                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Comparison
                  </label>
                  <textarea
                    value={formData.comparison}
                    onChange={(e) => handleChange("comparison", e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-border bg-editor px-3 py-2 font-serif text-sm leading-relaxed text-editor-ink placeholder-editor-ink/40 focus:border-accent focus:bg-editor focus:outline-none"
                    placeholder="Prior studies for comparison..."
                  />

                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Findings <span className="text-error">*</span>
                  </label>
                  <textarea
                    value={formData.findings}
                    onChange={(e) => handleChange("findings", e.target.value)}
                    rows={6}
                    className={clsx(
                      "w-full rounded-md border bg-editor px-3 py-2 font-serif text-sm leading-relaxed text-editor-ink placeholder-editor-ink/40 focus:border-accent focus:bg-editor focus:outline-none",
                      formErrors.findings ? "border-error" : "border-border",
                    )}
                    placeholder="Enter radiological findings..."
                  />
                  {formErrors.findings && (
                    <p className="mt-1 text-xs text-error">{formErrors.findings}</p>
                  )}

                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Impression <span className="text-error">*</span>
                  </label>
                  <textarea
                    value={formData.impression}
                    onChange={(e) => handleChange("impression", e.target.value)}
                    rows={4}
                    className={clsx(
                      "w-full rounded-md border bg-editor px-3 py-2 font-serif text-sm leading-relaxed text-editor-ink placeholder-editor-ink/40 focus:border-accent focus:bg-editor focus:outline-none",
                      formErrors.impression ? "border-error" : "border-border",
                    )}
                    placeholder="Enter impression / conclusion..."
                  />
                  {formErrors.impression && (
                    <p className="mt-1 text-xs text-error">{formErrors.impression}</p>
                  )}

                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Recommendations
                  </label>
                  <textarea
                    value={formData.recommendations}
                    onChange={(e) => handleChange("recommendations", e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-editor px-3 py-2 font-serif text-sm leading-relaxed text-editor-ink placeholder-editor-ink/40 focus:border-accent focus:bg-editor focus:outline-none"
                    placeholder="Follow-up / management recommendations..."
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => handleChange("isActive", e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  Active template
                </label>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="inline animate-spin mr-2" />
                      Saving...
                    </>
                  ) : editingTemplate ? (
                    "Update Template"
                  ) : (
                    "Create Template"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}