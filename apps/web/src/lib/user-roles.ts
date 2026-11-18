import type { UserRole } from "@axis/types";

export const USER_MANAGEMENT_ASSIGNABLE_ROLES = [
  "MANAGER",
  "RADIOLOGIST",
  "HOSPITAL",
] as const satisfies readonly UserRole[];
