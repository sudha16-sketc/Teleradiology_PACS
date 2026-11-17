/**
 * Selection budgets for DICOM submission, shared by the browser and desktop paths.
 *
 * # Why this lives in the frontend at all
 *
 * The API is the authority: `/dicom/ingest` parses every instance, enforces
 * `AXIS_DICOM_MAX_FILE_BYTES` and derives ownership from the session. Nothing
 * here can admit a file the API would refuse.
 *
 * These checks exist purely to avoid *offering* a selection that is certain to
 * fail. A radiologist who picks a 3 GB file or a 20,000-file folder should be
 * told immediately, not after a slow upload that the server then rejects — and
 * in the desktop case, not after the shell has spent a minute reading a folder
 * off disk.
 *
 * The numbers mirror `apps/desktop/src-tauri/src/file_select.rs` so a file
 * accepted by the native picker is also accepted here. If you change one, change
 * both.
 */

/** Per-file cap: 1 GiB. */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

/** Combined cap for one selection: 4 GiB. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

/** Cap on how many files one selection may contribute. */
export const MAX_FILES = 5_000;

/** Accepted extensions. A whole study is often exported as one ZIP. */
export const ACCEPT_EXT = /\.(zip|dcm|dicom)$/i;

/** A file that has been accepted for upload. */
export interface SelectedFile {
  name: string;
  size: number;
  /**
   * Native path, for desktop selections. The shell holds a scoped read grant
   * for exactly this path until the upload finishes.
   */
  path?: string;
  /**
   * The `File` itself, for browser selections, which are already in memory.
   *
   * Carried rather than re-read, because a browser `File` is a handle to data
   * the user already handed us; re-reading it would copy every instance of a
   * large study into a second buffer for no benefit.
   */
  file?: File;
}

/**
 * Why a selection was refused.
 *
 * A closed union rather than a bare string so a caller cannot accidentally
 * render a message that was never reviewed for content, and so tests can assert
 * on the reason instead of on prose.
 */
export type SelectionRejection =
  | { code: "empty"; message: string }
  | { code: "too_many"; count: number; message: string }
  | { code: "file_too_large"; name: string; message: string }
  | { code: "total_too_large"; message: string };

export type SelectionResult =
  | { ok: true; files: SelectedFile[]; skipped: number }
  | ({ ok: false } & SelectionRejection);

function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Filter, de-duplicate and budget-check a candidate selection.
 *
 * Files without an accepted extension are dropped rather than refused, because
 * a user who drags a study folder will inevitably sweep up a README alongside
 * the instances. `skipped` reports how many were dropped so the UI can mention
 * it. A selection that contains *only* irrelevant files is refused outright,
 * since that almost always means the wrong folder was chosen.
 *
 * De-duplication keys on `path` when present and on `name` + `size` otherwise.
 * A study split into per-series folders repeats the same base name many times
 * over, and those are genuinely different instances — so on the desktop two
 * same-named files in different folders must both survive.
 */
export function validateSelection(
  incoming: readonly SelectedFile[],
): SelectionResult {
  const accepted: SelectedFile[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const file of incoming) {
    if (!ACCEPT_EXT.test(file.name)) {
      skipped += 1;
      continue;
    }

    const key =
      file.path !== undefined
        ? `p:${file.path}`
        : `n:${file.name}:${file.size}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);

    // Checked per file while building, so the message can name the offender and
    // the user is not made to wait for a multi-gigabyte sum first.
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        code: "file_too_large",
        name: file.name,
        message: `File "${file.name}" is ${humanBytes(file.size)}, which exceeds the ${humanBytes(MAX_FILE_BYTES)} limit.`,
      };
    }

    accepted.push(file);
  }

  if (!accepted.length) {
    return {
      ok: false,
      code: "empty",
      message:
        "No DICOM files found. Select .dcm/.dicom files or a .zip archive.",
    };
  }

  if (accepted.length > MAX_FILES) {
    return {
      ok: false,
      code: "too_many",
      count: accepted.length,
      message: `Too many files selected (${accepted.length}); the limit is ${MAX_FILES}. Select a smaller study.`,
    };
  }

  const total = accepted.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      code: "total_too_large",
      message: `The selection totals ${humanBytes(total)}, which exceeds the ${humanBytes(MAX_TOTAL_BYTES)} limit.`,
    };
  }

  return { ok: true, files: accepted, skipped };
}

/** Human-readable byte count, exported for the selection summary. */
export { humanBytes };
