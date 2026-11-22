import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api-client";
import { downloadMisReport } from "./mis-export";

vi.mock("@/lib/api-client", () => ({
  apiClient: { getBlob: vi.fn() },
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe("downloadMisReport", () => {
  const createObjectURL = vi.fn(() => "blob:mis-report");
  const revokeObjectURL = vi.fn();
  let clickedAnchor: HTMLAnchorElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clickedAnchor = undefined;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      clickedAnchor =
        document.body.querySelector<HTMLAnchorElement>("a") ?? undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("requests and downloads the authorized MIS workbook", async () => {
    const blob = new Blob(["xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(apiClient.getBlob).mockResolvedValue(blob);

    await downloadMisReport();

    expect(apiClient.getBlob).toHaveBeenCalledWith("/analytics/mis-report", {
      timeoutMs: 300_000,
    });
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickedAnchor?.download).toBe("MIS-Report.xlsx");
    expect(clickedAnchor?.href).toBe("blob:mis-report");
    expect(document.body.querySelector("a")).toBeNull();

    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mis-report");
  });
});
