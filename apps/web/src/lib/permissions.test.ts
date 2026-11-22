import { describe, expect, it } from "vitest";
import { navigationForRole, roleHasAccess } from "./permissions";

describe("hospital history access", () => {
  it("shows Create New Study and permits hospital routes", () => {
    expect(
      navigationForRole("HOSPITAL").some(
        (item) =>
          item.href === "/hospitals/submit" &&
          item.label === "Create New Study",
      ),
    ).toBe(true);
    expect(roleHasAccess("HOSPITAL", "/hospitals/submit")).toBe(true);
    expect(roleHasAccess("HOSPITAL", "/hospitals/new")).toBe(true);
  });
});
