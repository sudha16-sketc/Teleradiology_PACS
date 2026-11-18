import { describe, expect, it } from "vitest";
import { isPublicPath } from "./middleware";

describe("web middleware public paths", () => {
  it("allows signed-out users to reach password recovery pages", () => {
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
  });

  it("keeps dashboard routes protected", () => {
    expect(isPublicPath("/reading")).toBe(false);
    expect(isPublicPath("/settings/users")).toBe(false);
  });
});
