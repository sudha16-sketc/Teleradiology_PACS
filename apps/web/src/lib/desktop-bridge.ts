/**
 * The one place the UI is allowed to reach a native API.
 *
 * # Why the indirection
 *
 * Two reasons, and the second is the important one.
 *
 * 1. The web client and the desktop client share this codebase. Every native
 *    call has to degrade to a browser no-op, or the web build breaks.
 * 2. A native call can fail in ways a React tree must survive: the capability
 *    may not be granted, the plugin may be absent, the user may dismiss a
 *    dialog, the OS may refuse a notification. None of those are exceptional
 *    enough to justify an error boundary, so every function here returns a
 *    result object instead of throwing.
 *
 * # Loading the plugins
 *
 * The `@tauri-apps/*` modules are imported dynamically and only after
 * `isDesktop()` is true. In a browser tab `window.__TAURI_INTERNALS__` is
 * absent, the modules are never evaluated, and the bundler keeps them in a
 * separate chunk. This matters for correctness as well as size: a browser must
 * not be able to satisfy a native call by polyfilling the internal bridge.
 */

import { isDesktop } from "@/lib/platform";
import { setRuntimeInfo, newReferenceId } from "@/lib/error-report";
import { notifyWorkflowEvent } from "@/lib/notification-events";
import { checkForUpdates, currentUpdateState, subscribeToUpdates, type UpdateState } from "@/lib/update";

/** Result of a native call that can fail without the caller caring. */
export type NativeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ok = <T,>(value: T): NativeResult<T> => ({ ok: true, value });
const fail = <T,>(reason: string): NativeResult<T> => ({ ok: false, reason });

/** True when a native call can actually be attempted. */
export function nativeAvailable(): boolean {
  return isDesktop();
}

/** Turn any thrown value into a short, safe reason string. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 200) || "unknown error";
}

// ---------------------------------------------------------------------------
// 1. File selection
// ---------------------------------------------------------------------------

export interface PickedFile {
  name: string;
  path: string;
  size: number;
}

export interface PickedFolder {
  name: string;
  path: string;
}

/**
 * Open the native file picker and return the files the user chose.
 *
 * `null` means the user cancelled, which is not an error: the caller should
 * leave the form exactly as it was.
 *
 * The Rust side opens the dialog itself. That is deliberate — a JavaScript
 * caller that could name its own paths could widen the shell's filesystem scope
 * to files the user never picked.
 */
export async function pickDicomFiles(): Promise<NativeResult<PickedFile[] | null>> {
  if (!isDesktop()) return fail("not available in a browser");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return ok(await invoke<PickedFile[] | null>("pick_dicom_files"));
  } catch (error) {
    return fail(reasonOf(error));
  }
}

/**
 * Read the bytes of a file the user picked.
 *
 * Only succeeds for a path the native picker returned: the shell adds that path
 * to its read scope at selection time and grants no blanket filesystem access.
 */
export async function readPickedFile(
  path: string,
): Promise<NativeResult<Uint8Array<ArrayBuffer>>> {
  if (!isDesktop()) return fail("not available in a browser");
  try {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return ok(await readFile(path));
  } catch (error) {
    return fail(reasonOf(error));
  }
}

/** Open the native folder picker. `null` means the user cancelled. */
export async function pickDicomFolder(): Promise<NativeResult<PickedFolder | null>> {
  if (!isDesktop()) return fail("not available in a browser");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return ok(await invoke<PickedFolder | null>("pick_dicom_folder"));
  } catch (error) {
    return fail(reasonOf(error));
  }
}

/**
 * Enumerate a folder the user picked, recursively.
 *
 * The walk runs in Rust rather than here, so path joining, the symlink decision
 * and the read grants all stay on the same side of the boundary as the dialog
 * that authorised them. It follows no symlinks, descends at most twelve levels
 * and visits at most 200,000 entries.
 */
export async function collectDicomFolder(
  path: string,
): Promise<NativeResult<PickedFile[]>> {
  if (!isDesktop()) return fail("not available in a browser");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return ok(await invoke<PickedFile[]>("collect_dicom_folder", { path }));
  } catch (error) {
    return fail(reasonOf(error));
  }
}

/**
 * Give up filesystem access to a selection once its upload is done.
 *
 * Without this the shell would keep read access to every file the user has ever
 * picked for the lifetime of the process.
 */
export async function releasePickedPaths(paths: string[]): Promise<NativeResult<void>> {
  if (!isDesktop() || paths.length === 0) return ok(undefined);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("release_picked_paths", { paths });
    return ok(undefined);
  } catch {
    // Narrowing only: a failure here leaves the grant in place, which is the
    // behaviour that already existed. Never worth blocking an upload result.
    return ok(undefined);
  }
}

/** Read a picked file and wrap it as a `File` ready for multipart upload. */
export async function readPickedFileAsFile(
  picked: PickedFile,
): Promise<NativeResult<File>> {
  const bytes = await readPickedFile(picked.path);
  if (!bytes.ok) return bytes;
  try {
    return ok(new File([bytes.value], picked.name));
  } catch (error) {
    return fail(reasonOf(error));
  }
}

// ---------------------------------------------------------------------------
// 2. Printing
// ---------------------------------------------------------------------------

/**
 * Print the current view.
 *
 * Tauri exposes no `print()` binding in its JavaScript API, so this calls
 * `window.print()`, which WebView2 implements by handing the webview to the
 * Windows print pipeline. The same call is correct in a browser tab, so the
 * web client needs no branch here.
 *
 * The view being printed is a print-stylesheet page built from data the user is
 * already authorized to see; nothing is rendered into a temporary file.
 */
export async function printCurrentView(): Promise<NativeResult<void>> {
  try {
    if (typeof window === "undefined" || typeof window.print !== "function") {
      return fail("printing is not available here");
    }
    window.print();
    return ok(undefined);
  } catch (error) {
    return fail(reasonOf(error));
  }
}

// ---------------------------------------------------------------------------
// 3. Notifications
// ---------------------------------------------------------------------------

/**
 * Show a native Windows toast for a workflow event.
 *
 * The text comes from `notification-events.ts`, which maps a server event type
 * to fixed, PHI-free copy. The server's own `message` is never used: it may
 * embed a patient name, and a toast is readable by anyone at the workstation.
 */
export async function showNativeNotification(
  type: string,
): Promise<NativeResult<void>> {
  if (!isDesktop()) return fail("not available in a browser");
  const copy = notifyWorkflowEvent(type);
  if (!copy) return fail("no notification is defined for that event");
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    if (!(await notification.isPermissionGranted())) {
      return fail("notifications are not permitted");
    }
    notification.sendNotification({ title: copy.title, body: copy.body });
    return ok(undefined);
  } catch (error) {
    return fail(reasonOf(error));
  }
}

/** Request OS permission only from an explicit user action. */
export async function requestNativeNotificationPermission(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    if (await notification.isPermissionGranted()) return true;
    return (await notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Whether the OS has already granted permission to show toasts. */
export async function notificationsPermitted(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    return await notification.isPermissionGranted();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. Window management
// ---------------------------------------------------------------------------

type WindowHandle = {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  setFocus(): Promise<void>;
  startDragging(): Promise<void>;
  close(): Promise<void>;
  setTitle(title: string): Promise<void>;
};

async function currentWindow(): Promise<NativeResult<WindowHandle>> {
  if (!isDesktop()) return fail("not available in a browser");
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return ok(
      getCurrentWindow() as unknown as WindowHandle,
    );
  } catch (error) {
    return fail(reasonOf(error));
  }
}

async function windowOp(
  action: (win: WindowHandle) => Promise<void>,
): Promise<NativeResult<void>> {
  const win = await currentWindow();
  if (!win.ok) return win;
  try {
    await action(win.value);
    return ok(undefined);
  } catch (error) {
    return fail(reasonOf(error));
  }
}

export const minimizeWindow = () => windowOp((w) => w.minimize());
export const maximizeWindow = () => windowOp((w) => w.maximize());
export const unmaximizeWindow = () => windowOp((w) => w.unmaximize());
export const toggleMaximizeWindow = () => windowOp((w) => w.toggleMaximize());
export const focusWindow = () => windowOp((w) => w.setFocus());
export const startWindowDrag = () => windowOp((w) => w.startDragging());
export const closeWindow = () => windowOp((w) => w.close());
export const setWindowTitle = (title: string) => windowOp((w) => w.setTitle(title));

export async function isWindowMaximized(): Promise<boolean> {
  const win = await currentWindow();
  if (!win.ok) return false;
  try {
    return await win.value.isMaximized();
  } catch {
    return false;
  }
}

/**
 * Open the imaging viewer in its own window.
 *
 * The only secondary window this client creates, and only on an explicit user
 * action. Rust derives its URL from the configured deployment, validates the
 * study UID, and pins navigation to the same origin before creating it.
 */
export async function openViewerWindow(
  studyInstanceUid: string,
): Promise<NativeResult<void>> {
  if (!isDesktop()) return fail("not available in a browser");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_viewer_window", { studyUid: studyInstanceUid });
    return ok(undefined);
  } catch (error) {
    return fail(reasonOf(error));
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Collect the runtime facts a crash report needs and hand them to the error
 * reporter. Safe to call in a browser, where it simply records nothing extra.
 */
export async function initRuntimeInfo(): Promise<void> {
  if (!isDesktop()) return;
  try {
    const os = await import("@tauri-apps/plugin-os");
    const { getVersion } = await import("@tauri-apps/api/app");
    const [version, platform, osVersion] = await Promise.all([
      getVersion(),
      Promise.resolve(os.platform()),
      Promise.resolve(os.version()),
    ]);
    setRuntimeInfo({
      appVersion: version,
      os: `${String(platform)} ${osVersion}`.trim(),
    });
  } catch {
    // A missing capability must not stop the app from starting; the report
    // simply records "unknown".
    setRuntimeInfo({});
  }
}

export { currentUpdateState, subscribeToUpdates, checkForUpdates };
export type { UpdateState };
export { newReferenceId };
