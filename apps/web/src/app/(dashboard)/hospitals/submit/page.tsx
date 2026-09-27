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
  const [picking, setPicking] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const isUploading = stage === "uploading" || stage === "sending";
  const desktop = isDesktop();

  const clearMessages = useCallback(() => {
    setSelectionError(null);
    setUploadFailure(null);
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

    clearMessages();
    setStage("sending");

    try {
      const formData = new FormData();

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

    if (inputRef.current) inputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
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
                Submit Study
              </h1>

              <p className="text-sm text-muted-foreground">
                Upload DICOM data for processing
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
                Upload DICOM Study
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
                    : "Submit Study"}
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