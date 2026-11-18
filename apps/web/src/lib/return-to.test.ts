import { describe, expect, it } from "vitest";
import { loginUrl, safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it("keeps root-relative application paths", () => {
    expect(safeReturnTo("/reading/1.2.3?view=axial")).toBe(
      "/reading/1.2.3?view=axial",
    );
  });

  it("rejects open redirects and login loops", () => {
    expect(safeReturnTo("https://evil.example/")).toBe("/worklist");
    expect(safeReturnTo("//evil.example/")).toBe("/worklist");
    expect(safeReturnTo("/\\evil.example/")).toBe("/worklist");
    expect(safeReturnTo("/login")).toBe("/worklist");
    expect(safeReturnTo(null)).toBe("/worklist");
  });

  it("encodes the destination in the login URL", () => {
    expect(loginUrl("/reading/1.2.3?view=axial")).toBe(
      "/login?returnTo=%2Freading%2F1.2.3%3Fview%3Daxial",
    );
  });
});
