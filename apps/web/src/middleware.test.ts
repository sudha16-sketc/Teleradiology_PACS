import { describe, expect, it } from "vitest";
import {
  isProtectedPath,
  isPublicPath,
  isViewerPath,
  viewerDocumentNeedsLogin,
} from "./middleware";

describe("web middleware public paths", () => {
  it("allows signed-out users to reach password recovery pages", () => {
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
  });

  it("keeps dashboard routes protected", () => {
    expect(isPublicPath("/reading")).toBe(false);
    expect(isPublicPath("/settings/users")).toBe(false);
  });

  it("only treats known workspace prefixes as protected", () => {
    expect(isProtectedPath("/reports")).toBe(true);
    expect(isProtectedPath("/settings/hospitals")).toBe(true);
    expect(isProtectedPath("/does-not-exist")).toBe(false);
  });

  it("identifies viewer routes that must never redirect into /login", () => {
    expect(isViewerPath("/ohif")).toBe(true);
    expect(isViewerPath("/ohif/viewer")).toBe(true);
    expect(isViewerPath("/ohif/app.bundle.js")).toBe(true);
    expect(isViewerPath("/reading/1.2.3")).toBe(false);
  });

  it("only redirects a cookie-less top-level viewer document", () => {
    expect(viewerDocumentNeedsLogin("document", false)).toBe(true);
    expect(viewerDocumentNeedsLogin("iframe", false)).toBe(false);
    expect(viewerDocumentNeedsLogin("script", false)).toBe(false);
    expect(viewerDocumentNeedsLogin("document", true)).toBe(false);
  });
});
