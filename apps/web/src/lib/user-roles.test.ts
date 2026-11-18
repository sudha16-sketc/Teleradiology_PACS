import { describe, expect, it } from "vitest";
import { USER_MANAGEMENT_ASSIGNABLE_ROLES } from "./user-roles";

describe("User Management role choices", () => {
  it("only exposes non-administrator roles for assignment", () => {
    expect(USER_MANAGEMENT_ASSIGNABLE_ROLES).toEqual([
      "MANAGER",
      "RADIOLOGIST",
      "HOSPITAL",
    ]);
    expect(USER_MANAGEMENT_ASSIGNABLE_ROLES).not.toContain("ADMIN");
  });
});
