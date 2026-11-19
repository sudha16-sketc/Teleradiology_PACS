import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("API rewrite destination", () => {
  it.each([
    "https://teleradiology-pacs.onrender.com",
    "https://teleradiology-pacs.onrender.com/api",
    "https://teleradiology-pacs.onrender.com/api/",
  ])("normalizes %s to a single /api prefix", async (apiUrl) => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", apiUrl);
    vi.stubEnv("OHIF_URL", "https://teleradiology-pacs-1.onrender.com");

    const { default: config } = await import("../../next.config.mjs");
    const rewrites = await config.rewrites?.();
    const rewriteList = Array.isArray(rewrites)
      ? rewrites
      : (rewrites?.beforeFiles ?? []);
    const apiRewrite = rewriteList.find(
      (rewrite: { source: string }) => rewrite.source === "/api/:path*",
    );

    expect(apiRewrite?.destination).toBe(
      "https://teleradiology-pacs.onrender.com/api/:path*",
    );
  });

  it("rewrites bare /ohif and all viewer assets to the OHIF service", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://teleradiology-pacs.onrender.com");
    vi.stubEnv("OHIF_URL", "https://teleradiology-pacs-1.onrender.com");

    const { default: config } = await import("../../next.config.mjs");
    const rewrites = await config.rewrites?.();
    const rewriteList = Array.isArray(rewrites)
      ? rewrites
      : (rewrites?.beforeFiles ?? []);

    expect(
      rewriteList.find(
        (rewrite: { source: string }) => rewrite.source === "/ohif",
      )?.destination,
    ).toBe("https://teleradiology-pacs-1.onrender.com/ohif/index.html");
    expect(
      rewriteList.find(
        (rewrite: { source: string }) => rewrite.source === "/ohif/:path*",
      )?.destination,
    ).toBe("https://teleradiology-pacs-1.onrender.com/ohif/:path*");
  });

  it("rejects API URLs with an unexpected path prefix", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://teleradiology-pacs.onrender.com/v1");
    vi.stubEnv("OHIF_URL", "https://teleradiology-pacs-1.onrender.com");

    const { default: config } = await import("../../next.config.mjs");

    await expect(config.rewrites?.()).rejects.toThrow(
      "NEXT_PUBLIC_API_URL must be an API origin or end in /api.",
    );
  });
});
