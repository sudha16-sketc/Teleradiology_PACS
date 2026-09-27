import { afterEach, describe, expect, it, vi } from "vitest";

const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => updater);

import {
  assertSecureUpdateConfig,
  checkForUpdates,
  currentUpdateState,
  installAvailableUpdate,
  resetUpdateStateForTests,
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