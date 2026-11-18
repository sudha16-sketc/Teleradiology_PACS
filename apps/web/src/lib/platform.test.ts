import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiBaseUrl,
  apiUrl,
  isDesktop,
  isWeb,
  ohifBaseUrl,
  ohifViewerUrl,
  platformKind,
  resetPlatformCacheForTests,
  SAME_ORIGIN_API_PREFIX,
  SAME_ORIGIN_OHIF_PREFIX,
} from "./platform";

/**
 * These tests pin down the contract the desktop client depends on: the API and
 * the viewer stay on the origin that served the page, because the httpOnly
 * `axis_session` cookie is `sameSite=lax` with no CSRF token. A regression that
 * silently produces a cross-origin base would not fail a type check or a build
 * — it would only break login on installed machines.
 */

const TAURI_GLOBAL = "__TAURI_INTERNALS__";

function setTauriHost(present: boolean): void {
  const host = globalThis as Record<string, unknown>;
  if (present) {
    host[TAURI_GLOBAL] = { invoke: () => undefined };
  } else {
    delete host[TAURI_GLOBAL];
  }
}

const originalEnv = { ...process.env };

/**
 * Next.js declares `NODE_ENV` read-only, but it is writable at runtime and the
 * platform layer reads it on every call. Restored by the beforeEach snapshot.
 */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  resetPlatformCacheForTests();
  setTauriHost(false);
  process.env = { ...originalEnv };
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_DESKTOP_API_URL;
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetPlatformCacheForTests();
  vi.restoreAllMocks();
});

describe("platform detection", () => {
  it("reports web in a normal browser tab", () => {
    expect(platformKind()).toBe("web");
    expect(isWeb()).toBe(true);
    expect(isDesktop()).toBe(false);
  });

  it("reports desktop when the Tauri host is present", () => {
    setTauriHost(true);
    expect(platformKind()).toBe("desktop");
    expect(isDesktop()).toBe(true);
    expect(isWeb()).toBe(false);
  });

  it("memoizes the result for the lifetime of the window", () => {
    expect(platformKind()).toBe("web");
    setTauriHost(true);
    // Tauri injects its host before any page script runs, so detection must not
    // flip mid-session; a later lookup returns the first answer.
    expect(platformKind()).toBe("web");
  });
});

describe("apiBaseUrl", () => {
  it("defaults to the same-origin proxy prefix", () => {
    expect(apiBaseUrl()).toBe(SAME_ORIGIN_API_PREFIX);
    expect(apiBaseUrl()).toBe("/api");
  });

  it("stays same-origin inside the desktop shell", () => {
    setTauriHost(true);
    expect(apiBaseUrl()).toBe("/api");
  });

  it("keeps an explicit root-relative prefix and trims trailing slashes", () => {
    process.env.NEXT_PUBLIC_DESKTOP_API_URL = "/backend/";
    expect(apiBaseUrl()).toBe("/backend");
  });

  it("ignores a malformed value and falls back to the proxy", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.NEXT_PUBLIC_DESKTOP_API_URL = "api.axis.local";
    expect(apiBaseUrl()).toBe(SAME_ORIGIN_API_PREFIX);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("refuses a loopback API in a production build", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_DESKTOP_API_URL = "http://127.0.0.1:4000/api";
    expect(apiBaseUrl()).toBe(SAME_ORIGIN_API_PREFIX);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("allows a loopback API in development, where the API really is local", () => {
    // The cross-site cookie warning is expected here too, so silence it.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setNodeEnv("development");
    process.env.NEXT_PUBLIC_DESKTOP_API_URL = "http://localhost:4000/api";
    expect(apiBaseUrl()).toBe("http://localhost:4000/api");
  });

  it("warns about the cookie break when pointed cross-origin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.NEXT_PUBLIC_DESKTOP_API_URL = "https://api.example.org/api/";
    expect(apiBaseUrl()).toBe("https://api.example.org/api");
    expect(warn.mock.calls[0]?.[0]).toContain("sameSite=none");
  });

  it("treats empty and whitespace values as unset", () => {
    process.env.NEXT_PUBLIC_DESKTOP_API_URL = "   ";
    expect(apiBaseUrl()).toBe(SAME_ORIGIN_API_PREFIX);
  });
});

describe("apiUrl", () => {
  it("joins paths with and without a leading slash", () => {
    expect(apiUrl("/studies")).toBe("/api/studies");
    expect(apiUrl("studies")).toBe("/api/studies");
  });

  it("uses the configured base when one is set", () => {
    process.env.NEXT_PUBLIC_DESKTOP_API_URL = "/backend";
    expect(apiUrl("/studies/1.2.3")).toBe("/backend/studies/1.2.3");
  });
});

describe("ohif urls", () => {
  it("stays same-origin by default so the session cookie is attached", () => {
    expect(ohifBaseUrl()).toBe(SAME_ORIGIN_OHIF_PREFIX);
    expect(ohifBaseUrl()).toBe("/ohif");
  });

  it("is unaffected by a cross-origin API override", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.NEXT_PUBLIC_DESKTOP_API_URL = "https://api.example.org/api";
    expect(ohifBaseUrl()).toBe("/ohif");
  });

  it("builds a viewer url with an encoded study uid", () => {
    expect(ohifViewerUrl("1.2.840.10008.5.1.4.1.1.2")).toBe(
      "/ohif/viewer?StudyInstanceUIDs=1.2.840.10008.5.1.4.1.1.2",
    );
  });

  it("encodes uid characters that would otherwise break the query string", () => {
    expect(ohifViewerUrl("1.2.3&x=1")).toBe(
      "/ohif/viewer?StudyInstanceUIDs=1.2.3%26x%3D1",
    );
  });

  it("ignores a published app origin so the session cookie stays first-party", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://pacs.example.org/";
    expect(ohifBaseUrl()).toBe("/ohif");
  });
});
