import type { UserRole } from "@axis/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrator",
  COORDINATOR: "Coordinator",
  RADIOLOGIST: "Radiologist",
  TECHNICIAN: "Technician",
  HOSPITAL_USER: "Hospital User",
};

interface RouteRule {
  prefix: string;
  roles: UserRole[];
}

export const ROUTE_RULES: RouteRule[] = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/settings", roles: ["ADMIN"] },
  { prefix: "/audit", roles: ["ADMIN"] },
  { prefix: "/analytics", roles: ["ADMIN", "COORDINATOR"] },
  { prefix: "/hospitals", roles: ["ADMIN", "COORDINATOR", "TECHNICIAN", "HOSPITAL_USER"] },
  { prefix: "/reports", roles: ["ADMIN", "COORDINATOR", "RADIOLOGIST", "HOSPITAL_USER"] },
  { prefix: "/reading", roles: ["ADMIN", "COORDINATOR", "RADIOLOGIST"] },
  { prefix: "/queue", roles: ["ADMIN", "COORDINATOR", "RADIOLOGIST", "TECHNICIAN"] },
  { prefix: "/worklist", roles: ["ADMIN", "COORDINATOR", "RADIOLOGIST", "TECHNICIAN"] },
];

export interface NavDefinition {
  href: string;
  label: string;
  admin?: boolean;
}

export const NAV_DEFS: NavDefinition[] = [
  { href: "/worklist", label: "Worklist" },
  { href: "/queue", label: "My Queue" },
  { href: "/reading", label: "Reading" },
  { href: "/reports", label: "Reports" },
  { href: "/hospitals", label: "Hospitals" },
  { href: "/analytics", label: "Analytics" },
  { href: "/audit", label: "Audit", admin: true },
  { href: "/settings", label: "Settings", admin: true },
  { href: "/admin/registration-requests", label: "Registration Requests", admin: true },
];

const ADMIN_ONLY_DEFS = new Set(
  NAV_DEFS.filter((d) => d.admin).map((d) => d.href),
);

export function roleHasAccess(role: UserRole, pathname: string): boolean {
  if (role === "ADMIN") return true;

  let rule: RouteRule | undefined;
  for (const candidate of ROUTE_RULES) {
    if (
      pathname === candidate.prefix ||
      pathname.startsWith(`${candidate.prefix}/`)
    ) {
      rule = candidate;
      break;
    }
  }
  if (!rule) return true;
  return rule.roles.includes(role);
}

export function navigationForRole(role: UserRole): NavDefinition[] {
  return NAV_DEFS.filter((def) =>
    role === "ADMIN" ? true : !ADMIN_ONLY_DEFS.has(def.href),
  );
}