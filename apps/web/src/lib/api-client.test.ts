import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api-client";

describe("apiClient.getBlob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns binary response bodies without JSON parsing", async () => {
    const blob = new Blob(["xlsx-data"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      {
        ok: true,
        status: 200,
        headers: new Headers({
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        blob: async () => blob,
      } as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiClient.getBlob("/analytics/mis-report");

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe(blob.type);
    expect(await result.text()).toBe("xlsx-data");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/analytics/mis-report"),
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
