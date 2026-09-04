"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  ArrowLeft,
  UploadCloud,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { ApiError, Study } from "@axis/types";

interface SubmitEnvelope {
  data: Study;
}

const MODALITIES = ["CT", "MRI", "XR", "US", "NM", "PET", "MG", "DX", "CR", "Fluoro"];
const SUBSPECIALTIES = [
  "NEURO",
  "MSK",
  "CHEST",
  "ABDOMEN",
  "CARDIOVASCULAR",
  "MAMMOGRAPHY",
  "GENERAL",
  "PEDIATRIC",
  "ONCOLOGY",
  "INTERVENTIONAL",
];
const PRIORITIES = ["ROUTINE", "URGENT", "STAT"];
const GENDERS = ["M", "F", "O", "U"];

const EMPTY_FORM = {
  patientName: "",
  patientId: "",
  gender: "U" as "M" | "F" | "O" | "U",
  patientBirthDate: "",
  modality: "CT",
  bodyPart: "",
  referringPhysician: "",
  studyDescription: "",
  clinicalHistory: "",
  priority: "ROUTINE" as "ROUTINE" | "URGENT" | "STAT",
  subspecialty: "GENERAL",
  dueAt: "",
};

export default function NewStudyPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Study | null>(null);

  const update = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patientName.trim()) {
      setError("Patient name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.post<SubmitEnvelope>("/studies", {
        patientName: form.patientName.trim(),
        patientId: form.patientId.trim() || undefined,
        gender: form.gender,
        patientBirthDate: form.patientBirthDate || undefined,
        modality: form.modality,
        bodyPart: form.bodyPart,
        referringPhysician: form.referringPhysician,
        studyDescription: form.studyDescription,
        clinicalHistory: form.clinicalHistory,
        priority: form.priority,
        subspecialty: form.subspecialty,
        dueAt: form.dueAt || undefined,
      });
      setCreated(res.data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : (err as ApiError)?.message;
      setError(message ?? "Failed to submit study. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className="flex max-w-2xl flex-col items-center gap-4 p-6 text-center">
        <CheckCircle2 size={48} className="text-success" />
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Study Submitted
        </h1>
        <p className="text-text-muted">
          Study <span className="font-mono text-text-primary">{created.accessionNumber}</span>{" "}
          for {created.patient?.displayName} has been submitted to Axis
          Radiology and is awaiting validation.
        </p>
        <div className="rounded-md border border-border bg-surface px-4 py-3 text-left text-sm">
          <p><span className="text-text-muted">Patient:</span> {created.patient?.displayName}</p>
          <p><span className="text-text-muted">Modality:</span> {created.modality}</p>
          <p><span className="text-text-muted">Description:</span> {created.studyDescription || "—"}</p>
          <p><span className="text-text-muted">Priority:</span> {created.priority}</p>
          <p><span className="text-text-muted">Status:</span> {created.status}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setCreated(null);
              setForm(EMPTY_FORM);
            }}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-raised"
          >
            Submit Another
          </button>
          <button
            onClick={() => router.push("/hospitals")}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Back to Hospital Portal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <button
          onClick={() => router.push("/hospitals")}
          className="mb-2 flex items-center gap-1 text-sm text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          Back to Hospital Portal
        </button>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Submit New Study
        </h1>
        <p className="text-sm text-text-muted">
          Enter the patient and examination details to submit a study to Axis
          Radiology for reporting.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-6 rounded-md border border-border bg-surface p-6"
      >
        <section>
          <h2 className="mb-3 font-heading text-sm font-semibold text-text-primary">
            Patient Information
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs font-medium text-text-muted">
                Patient Name *
              </span>
              <input
                value={form.patientName}
                onChange={(e) => update("patientName", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                placeholder="e.g. John Doe"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Patient ID / MRN
              </span>
              <input
                value={form.patientId}
                onChange={(e) => update("patientId", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Date of Birth
              </span>
              <input
                type="date"
                value={form.patientBirthDate}
                onChange={(e) => update("patientBirthDate", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Gender
              </span>
              <select
                value={form.gender}
                onChange={(e) => update("gender", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section>
          <h2 className="mb-3 font-heading text-sm font-semibold text-text-primary">
            Study Details
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Modality
              </span>
              <select
                value={form.modality}
                onChange={(e) => update("modality", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {MODALITIES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Body Part
              </span>
              <input
                value={form.bodyPart}
                onChange={(e) => update("bodyPart", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                placeholder="e.g. Chest, Head, Left Knee"
              />
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs font-medium text-text-muted">
                Study Description
              </span>
              <input
                value={form.studyDescription}
                onChange={(e) => update("studyDescription", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                placeholder="e.g. CT Chest with Contrast"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Referring Physician
              </span>
              <input
                value={form.referringPhysician}
                onChange={(e) => update("referringPhysician", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Subspecialty
              </span>
              <select
                value={form.subspecialty}
                onChange={(e) => update("subspecialty", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {SUBSPECIALTIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Priority
              </span>
              <select
                value={form.priority}
                onChange={(e) => update("priority", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">
                Due By (SLA deadline)
              </span>
              <input
                type="datetime-local"
                value={form.dueAt}
                onChange={(e) => update("dueAt", e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs font-medium text-text-muted">
                Clinical History
              </span>
              <textarea
                value={form.clinicalHistory}
                onChange={(e) => update("clinicalHistory", e.target.value)}
                rows={3}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                placeholder="Relevant clinical history for the radiologist..."
              />
            </label>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => router.push("/hospitals")}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-raised"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <UploadCloud size={15} />
            )}
            {submitting ? "Submitting..." : "Submit Study"}
          </button>
        </div>
      </form>
    </div>
  );
}
