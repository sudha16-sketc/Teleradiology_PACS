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
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { clsx } from "clsx";
import type { ReportTemplate, UserRole } from "@axis/types";
import { apiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { RichReportEditor } from "@/components/report/RichReportEditor";
import { ErrorState } from "@/components/ui/ErrorState";
import { htmlToPlainText, legacyFieldsToHtml } from "@/lib/report-html";

interface TemplateNotice {
  kind: "success" | "error";
  message: string;
}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

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
  contentHtml: string;
  isActive: boolean;
}

const BLANK_TEMPLATE_HTML = [
  "<h2>Clinical History</h2><p><br /></p>",
  "<h2>Technique</h2><p><br /></p>",
  "<h2>Comparison</h2><p><br /></p>",
  "<h2>Findings</h2><p><br /></p>",
  "<h2>Impression</h2><p><br /></p>",
  "<h2>Recommendations</h2><p><br /></p>",
].join("");

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
  contentHtml: BLANK_TEMPLATE_HTML,
  isActive: true,
};

export default function TemplatesPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const userRole = currentUser?.role as UserRole;
  const isAdminOrManager = userRole === "ADMIN" || userRole === "MANAGER";
  const isRadiologist = userRole === "RADIOLOGIST";

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<TemplateNotice | null>(null);
  const [search, setSearch] = useState("");
  const [modalityFilter, setModalityFilter] = useState("");
  const [subspecialtyFilter, setSubspecialtyFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReportTemplate | null>(null);
  const [formData, setFormData] = useState<TemplateFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<TemplateFormData>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
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
      setLoadError(
        errorMessage(e, "Unable to load templates. Please try again."),
      );
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
    setFormError(null);
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
      contentHtml: template.contentHtml?.trim()
        ? template.contentHtml
        : legacyFieldsToHtml(template),
      isActive: template.isActive,
    });
    setFormErrors({});
    setFormError(null);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingTemplate(null);
    setFormData(EMPTY_FORM);
    setFormErrors({});
    setFormError(null);
  };

  const validateForm = (): boolean => {
    const errors: Partial<TemplateFormData> = {};
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!htmlToPlainText(formData.contentHtml)) {
      errors.contentHtml = "Template content is required";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setFormError(null);
    const wasEditing = Boolean(editingTemplate);
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
      setNotice({
        kind: "success",
        message: wasEditing ? "Template updated." : "Template created.",
      });
      await loadTemplates();
    } catch (e) {
      console.error("Failed to save template:", e);
      setFormError(
        errorMessage(e, "Unable to save template. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (template: ReportTemplate) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;

    setDeletingId(template.id);
    setNotice(null);
    try {
      await apiClient.delete(`/templates/${encodeURIComponent(template.id)}`);
      setNotice({
        kind: "success",
        message: `Template "${template.name}" deleted.`,
      });
    } catch (e) {
      console.error("Failed to delete template:", e);
      setNotice({
        kind: "error",
        message: errorMessage(
          e,
          `Unable to delete template "${template.name}". Please try again.`,
        ),
      });
      setDeletingId(null);
      return;
    }
    setDeletingId(null);
    await loadTemplates();
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

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={clsx(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            notice.kind === "error"
              ? "border-error/30 bg-error/10 text-error"
              : "border-success/30 bg-success/10 text-success",
          )}
        >
          {notice.kind === "error" ? (
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          )}
          <p className="flex-1">{notice.message}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
            aria-label="Dismiss message"
          >
            <X size={14} />
          </button>
        </div>
      )}

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
          ) : loadError ? (
            <ErrorState
              title="Unable to load templates"
              description={loadError}
              onRetry={() => void loadTemplates()}
            />
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
            <table className="w-full min-w-[900px]">
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
                              disabled={deletingId === template.id}
                              className="p-1.5 rounded-md text-text-muted hover:bg-surface-raised hover:text-error transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                              title="Delete"
                            >
                              {deletingId === template.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
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
              {formError && (
                <div
                  role="alert"
                  className="mb-4 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{formError}</p>
                </div>
              )}
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

                <div className="space-y-2 lg:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Template Content <span className="text-error">*</span>
                  </label>
                  <RichReportEditor
                    value={formData.contentHtml}
                    onChange={(html) => handleChange("contentHtml", html)}
                    enableImages={false}
                    minHeight={320}
                    placeholder="Build the reusable report template..."
                  />
                  {formErrors.contentHtml && (
                    <p className="text-xs text-error">{formErrors.contentHtml}</p>
                  )}
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