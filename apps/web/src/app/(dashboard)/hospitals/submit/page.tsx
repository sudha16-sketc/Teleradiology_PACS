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
} from "lucide-react";
import { apiClient } from "@/lib/api-client";

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

/**
 * Accepted file extensions.
 *
 * Note:
 * Production DICOM validation should happen on the backend as well,
 * because some DICOM files do not have a .dcm extension.
 */
const ACCEPT_EXT = /\.(zip|dcm|dicom)$/i;

export default function SubmitStudyPage() {
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [result, setResult] =
    useState<IngestEnvelope["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const isUploading =
    stage === "uploading" || stage === "sending";

  /**
   * Accept files from picker / drag-and-drop.
   */
  const acceptFiles = useCallback((incoming: File[]) => {
    if (!incoming.length) {
      return;
    }

    setError(null);
    setResult(null);
    setStage("idle");

    const accepted = incoming.filter((file) =>
      ACCEPT_EXT.test(file.name)
    );

    if (!accepted.length) {
      setFiles([]);
      setError(
        "No DICOM files found. Select .dcm/.dicom files or a .zip archive."
      );
      return;
    }

    const seen = new Set<string>();
    const deduped: File[] = [];

    for (const file of accepted) {
      const key = `${file.name}:${file.size}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      // 200 MB per file
      if (file.size > 200 * 1024 * 1024) {
        setFiles([]);
        setError(
          `File "${file.name}" exceeds the 200 MB limit.`
        );
        return;
      }

      deduped.push(file);
    }

    setFiles(deduped);
  }, []);

  /**
   * Recursively collect files from a dragged folder.
   *
   * Chrome / Edge expose directory entries through
   * webkitGetAsEntry().
   */
  const collectDroppedFiles = useCallback(
    async (
      items: DataTransferItemList
    ): Promise<File[]> => {
      const files: File[] = [];

      const readEntry = async (
        entry: FileSystemEntry
      ): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;

          await new Promise<void>((resolve) => {
            fileEntry.file(
              (file) => {
                files.push(file);
                resolve();
              },
              () => {
                resolve();
              }
            );
          });

          return;
        }

        if (entry.isDirectory) {
          const directoryEntry =
            entry as FileSystemDirectoryEntry;

          const reader = directoryEntry.createReader();

          await new Promise<void>((resolve) => {
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
                () => {
                  resolve();
                }
              );
            };

            readEntries();
          });
        }
      };

      const promises: Promise<void>[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.kind !== "file") {
          continue;
        }

        const entry = item.webkitGetAsEntry?.();

        if (entry) {
          promises.push(readEntry(entry));
        } else {
          const file = item.getAsFile();

          if (file) {
            files.push(file);
          }
        }
      }

      await Promise.all(promises);

      return files;
    },
    []
  );

  /**
   * Upload the selected DICOM files.
   */
  const handleUpload = async () => {
    if (!files.length || isUploading) {
      return;
    }

    setStage("sending");
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();

      for (const file of files) {
        formData.append("file", file, file.name);
      }

      const response =
        await apiClient.post<IngestEnvelope>(
          "/dicom/ingest",
          formData
        );

      setResult(response.data);
      setStage("ready");
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : "Upload failed. Please check the files and try again.";

      setError(message);
      setStage("error");
    }
  };

  /**
   * Clear everything and start again.
   */
  const reset = () => {
    setFiles([]);
    setDragActive(false);
    setStage("idle");
    setResult(null);
    setError(null);

    if (inputRef.current) {
      inputRef.current.value = "";
    }

    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  };

  /**
   * Normal file picker.
   */
  const handleFilePicker = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(
      event.target.files ?? []
    );

    acceptFiles(selectedFiles);
  };

  /**
   * Folder picker.
   *
   * Chrome / Edge support webkitdirectory.
   */
  const handleFolderPicker = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(
      event.target.files ?? []
    );

    acceptFiles(selectedFiles);
  };

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

            {/* Hidden normal file input */}
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".dcm,.dicom,.zip,application/zip"
              onChange={handleFilePicker}
              className="hidden"
            />

            {/* Hidden folder input */}
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is supported by Chromium browsers
              webkitdirectory=""
              directory=""
              onChange={handleFolderPicker}
              className="hidden"
            />

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
                  acceptFiles(droppedFiles);
                });
              }}
              onClick={() => {
                if (!isUploading) {
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
                className="mt-6"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => {
                    folderInputRef.current?.click();
                  }}
                  className="
                    inline-flex
                    items-center
                    gap-2
                    rounded-md
                    border
                    border-border
                    bg-surface
                    px-4
                    py-2
                    text-sm
                    font-medium
                    transition
                    hover:bg-muted
                    disabled:cursor-not-allowed
                    disabled:opacity-50
                  "
                >
                  <FileArchive className="h-4 w-4" />
                  Choose DICOM Folder
                </button>
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

            {/* Error */}
            {error && (
              <div className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />

                <div>
                  <p className="text-sm font-medium">
                    Upload Error
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {error}
                  </p>
                </div>
              </div>
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
                <div className="rounded-full bg-green-500/10 p-2">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
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
              <div className="mx-6 mb-6 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-4">
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