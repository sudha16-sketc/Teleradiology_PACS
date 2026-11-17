import { afterEach, describe, expect, it, vi } from "vitest";

const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => updater);

import {
  assertSecureUpdateConfig,
  checkForUpdates,
  currentUpdateState,
  installAvailableUpdate,
  resetUpdateStateForTests,
  subscribeToUpdates,
} from "./update";

afterEach(() => {
  resetUpdateStateForTests();
  updater.check.mockReset();
});

describe("desktop updater foundation", () => {
  it("requires a signing key and HTTPS endpoints", () => {
    expect(assertSecureUpdateConfig(["https://updates.example/manifest"], " "))
      .toContain("signing key");
    expect(assertSecureUpdateConfig(["http://updates.example/manifest"], "public-key"))
      .toContain("HTTPS");
    expect(assertSecureUpdateConfig(["https://updates.example/manifest"], "public-key"))
      .toBeNull();
  });

  it("reports unconfigured builds as unavailable and current builds as up to date", async () => {
    updater.check.mockRejectedValueOnce(new Error("updater not configured"));
    await checkForUpdates();
    expect(currentUpdateState().status).toBe("unavailable");

    updater.check.mockResolvedValueOnce(null);
    await checkForUpdates();
    expect(currentUpdateState().status).toBe("upToDate");
  });

  it("reports cumulative download progress before installation", async () => {
    const observed: ReturnType<typeof currentUpdateState>[] = [];
    const download = vi.fn(async (onEvent?: (event: unknown) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 60 } });
    });
    updater.check.mockResolvedValue({ version: "0.2.0", download, install: vi.fn() });

    const stop = subscribeToUpdates((state) => {
      observed.push(state);
    });

    await checkForUpdates();
    await installAvailableUpdate();
    stop();

    expect(observed.filter((state) => state.status === "downloading").map((state) => state.progress))
      .toContain(40);
    expect(observed.filter((state) => state.status === "downloading").map((state) => state.progress))
      .toContain(100);
  });

  it("surfaces update failures without exposing the underlying error", async () => {
    updater.check.mockResolvedValue({
      version: "0.2.0",
      download: vi.fn().mockRejectedValue(new Error("Patient Jane Doe update failure")),
      install: vi.fn(),
    });
    await checkForUpdates();
    await installAvailableUpdate();

    expect(currentUpdateState()).toMatchObject({
      status: "error",
      reason: "The update could not be installed.",
    });
  });
});