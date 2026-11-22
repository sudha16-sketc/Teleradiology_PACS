"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  FileArchive,
  Loader2,
  CheckCircle2,
  X,
  AlertTriangle,
  ArrowLeft,
  FolderOpen,
  FileUp,
} from "lucide-react";
import { apiClient, failureOf } from "@/lib/api-client";
import { isDesktop } from "@/lib/platform";
import {
  collectDicomFolder,
  pickDicomFiles,
  pickDicomFolder,
  readPickedFileAsFile,
  releasePickedPaths,
  type PickedFile,
} from "@/lib/desktop-bridge";
import {
  validateSelection,
  humanBytes,
  type SelectedFile,
} from "@/lib/dicom-selection";
import { ErrorPanel } from "@/components/ErrorPanel";

interface IngestEnvelope {
  data: {
    study: {
      studyInstanceUid: string;
      accessionNumber: string;
      patient: {
        displayName: string;
      };
      modality: string;
      studyDescription: string;
      priority: string;
      status: string;
      seriesCount: number;
      instanceCount: number;
    };
    orthancStudyId: string;
    instanceCount: number;
    skipped: number;
  };
}

type UploadStage =
  | "idle"
  | "uploading"
  | "sending"
  | "ready"
  | "error";

type PatientGender = "M" | "F" | "O" | "U";

interface HistoryFormState {
  patientName: string;
  patientAge: string;
  gender: PatientGender | "";
  referringPhysician: string;
  clinicalHistory: string;
}

const INITIAL_HISTORY: HistoryFormState = {
  patientName: "",
  patientAge: "",
  gender: "",
  referringPhysician: "",
  clinicalHistory: "",
};

const MAX_HISTORY_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const HISTORY_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

function historyAttachmentMimeType(file: File): string | undefined {
  if (HISTORY_ATTACHMENT_MIME_TYPES.includes(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (/\.(jpe?g)$/.test(name)) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  return undefined;
}

const PRIORITY_LABEL: Record<string, string> = {
  STAT: "STAT",
  URGENT: "Urgent",
  ROUTINE: "Routine",
};

export default function SubmitStudyPage() {
  const router = useRouter();

  // Desktop selections carry a native path and are read on demand; browser
  // selections are already `File` objects from the input or a drop.
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [result, setResult] =
    useState<IngestEnvelope["data"] | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [uploadFailure, setUploadFailure] = useState<ReturnType<
    typeof failureOf
  > | null>(null);
  const [historyForm, setHistoryForm] =
    useState<HistoryFormState>(INITIAL_HISTORY);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttachment, setHistoryAttachment] = useState<File | null>(null);
  const [attachmentUploadFailure, setAttachmentUploadFailure] =
    useState<ReturnType<typeof failureOf> | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentUploaded, setAttachmentUploaded] = useState(false);
  const [picking, setPicking] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const isUploading = stage === "uploading" || stage === "sending";
  const desktop = isDesktop();

  const clearMessages = useCallback(() => {
    setSelectionError(null);
    setUploadFailure(null);
    setHistoryError(null);
    setAttachmentUploadFailure(null);
    setAttachmentUploaded(false);
    setResult(null);
    setStage("idle");
  }, []);

  /**
   * Apply a candidate selection, replacing whatever was chosen before.
   *
   * Validation lives in `dicom-selection.ts` so the browser and the native
   * picker are held to the same budgets and can both be unit tested.
   */
  const applySelection = useCallback(
    (incoming: readonly SelectedFile[]) => {
      clearMessages();

      const outcome = validateSelection(incoming);
      if (!outcome.ok) {
        setFiles([]);
        setSelectionError(outcome.message);
        return;
      }

      setFiles(outcome.files);
    },
    [clearMessages],
  );

  /**
   * Drop the shell's filesystem grants for whatever is currently selected.
   *
   * Called when a selection is replaced and after an upload finishes, so the
   * shell does not retain read access to files from earlier attempts.
   */
  const releaseSelection = useCallback((previous: readonly SelectedFile[]) => {
    const paths = previous
      .map((file) => file.path)
      .filter((path): path is string => typeof path === "string");
    if (paths.length) void releasePickedPaths(paths);
  }, []);

  /**
   * Native file picker.
   *
   * The dialog is opened by Rust, which is what lets the shell scope reads to
   * exactly the chosen files. Cancelling leaves the page untouched.
   */
  const handleNativeFiles = useCallback(async () => {
    setPicking(true);
    try {
      const picked = await pickDicomFiles();
      if (!picked.ok) {
        setSelectionError("The file picker could not be opened.");
        return;
      }
      // `null` is a cancellation, not a failure.
      if (picked.value === null) return;
      applySelection(picked.value);
    } finally {
      setPicking(false);
    }
  }, [applySelection]);

  /**
   * Native folder picker, followed by the Rust-side recursive walk.
   */
  const handleNativeFolder = useCallback(async () => {
    setPicking(true);
    try {
      const folder = await pickDicomFolder();
      if (!folder.ok) {
        setSelectionError("The folder picker could not be opened.");
        return;
      }
      if (folder.value === null) return;

      const walked = await collectDicomFolder(folder.value.path);
      if (!walked.ok) {
        setFiles([]);
        // The message is authored in Rust and already explains the limit.
        setSelectionError(walked.reason);
        return;
      }
      applySelection(walked.value);
    } finally {
      setPicking(false);
    }
  }, [applySelection]);

  const uploadHistoryAttachment = async (studyUid: string, file: File) => {
    setAttachmentUploading(true);
    setAttachmentUploadFailure(null);
    try {
      const mimeType = historyAttachmentMimeType(file);
      if (!mimeType) {
        throw new Error("Choose a PDF, JPEG, or PNG supporting file.");
      }
      const uploadFile =
        file.type === mimeType
          ? file
          : new File([file], file.name, { type: mimeType });
      const formData = new FormData();
      formData.append("file", uploadFile, file.name);
      await apiClient.post(
        `/studies/${encodeURIComponent(studyUid)}/history/attachments`,
        formData,
      );
      setAttachmentUploaded(true);
    } catch (error: unknown) {
      setAttachmentUploadFailure(failureOf(error));
    } finally {
      setAttachmentUploading(false);
    }
  };

  /**
   * Recursively collect files from a dragged folder.
   *
   * Chromium exposes directory entries through `webkitGetAsEntry()`.
   */
  const collectDroppedFiles = useCallback(
    async (items: DataTransferItemList): Promise<SelectedFile[]> => {
      const collected: SelectedFile[] = [];

      const readEntry = async (entry: FileSystemEntry): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          await new Promise<void>((resolve) => {
            fileEntry.file(
              (file) => {
                collected.push({ name: file.name, size: file.size, file });
                resolve();
              },
              () => resolve(),
            );
          });
          return;
        }

        if (!entry.isDirectory) return;

        const reader = (entry as FileSystemDirectoryEntry).createReader();

        await new Promise<void>((resolve) => {
          // `readEntries` yields at most ~100 entries per call and signals the
          // end of the directory with an empty batch, so it has to be drained.
          const readEntries = () => {
            reader.readEntries(
              async (entries) => {
                if (!entries.length) {
                  resolve();
                  return;
                }
                for (const child of entries) {
                  await readEntry(child);
                }
                readEntries();
              },
              () => resolve(),
            );
          };
          readEntries();
        });
      };

      const pending: Promise<void>[] = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind !== "file") continue;

        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          pending.push(readEntry(entry));
        } else {
          const file = item.getAsFile();
          if (file) {
            collected.push({ name: file.name, size: file.size, file });
          }
        }
      }

      await Promise.all(pending);
      return collected;
    },
    [],
  );

  /**
   * Upload the selected DICOM files.
   *
   * Desktop selections are read from their native paths here rather than up
   * front, so a 20,000-file folder is only materialised in memory once, for as
   * long as the upload takes, instead of being held for the life of the page.
   */
  const handleUpload = async () => {
    if (!files.length || isUploading) return;

    const age = Number(historyForm.patientAge);
    if (!historyForm.patientName.trim()) {
      setHistoryError("Patient name is required.");
      return;
    }
    if (
      historyForm.patientAge === "" ||
      !Number.isInteger(age) ||
      age < 0 ||
      age > 130
    ) {
      setHistoryError("Enter a patient age between 0 and 130.");
      return;
    }
    if (!historyForm.gender) {
      setHistoryError("Patient gender is required.");
      return;
    }
    if (!historyForm.clinicalHistory.trim()) {
      setHistoryError("Clinical history is required.");
      return;
    }
    if (historyForm.clinicalHistory.length > 10000) {
      setHistoryError("Clinical history must be 10,000 characters or fewer.");
      return;
    }
    if (
      historyAttachment &&
      historyAttachment.size > MAX_HISTORY_ATTACHMENT_BYTES
    ) {
      setHistoryError("Supporting files must be 10 MB or smaller.");
      return;
    }
    if (historyAttachment && !historyAttachmentMimeType(historyAttachment)) {
      setHistoryError("Choose a PDF, JPEG, or PNG supporting file.");
      return;
    }

    clearMessages();
    setStage("sending");

    try {
      const formData = new FormData();
      formData.append("patientName", historyForm.patientName.trim());
      formData.append("patientAge", String(age));
      formData.append("gender", historyForm.gender);
      formData.append("referringPhysician", historyForm.referringPhysician.trim());
      formData.append("clinicalHistory", historyForm.clinicalHistory.trim());

      for (const file of files) {
        if (file.file) {
          // Browser selection: the `File` is already in hand.
          formData.append("file", file.file, file.name);
          continue;
        }
        if (file.path === undefined) continue;
        // Desktop selection: read the bytes through the shell's scoped grant.
        const read = await readPickedFileAsFile(file as PickedFile);
        if (!read.ok) {
          throw new Error(read.reason);
        }
        formData.append("file", read.value, file.name);
      }

      const response = await apiClient.post<IngestEnvelope>(
        "/dicom/ingest",
        // A study upload is a whole study and legitimately takes minutes, so it
        // gets a much larger budget than the default request deadline rather
        // than being exempt from it.
        formData,
        { timeoutMs: 30 * 60 * 1000 },
      );

      setResult(response.data);
      setStage("ready");
      // Success: the study is in, so the shell's read access to the source files
      // is no longer needed and is withdrawn immediately.
      releaseSelection(files);
      if (historyAttachment) {
        await uploadHistoryAttachment(
          response.data.study.studyInstanceUid,
          historyAttachment,
        );
      }
    } catch (e: unknown) {
      setUploadFailure(failureOf(e));
      setStage("error");
      // Deliberately NOT releasing here.
      //
      // The retry button re-runs this handler against the same selection, and a
      // desktop read goes through the shell's filesystem scope. Releasing on
      // failure would make every retry fail immediately with a permission error
      // and leave the user with no way forward except reselecting — turning a
      // transient network fault into lost work. The grants are released on
      // success, on replacing the selection, and on reset, which are the only
      // points where the paths genuinely stop being needed.
    }
  };

  /** Clear everything and start again. */
  const reset = useCallback(() => {
    releaseSelection(files);
    setFiles([]);
    setDragActive(false);
    setStage("idle");
    clearMessages();
    setHistoryForm(INITIAL_HISTORY);
    setHistoryAttachment(null);

    if (inputRef.current) inputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }, [clearMessages, files, releaseSelection]);

  /** Replace the current selection, releasing the previous one's grants. */
  const replaceSelection = useCallback(
    (incoming: readonly SelectedFile[]) => {
      releaseSelection(files);
      applySelection(incoming);
    },
    [applySelection, files, releaseSelection],
  );

  const handleBrowserFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []);
      replaceSelection(
        picked.map((file) => ({
          name: file.name,
          size: file.size,
          file,
        })),
      );
    },
    [replaceSelection],
  );

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-md p-2 transition hover:bg-muted"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div>
              <h1 className="text-lg font-semibold">
                Create New Study
              </h1>

              <p className="text-sm text-muted-foreground">
                Upload DICOM data and provide the patient history for this study
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Upload area */}
        {!result && (
          <section>
            <div className="mb-6">
              <h2 className="text-xl font-semibold">
                Study Files
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                Upload a DICOM file, multiple DICOM files, a
                folder, or a ZIP archive.
              </p>
            </div>

            {/*
              Browser pickers. Hidden on the desktop client, where the native
              dialogs are the only way to choose a file: these inputs would
              offer a second, unscoped path to the same data, and a file chosen
              through one has no shell read grant.
            */}
            {!desktop && (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".dcm,.dicom,.zip,application/zip"
                  onChange={handleBrowserFiles}
                  className="hidden"
                />

                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  // @ts-expect-error webkitdirectory is Chromium-only
                  webkitdirectory=""
                  directory=""
                  onChange={handleBrowserFiles}
                  className="hidden"
                />
              </>
            )}

            {/* Dropzone */}
            <div
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();

                if (!isUploading) {
                  setDragActive(true);
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();

                if (!isUploading) {
                  setDragActive(true);
                }
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();

                setDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();

                setDragActive(false);

                if (isUploading) {
                  return;
                }

                void collectDroppedFiles(
                  event.dataTransfer.items
                ).then((droppedFiles) => {
                  replaceSelection(droppedFiles);
                });
              }}
              onClick={() => {
                if (isUploading) return;
                if (desktop) {
                  void handleNativeFiles();
                } else {
                  inputRef.current?.click();
                }
              }}
              className={`
                flex
                min-h-[280px]
                cursor-pointer
                flex-col
                items-center
                justify-center
                rounded-lg
                border-2
                border-dashed
                px-6
                py-12
                text-center
                transition
                ${
                  dragActive
                    ? "border-accent bg-accent/5"
                    : "border-border bg-surface hover:border-accent/60 hover:bg-muted/30"
                }
                ${
                  isUploading
                    ? "pointer-events-none cursor-not-allowed opacity-60"
                    : ""
                }
              `}
            >
              <div className="mb-4 rounded-full bg-muted p-4">
                <UploadCloud className="h-8 w-8" />
              </div>

              <h3 className="text-base font-semibold">
                {dragActive
                  ? "Drop your DICOM files here"
                  : "Drag & drop your DICOM files here"}
              </h3>

              <p className="mt-2 text-sm text-muted-foreground">
                or click anywhere in this area to choose files
              </p>

              <p className="mt-2 text-xs text-muted-foreground">
                Supported: .dcm, .dicom, .zip
              </p>

              <div
                className="mt-6 flex flex-wrap justify-center gap-3"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                {desktop ? (
                  <>
                    <button
                      type="button"
                      disabled={isUploading || picking}
                      onClick={() => {
                        void handleNativeFiles();
                      }}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {picking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileUp className="h-4 w-4" />
                      )}
                      Choose Files
                    </button>

                    <button
                      type="button"
                      disabled={isUploading || picking}
                      onClick={() => {
                        void handleNativeFolder();
                      }}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {picking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderOpen className="h-4 w-4" />
                      )}
                      Choose DICOM Folder
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => {
                      folderInputRef.current?.click();
                    }}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileArchive className="h-4 w-4" />
                    Choose DICOM Folder
                  </button>
                )}
              </div>
            </div>

            {/* Selected files */}
            {files.length > 0 && (
              <div className="mt-6 rounded-lg border border-border bg-surface">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Selected Files
                    </h3>

                    <p className="text-xs text-muted-foreground">
                      {files.length} file
                      {files.length === 1 ? "" : "s"} selected
                      {` · ${humanBytes(totalBytes)}`}
                    </p>
                  </div>

                  {!isUploading && (
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-md p-2 hover:bg-muted"
                      aria-label="Remove all files"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="max-h-64 overflow-y-auto">
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <FileArchive className="h-5 w-5 shrink-0 text-muted-foreground" />

                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {file.name}
                          </p>

                          <p className="text-xs text-muted-foreground">
                            {(file.size / 1024 / 1024).toFixed(
                              2
                            )}{" "}
                            MB
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <section className="mt-6 rounded-lg border border-border bg-surface p-6">
              <h3 className="text-base font-semibold">Patient History</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Required information is validated before the DICOM study is processed.
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Patient Name <span className="text-destructive">*</span>
                  <input
                    type="text"
                    required
                    maxLength={200}
                    value={historyForm.patientName}
                    onChange={(event) => {
                      setHistoryForm((form) => ({
                        ...form,
                        patientName: event.target.value,
                      }));
                      setHistoryError(null);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
                  />
                </label>

                <label className="text-sm font-medium">
                  Patient Age <span className="text-destructive">*</span>
                  <input
                    type="number"
                    required
                    min={0}
                    max={130}
                    step={1}
                    value={historyForm.patientAge}
                    onChange={(event) => {
                      setHistoryForm((form) => ({
                        ...form,
                        patientAge: event.target.value,
                      }));
                      setHistoryError(null);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
                  />
                </label>

                <label className="text-sm font-medium">
                  Patient Gender <span className="text-destructive">*</span>
                  <select
                    required
                    value={historyForm.gender}
                    onChange={(event) => {
                      const value = event.target.value;
                      setHistoryForm((form) => ({
                        ...form,
                        gender:
                          value === "M" ||
                          value === "F" ||
                          value === "O" ||
                          value === "U"
                            ? value
                            : "",
                      }));
                      setHistoryError(null);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
                  >
                    <option value="">Select gender</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                    <option value="U">Unknown</option>
                  </select>
                </label>

                <label className="text-sm font-medium">
                  Referring Doctor
                  <input
                    type="text"
                    maxLength={200}
                    value={historyForm.referringPhysician}
                    onChange={(event) =>
                      setHistoryForm((form) => ({
                        ...form,
                        referringPhysician: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
                  />
                </label>

                <label className="text-sm font-medium sm:col-span-2">
                  Clinical History <span className="text-destructive">*</span>
                  <textarea
                    required
                    rows={6}
                    maxLength={10000}
                    value={historyForm.clinicalHistory}
                    onChange={(event) => {
                      setHistoryForm((form) => ({
                        ...form,
                        clinicalHistory: event.target.value,
                      }));
                      setHistoryError(null);
                    }}
                    className="mt-1 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {historyForm.clinicalHistory.length}/10,000 characters
                  </span>
                </label>

                <div className="sm:col-span-2">
                  <label className="text-sm font-medium" htmlFor="history-attachment">
                    Supporting File (optional)
                  </label>
                  <input
                    ref={attachmentInputRef}
                    id="history-attachment"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    onChange={(event) => {
                      setHistoryAttachment(event.target.files?.[0] ?? null);
                      setHistoryError(null);
                      setAttachmentUploadFailure(null);
                      setAttachmentUploaded(false);
                    }}
                    className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-sm file:font-medium"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    PDF, JPEG, or PNG; maximum 10 MB.
                    {historyAttachment
                      ? ` Selected: ${historyAttachment.name} (${(
                          historyAttachment.size /
                          1024 /
                          1024
                        ).toFixed(2)} MB)`
                      : ""}
                  </p>
                </div>
              </div>

              {historyError && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {historyError}
                </p>
              )}
            </section>

            {selectionError && (
              <div className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />

                <div>
                  <p className="text-sm font-medium">Selection problem</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectionError}
                  </p>
                </div>
              </div>
            )}

            {uploadFailure && (
              <ErrorPanel
                className="mt-6"
                title="Upload failed"
                failure={uploadFailure}
                onRetry={() => {
                  void handleUpload();
                }}
              />
            )}

            {/* Upload button */}
            {files.length > 0 && (
              <div className="mt-6 flex justify-end gap-3">
                {!isUploading && (
                  <button
                    type="button"
                    onClick={reset}
                    className="
                      rounded-md
                      border
                      border-border
                      px-5
                      py-2.5
                      text-sm
                      font-medium
                      hover:bg-muted
                    "
                  >
                    Clear
                  </button>
                )}

                <button
                  type="button"
                  disabled={isUploading}
                  onClick={handleUpload}
                  className="
                    inline-flex
                    items-center
                    gap-2
                    rounded-md
                    bg-accent
                    px-5
                    py-2.5
                    text-sm
                    font-medium
                    text-accent-foreground
                    transition
                    hover:opacity-90
                    disabled:cursor-not-allowed
                    disabled:opacity-60
                  "
                >
                  {isUploading && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}

                  {stage === "sending"
                    ? "Uploading..."
                    : "Create New Study"}
                </button>
              </div>
            )}
          </section>
        )}

        {/* Success */}
        {result && (
          <section className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-success/10 p-2">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                </div>

                <div>
                  <h2 className="text-lg font-semibold">
                    Study Submitted Successfully
                  </h2>

                  <p className="text-sm text-muted-foreground">
                    The DICOM study has been received and
                    indexed.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  Patient
                </p>

                <p className="mt-1 font-medium">
                  {result.study.patient.displayName}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Accession Number
                </p>

                <p className="mt-1 font-medium">
                  {result.study.accessionNumber}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Modality
                </p>

                <p className="mt-1 font-medium">
                  {result.study.modality}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Study Description
                </p>

                <p className="mt-1 font-medium">
                  {result.study.studyDescription || "—"}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Priority
                </p>

                <p className="mt-1 font-medium">
                  {PRIORITY_LABEL[result.study.priority] ??
                    result.study.priority}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Status
                </p>

                <p className="mt-1 font-medium">
                  {result.study.status}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Series
                </p>

                <p className="mt-1 font-medium">
                  {result.study.seriesCount}
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">
                  Instances
                </p>

                <p className="mt-1 font-medium">
                  {result.instanceCount}
                </p>
              </div>
            </div>

            {result.skipped > 0 && (
              <div className="mx-6 mb-6 rounded-md border border-warning/30 bg-warning/5 p-4">
                <p className="text-sm">
                  {result.skipped} file
                  {result.skipped === 1 ? "" : "s"} could not be
                  imported.
                </p>
              </div>
            )}

            {historyAttachment && (
              <div className="mx-6 mb-6 rounded-md border border-border p-4">
                {attachmentUploading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading supporting file…
                  </p>
                ) : attachmentUploaded ? (
                  <p className="text-sm text-success">
                    Supporting file attached: {historyAttachment.name}
                  </p>
                ) : attachmentUploadFailure ? (
                  <>
                    <ErrorPanel
                      title="Study created, but the supporting file could not be uploaded"
                      failure={attachmentUploadFailure}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void uploadHistoryAttachment(
                          result.study.studyInstanceUid,
                          historyAttachment,
                        )
                      }
                      className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                    >
                      Retry supporting file upload
                    </button>
                    <label className="mt-3 block text-sm font-medium">
                      Choose a different supporting file
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        onChange={(event) => {
                          setHistoryAttachment(event.target.files?.[0] ?? null);
                          setAttachmentUploadFailure(null);
                          setAttachmentUploaded(false);
                        }}
                        className="mt-1 block w-full text-sm text-muted-foreground"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Supporting file selected: {historyAttachment.name}
                    </p>
                    <button
                      type="button"
                      disabled={attachmentUploading}
                      onClick={() =>
                        void uploadHistoryAttachment(
                          result.study.studyInstanceUid,
                          historyAttachment,
                        )
                      }
                      className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
                    >
                      Upload supporting file
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={reset}
                className="
                  rounded-md
                  border
                  border-border
                  px-4
                  py-2
                  text-sm
                  font-medium
                  hover:bg-muted
                "
              >
                Submit Another Study
              </button>

              <button
                type="button"
                onClick={() => router.push("/hospitals")}
                className="
                  rounded-md
                  bg-accent
                  px-4
                  py-2
                  text-sm
                  font-medium
                  text-accent-foreground
                  hover:opacity-90
                "
              >
                View My Studies
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}