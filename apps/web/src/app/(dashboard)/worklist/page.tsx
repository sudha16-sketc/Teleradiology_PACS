"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  StudyPriority,
  WorklistItem,
  WorklistFilters,
} from "@axis/types";
import { clsx } from "clsx";
import { Search, UserPlus, X, Loader2, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PriorityBadge } from "@/components/ui/PriorityBadge";
import { AcuityPulse } from "@/components/ui/AcuityPulse";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { FilterBar } from "@/components/ui/FilterBar";
import type { FilterConfig } from "@/components/ui/FilterBar";
import { useAppStore } from "@/lib/store";
import { apiClient } from "@/lib/api-client";

interface Radiologist {
  id: string;
  displayName: string;
  email: string;
  subspecialty: string | null;
  licenseNumber: string | null;
  workload: { assigned: number; inProgress: number; pending: number };
}

const FILTER_CONFIGS: FilterConfig[] = [
  {
    key: "priority",
    label: "Priority",
    options: [
      { label: "STAT", value: "STAT" },
      { label: "Urgent", value: "URGENT" },
      { label: "Routine", value: "ROUTINE" },
    ],
  },
  {
    key: "status",
    label: "Status",
    options: [
      { label: "Submitted", value: "HOSPITAL_SUBMITTED" },
      { label: "Receiving", value: "RECEIVING" },
      { label: "Validating", value: "VALIDATING" },
      { label: "Unassigned", value: "UNASSIGNED" },
      { label: "Assigned", value: "ASSIGNED" },
      { label: "In Reading", value: "IN_READING" },
      { label: "Draft Report", value: "REPORT_DRAFT" },
      { label: "Signed", value: "RADIOLOGIST_SIGNED" },
      { label: "Manager Review", value: "MANAGER_REVIEW" },
      { label: "Approved", value: "MANAGER_APPROVED" },
      { label: "Delivered", value: "DELIVERED_TO_HOSPITAL" },
      { label: "Hospital Review", value: "HOSPITAL_REVIEW" },
      { label: "Accepted", value: "HOSPITAL_ACCEPTED" },
      { label: "Completed", value: "COMPLETED" },
      { label: "Correction Requested", value: "CORRECTION_REQUESTED" },
      { label: "Change Requested", value: "HOSPITAL_CHANGE_REQUESTED" },
      { label: "Cancelled", value: "CANCELLED" },
    ],
  },
  {
    key: "modality",
    label: "Modality",
    options: [
      { label: "CT", value: "CT" },
      { label: "MRI", value: "MRI" },
      { label: "XR", value: "XR" },
      { label: "US", value: "US" },
      { label: "MG", value: "MG" },
      { label: "DX", value: "DX" },
      { label: "NM", value: "NM" },
    ],
  },
];

const PRIORITY_ORDER: Record<StudyPriority, number> = {
  STAT: 0,
  URGENT: 1,
  ROUTINE: 2,
};

const MAX_DELETE_BATCH = 50;

function formatTAT(minutes: number | null | undefined): string {
  if (!minutes || minutes === 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatSLA(minutes: number | null | undefined): string {
  if (minutes === undefined || minutes === null) return "—";
  if (minutes <= 0) return "Breached";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Studies that may still be (re)assigned. Once reading/review/delivery has
// begun the study is locked to its assigned radiologist and must not show a
// misleading Assign action.
const ASSIGNABLE_STATES = new Set([
  "HOSPITAL_SUBMITTED",
  "RECEIVING",
  "VALIDATING",
  "UNASSIGNED",
  "ASSIGNED",
]);

function isAssignableStatus(status: string): boolean {
  return ASSIGNABLE_STATES.has(status);
}

export default function WorklistPage() {
  const router = useRouter();
  const { filterState, setFilterState, sortState } = useAppStore();
  const currentUser = useAppStore((s) => s.currentUser);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [items, setItems] = useState<WorklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const [assigning, setAssigning] = useState<WorklistItem | null>(null);
  const [radiologists, setRadiologists] = useState<Radiologist[]>([]);
  const [loadingRads, setLoadingRads] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [selectedStudies, setSelectedStudies] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isRadiologist = currentUser?.role === "RADIOLOGIST";
  const isCoordinator = currentUser?.role === "MANAGER" || currentUser?.role === "ADMIN";

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const endpoint = "/worklist/my";
      const res = await apiClient.get<{ data: WorklistItem[] }>(endpoint);
      const nextItems = res.data ?? [];
      setItems(nextItems);
      const availableUids = new Set(
        nextItems.map((item) => item.study.studyInstanceUid),
      );
      setSelectedStudies((current) =>
        new Set([...current].filter((uid) => availableUids.has(uid))),
      );
    } catch (e) {
      console.error("Failed to load worklist", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAssign = useCallback(async (item: WorklistItem) => {
    setAssigning(item);
    setAssignError(null);
    setLoadingRads(true);
    try {
      const res = await apiClient.get<{ data: Radiologist[] }>(
        "/worklist/radiologists",
      );
      setRadiologists(res.data ?? []);
    } catch (e) {
      console.error("Failed to load radiologists", e);
      setAssignError("Failed to load radiologists");
    } finally {
      setLoadingRads(false);
    }
  }, []);

  const doAssign = useCallback(
    async (radiologistId: string) => {
      if (!assigning) return;
      setAssigningId(radiologistId);
      setAssignError(null);
      try {
        await apiClient.post(
          `/worklist/${assigning.study.studyInstanceUid}/assign`,
          { radiologistId },
        );
        setAssigning(null);
        await load();
      } catch {
        setAssignError("Failed to assign study");
      } finally {
        setAssigningId(null);
      }
    },
    [assigning, load],
  );

  const filteredItems = useMemo(() => {
    let list = [...items];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (item) =>
          item.study?.patient?.displayName?.toLowerCase().includes(q) ||
          item.study?.accessionNumber?.toLowerCase().includes(q) ||
          item.study?.studyDescription?.toLowerCase().includes(q),
      );
    }

    if (filterState.priority?.length) {
      list = list.filter((item) =>
        filterState.priority!.includes(item.study.priority),
      );
    }
    if (filterState.status?.length) {
      list = list.filter((item) =>
        filterState.status!.includes(item.study.status),
      );
    }
    if (filterState.modality?.length) {
      list = list.filter((item) =>
        filterState.modality!.includes(item.study.modality),
      );
    }

    list.sort((a, b) => {
      const dir = sortState.direction === "asc" ? 1 : -1;
      switch (sortState.field) {
        case "priority":
          return (PRIORITY_ORDER[a.study.priority] - PRIORITY_ORDER[b.study.priority]) * dir;
        case "patient":
          return (a.study?.patient?.displayName ?? "").localeCompare(b.study?.patient?.displayName ?? "") * dir;
        case "modality":
          return a.study.modality.localeCompare(b.study.modality) * dir;
        case "status":
          return a.study.status.localeCompare(b.study.status) * dir;
        default:
          return 0;
      }
    });

    return list;
  }, [items, searchQuery, filterState, sortState]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      switch (e.key) {
        case "j":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
          break;
        case "k":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter": {
          const target = filteredItems[selectedIndex];
          if (target) {
            e.preventDefault();
            router.push(`/reading/${encodeURIComponent(target.study.studyInstanceUid)}`);
          }
          break;
        }
      }
    },
    [filteredItems, router, selectedIndex],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, filterState]);

  const handleFilterChange = (key: string, values: string[]) => {
    setFilterState({ [key]: values } as Partial<WorklistFilters>);
  };

  const selectedItems = items.filter((item) =>
    selectedStudies.has(item.study.studyInstanceUid),
  );
  const visibleUids = filteredItems.map((item) => item.study.studyInstanceUid);
  const allVisibleSelected =
    visibleUids.length > 0 &&
    visibleUids.slice(0, MAX_DELETE_BATCH).every((uid) => selectedStudies.has(uid));

  const toggleStudySelection = (studyUid: string) => {
    setSelectedStudies((current) => {
      if (!current.has(studyUid) && current.size >= MAX_DELETE_BATCH) return current;
      const next = new Set(current);
      if (next.has(studyUid)) next.delete(studyUid);
      else next.add(studyUid);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedStudies((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleUids.forEach((uid) => next.delete(uid));
      else {
        const remaining = Math.max(0, MAX_DELETE_BATCH - next.size);
        visibleUids
          .filter((uid) => !next.has(uid))
          .slice(0, remaining)
          .forEach((uid) => next.add(uid));
      }
      return next;
    });
  };

  const deleteSelected = async () => {
    if (!selectedItems.length) return;
    setDeleting(true);
    setDeleteMessage(null);
    setDeleteError(null);
    try {
      const response = await apiClient.post<{
        data: Array<{
          studyInstanceUid: string;
          status: "DELETED" | "FAILED";
          error?: string;
        }>;
      }>("/manual-deletions/studies", {
        studyInstanceUids: selectedItems.map((item) => item.study.studyInstanceUid),
      });
      const deleted = response.data.filter((result) => result.status === "DELETED");
      const failed = response.data.filter((result) => result.status === "FAILED");
      setSelectedStudies((current) => {
        const next = new Set(current);
        deleted.forEach((result) => next.delete(result.studyInstanceUid));
        return next;
      });
      setShowDeleteConfirm(false);
      if (deleted.length) {
        setDeleteMessage(`${deleted.length} study${deleted.length === 1 ? "" : "ies"} deleted and archived.`);
      }
      if (failed.length) {
        setDeleteError(
          failed.map((result) => `${result.studyInstanceUid}: ${result.error ?? "Deletion failed"}`).join(" "),
        );
      }
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Deletion failed.");
    } finally {
      setDeleting(false);
    }
  };

  if (hasError) {
    return (
      <ErrorState
        title="Failed to load worklist"
        description="Unable to fetch studies. Please check your connection and try again."
        onRetry={() => load()}
      />
    );
  }

  const gridCols = isCoordinator
    ? "grid-cols-[2rem_2rem_1fr_1.2fr_0.5fr_1fr_0.5fr_0.5fr_1fr_6rem]"
    : "grid-cols-[2rem_1fr_1.2fr_0.5fr_1fr_0.5fr_0.5fr_1fr]";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">
            {isRadiologist ? "My Worklist" : isCoordinator ? "Assignment Queue" : "Worklist"}
          </h1>
          <p className="text-sm text-text-muted">
            {filteredItems.length} {filteredItems.length === 1 ? "study" : "studies"}
          </p>
        </div>
        {isCoordinator && selectedStudies.size > 0 && (
          <div className="flex items-center gap-3">
            {selectedStudies.size === MAX_DELETE_BATCH && (
              <span className="text-xs text-text-muted">Maximum 50 studies per deletion.</span>
            )}
            <button
              onClick={() => {
                setDeleteError(null);
                setDeleteMessage(null);
                setShowDeleteConfirm(true);
              }}
              className="flex items-center gap-2 rounded-md bg-error/10 px-3 py-2 text-sm font-medium text-error hover:bg-error/20"
            >
              <Trash2 size={16} />
              Delete selected ({selectedStudies.size})
            </button>
          </div>
        )}
      </div>

      {deleteMessage && (
        <div role="status" className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {deleteMessage}
        </div>
      )}
      {deleteError && (
        <div role="alert" className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {deleteError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder="Search patient, accession, description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <FilterBar
        filters={FILTER_CONFIGS}
        activeFilters={
          Object.fromEntries(
            Object.entries(filterState).filter(
              ([, v]) => Array.isArray(v) && v.length > 0,
            )
          ) as Record<string, string[]>
        }
        onChange={handleFilterChange}
      />

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={isRadiologist ? "No studies assigned to you" : "No studies found"}
          description="Studies will appear here once they are submitted to the platform."
        />
      ) : (
        <div className="overflow-x-auto">
        <div className="min-w-[980px] rounded-md border border-border">
          <div className={`grid ${gridCols} gap-4 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted`}>
            <div />
            {isCoordinator && (
              <div>
                <input
                  type="checkbox"
                  aria-label="Select up to 50 visible studies"
                  checked={allVisibleSelected}
                  onChange={toggleVisibleSelection}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            )}
            <div>Patient</div>
            <div>Study</div>
            <div>Mod.</div>
            <div>Hospital</div>
            <div>TAT</div>
            <div>SLA</div>
            <div>Status</div>
            {isCoordinator && <div>Action</div>}
          </div>

          {filteredItems.map((item, index) => (
            <div
              key={item.study.studyInstanceUid}
              className={`grid ${gridCols} items-center gap-4 border-b border-border px-4 py-3 transition-colors ${
                index === selectedIndex ? "bg-accent/5" : "hover:bg-surface-raised/50"
              }`}
              onClick={() => setSelectedIndex(index)}
              role="row"
              tabIndex={0}
              onDoubleClick={() =>
                router.push(`/reading/${encodeURIComponent(item.study.studyInstanceUid)}`)
              }
            >
              <AcuityPulse
                priority={item.study.priority}
                status={item.study.status}
              />
              {isCoordinator && (
                <div>
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.study.accessionNumber}`}
                    checked={selectedStudies.has(item.study.studyInstanceUid)}
                    onChange={() => toggleStudySelection(item.study.studyInstanceUid)}
                    onClick={(event) => event.stopPropagation()}
                    disabled={
                      !selectedStudies.has(item.study.studyInstanceUid) &&
                      selectedStudies.size >= MAX_DELETE_BATCH
                    }
                  />
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-sm font-medium text-text-primary">
                  {item.study.patient.displayName}
                </span>
                <span className="text-xs text-text-muted">
                  {item.study.accessionNumber}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-text-primary">
                  {item.study.studyDescription}
                </span>
                <span className="text-xs text-text-muted">
                  {item.study.bodyPart}
                </span>
              </div>
              <span className="font-mono text-xs text-text-muted">
                {item.study.modality}
              </span>
              <span className="text-sm text-text-muted">
                {item.study.hospital?.name ?? "—"}
              </span>
              <span className="font-mono text-xs text-text-muted">
                {formatTAT(item.tatMinutes)}
              </span>
              <span
                className={clsx(
                  "font-mono text-xs",
                  item.slaRemaining !== undefined && item.slaRemaining !== null && item.slaRemaining <= 60
                    ? "text-error"
                    : item.slaRemaining !== undefined && item.slaRemaining !== null && item.slaRemaining <= 120
                      ? "text-warning"
                      : "text-text-muted",
                )}
              >
                {formatSLA(item.slaRemaining)}
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge status={item.study.status} />
                <PriorityBadge priority={item.study.priority} />
              </div>
              {isCoordinator &&
                isAssignableStatus(item.study.status) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void openAssign(item);
                  }}
                  className="flex items-center gap-1 rounded bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20"
                >
                  <UserPlus size={12} />
                  Assign
                </button>
              )}
            </div>
          ))}
        </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>j/k to navigate, Enter or double-click to open</span>
        <span>{filteredItems.length} studies</span>
      </div>

      {assigning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !assigningId && setAssigning(null)}
        >
          <div
            className="w-full max-w-md rounded-md border border-border bg-surface-raised p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-text-primary">
                Assign Radiologist
              </h2>
              <button
                onClick={() => setAssigning(null)}
                disabled={!!assigningId}
                className="text-text-muted hover:text-text-primary"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <p className="mt-1 text-sm text-text-muted">
              {assigning.study.patient.displayName} —{" "}
              {assigning.study.studyDescription} ({assigning.study.modality})
            </p>
            <p className="mt-0.5 text-xs font-mono text-text-muted">
              {assigning.study.accessionNumber}
            </p>

            {assignError && (
              <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {assignError}
              </div>
            )}

            <div className="mt-4 max-h-72 overflow-y-auto">
              {loadingRads ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  Loading radiologists...
                </div>
              ) : radiologists.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">
                  No radiologists available
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {radiologists.map((rad) => (
                    <button
                      key={rad.id}
                      onClick={() => void doAssign(rad.id)}
                      disabled={assigningId === rad.id}
                      className="flex items-center justify-between rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-accent/40 disabled:opacity-60"
                    >
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {rad.displayName}
                        </p>
                        <p className="text-xs text-text-muted">
                          {rad.subspecialty?.replace(/_/g, " ") ?? "General"}
                        </p>
                      </div>
                      <div className="flex gap-3 text-right text-xs text-text-muted">
                        <span>
                          <span className="block font-semibold text-text-primary">
                            {rad.workload.assigned}
                          </span>
                          Assigned
                        </span>
                        <span>
                          <span className="block font-semibold text-text-primary">
                            {rad.workload.inProgress}
                          </span>
                          In Progress
                        </span>
                        <span>
                          <span className="block font-semibold text-text-primary">
                            {rad.workload.pending}
                          </span>
                          Pending
                        </span>
                        {assigningId === rad.id && (
                          <Loader2 size={14} className="animate-spin self-center" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleting && setShowDeleteConfirm(false)}
        >
          <div
            className="w-full max-w-xl rounded-md border border-border bg-surface-raised p-6 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-text-primary">
                Delete {selectedItems.length} selected {selectedItems.length === 1 ? "study" : "studies"}?
              </h2>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                aria-label="Close delete confirmation"
                className="text-text-muted hover:text-text-primary"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-3 text-sm text-text-muted">
              These records will be removed from active database access. A verified
              S3 archive will remain recoverable in Recently Deleted until its
              retention period expires.
            </p>
            <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded border border-border p-3 text-sm text-text-primary">
              {selectedItems.map((item) => (
                <li key={item.study.studyInstanceUid}>
                  {item.study.patient.displayName} — {item.study.accessionNumber}
                </li>
              ))}
            </ul>
            {deleteError && (
              <div role="alert" className="mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {deleteError}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void deleteSelected()}
                disabled={deleting || selectedItems.length === 0}
                className="flex items-center gap-2 rounded-md bg-error px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {deleting && <Loader2 size={14} className="animate-spin" />}
                Delete and archive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
