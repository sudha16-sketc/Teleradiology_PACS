/**
 * Desktop auto-update: state machine and the rules around it.
 *
 * # What is and is not configured
 *
 * The committed `tauri.conf.json` keeps `plugins.updater.active = false` with no
 * endpoint and no key, so a build nobody has explicitly opted in **cannot reach
 * an update server at all**. A release pipeline layers
 * `tauri.updater.conf.json` on top with a real endpoint and the minisign
 * *public* key; the private key never enters this repository or a build
 * machine.
 *
 * That means "not configured" is a normal, expected state, and it is modelled
 * here as `unavailable` — not as an error and not as a fault the user should
 * see a red banner about. Axis must never nag a radiologist about a check it
 * was never given the means to perform.
 *
 * # Security
 *
 * Tauri verifies the update manifest's minisign signature against the configured
 * public key before it will download anything, which is what makes an HTTPS
 * endpoint sufficient. An attacker who can serve a malicious manifest still
 * cannot produce a signature, so the update path is only as trustworthy as the
 * key. `assertSecureUpdateConfig` refuses an `http://` endpoint outright rather
 * than relying on the signature alone.
 *
 * The frontend never prompts on its own and never restarts the app: it reports
 * state, and the user chooses. A client that silently reinstalls itself
 * mid-read is unacceptable in a clinical setting.
 */

export type UpdateStatus =
  /** No check has run yet. */
  | "idle"
  /** A check is in flight. */
  | "checking"
  /** Running the newest published version. */
  | "upToDate"
  /** A newer signed version exists. */
  | "available"
  /** Downloading, with 0-100 progress. */
  | "downloading"
  /** Downloaded and verified; waiting for the user to install. */
  | "readyToInstall"
  /** Install applied; the app should be restarted by the user. */
  | "installed"
  /** This build was not configured to check. Not a fault. */
  | "unavailable"
  /** A check was configured and failed. Worth reporting. */
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  /** Version on the server, when one is available. */
  version?: string;
  /** Release note body from the manifest, if the server published one. */
  notes?: string;
  /** 0-100 while downloading. */
  progress?: number;
  /** Present only for `error`. Safe to display. */
  reason?: string;
}

const IDLE: UpdateState = { status: "idle" };

let state: UpdateState = IDLE;
const listeners = new Set<(next: UpdateState) => void>();

function setState(next: UpdateState): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // A misbehaving subscriber must not break the updater.
    }
  }
}

export function currentUpdateState(): UpdateState {
  return state;
}

export function subscribeToUpdates(
  listener: (next: UpdateState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetUpdateStateForTests(): void {
  state = IDLE;
  listeners.clear();
}

/**
 * Refuse an insecure update configuration.
 *
 * Returns an error message, or `null` when the configuration is acceptable.
 * Exported so the rule is unit-testable without a Tauri runtime.
 */
export function assertSecureUpdateConfig(
  endpoints: readonly string[],
  pubkey: string,
): string | null {
  if (!pubkey.trim()) {
    return "no update signing key is configured";
  }
  for (const endpoint of endpoints) {
    if (/^http:\/\//i.test(endpoint)) {
      return "the update endpoint is not HTTPS";
    }
  }
  return null;
}

/** Tauri throws a plain string for a disabled/unconfigured updater. */
function isUnconfigured(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    text.includes("not configured") ||
    text.includes("not enabled") ||
    text.includes("no endpoints") ||
    text.includes("missing pubkey") ||
    text.includes("endpoint") && text.includes("null")
  );
}

interface UpdaterUpdate {
  version: string;
  body?: string;
  download(onEvent?: (event: unknown) => void): Promise<void>;
  install(): Promise<void>;
}

/**
 * Check for an update.
 *
 * Never throws. Any failure is folded into `unavailable` or `error` so a
 * background check can never surface as an unhandled rejection in a clinical
 * session.
 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (state.status === "checking" || state.status === "downloading") {
    return state;
  }
  setState({ status: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      setState({ status: "upToDate" });
      return state;
    }
    setState({
      status: "available",
      version: (update as UpdaterUpdate).version,
      ...(update.body ? { notes: update.body } : {}),
    });
  } catch (error) {
    setState(
      isUnconfigured(error)
        ? { status: "unavailable" }
        : {
            status: "error",
            reason: "The update check could not be completed.",
          },
    );
  }
  return state;
}

/**
 * Download and install an available update.
 *
 * Separated from the check so the user decides. The app is not restarted here:
 * on Windows the install is applied by the installer, and the user restarts
 * when it suits them.
 */
export async function installAvailableUpdate(): Promise<UpdateState> {
  if (state.status !== "available" && state.status !== "readyToInstall") {
    return state;
  }
  setState({ status: "downloading", progress: 0, version: state.version });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    // The update handle is not serialisable, so it is re-fetched rather than
    // cached across renders.
    const update = (await check()) as UpdaterUpdate | null;
    if (!update) {
      setState({ status: "upToDate" });
      return state;
    }
    await update.download((event) => {
      const progress = (event as { data?: { contentLength?: number; chunkLength?: number } })
        .data;
      if (!progress?.contentLength) return;
      const percent = Math.min(
        100,
        Math.round(((progress.chunkLength ?? 0) / progress.contentLength) * 100),
      );
      setState({ status: "downloading", progress: percent, version: update.version });
    });
    setState({ status: "readyToInstall", version: update.version });
    await update.install();
    setState({ status: "installed", version: update.version });
  } catch (error) {
    setState({
      status: "error",
      reason:
        (error instanceof Error && error.message
          ? "The update could not be installed."
          : "The update could not be installed."),
    });
  }
  return state;
}
