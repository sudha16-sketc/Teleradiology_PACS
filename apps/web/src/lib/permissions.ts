import type { UserRole } from "@axis/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  RADIOLOGIST: "Radiologist",
  HOSPITAL: "Hospital",
};

export const ROLE_REDIRECTS: Record<UserRole, string> = {
  ADMIN: "/analytics",
  MANAGER: "/worklist",
  RADIOLOGIST: "/worklist",
  HOSPITAL: "/hospitals",
};

interface RouteRule {
  prefix: string;
  roles: UserRole[];
}

export const ROUTE_RULES: RouteRule[] = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/settings", roles: ["ADMIN"] },
  { prefix: "/audit", roles: ["ADMIN"] },
  { prefix: "/operations", roles: ["ADMIN"] },
  { prefix: "/analytics", roles: ["ADMIN", "MANAGER"] },
  { prefix: "/hospitals", roles: ["ADMIN", "MANAGER", "HOSPITAL"] },
  { prefix: "/reports", roles: ["ADMIN", "MANAGER", "RADIOLOGIST", "HOSPITAL"] },
  { prefix: "/reading", roles: ["ADMIN", "MANAGER", "RADIOLOGIST"] },
  { prefix: "/worklist", roles: ["ADMIN", "MANAGER", "RADIOLOGIST"] },
  { prefix: "/queue", roles: ["ADMIN", "MANAGER"] },
  { prefix: "/corrections", roles: ["ADMIN", "MANAGER", "RADIOLOGIST", "HOSPITAL"] },
  { prefix: "/profile", roles: ["ADMIN", "MANAGER", "RADIOLOGIST", "HOSPITAL"] },
];

export interface NavDefinition {
  href: string;
  label: string;
  admin?: boolean;
  allowedRoles?: UserRole[];
}

/**
 * Role-specific navigation. Each role only sees items that belong to its
 * workflow. Hospitals get their own study/report workflow; managers get
 * the incoming work queue and radiologist management; radiologists get
 * their assignment worklist.
 */
export const NAV_DEFS: NavDefinition[] = [
  // Manager / Admin incoming workflow
  { href: "/worklist", label: "Incoming Studies", allowedRoles: ["ADMIN", "MANAGER"] },
  // Radiologist
  { href: "/worklist", label: "My Worklist", allowedRoles: ["RADIOLOGIST"] },
  { href: "/reports", label: "My Reports", allowedRoles: ["RADIOLOGIST", "ADMIN", "MANAGER"] },
  { href: "/corrections", label: "Corrections", allowedRoles: ["ADMIN", "MANAGER", "RADIOLOGIST", "HOSPITAL"] },
  // Shared clinical view
  { href: "/reading", label: "Reading", allowedRoles: ["ADMIN", "MANAGER", "RADIOLOGIST"] },
  // Hospital
  { href: "/hospitals", label: "My Studies", allowedRoles: ["HOSPITAL"] },
  { href: "/hospitals/submit", label: "Submit Study", allowedRoles: ["HOSPITAL"] },
  { href: "/hospitals/reports", label: "Received Reports", allowedRoles: ["HOSPITAL"] },
  { href: "/hospitals/tracker", label: "Study Tracker", allowedRoles: ["HOSPITAL"] },
  // Org / admin
  { href: "/hospitals", label: "Hospitals", allowedRoles: ["ADMIN", "MANAGER"] },
  { href: "/analytics", label: "Analytics", allowedRoles: ["ADMIN", "MANAGER"] },
  { href: "/audit", label: "Audit", admin: true },
  { href: "/operations", label: "Operations", admin: true },
  { href: "/settings", label: "Settings", admin: true },
  { href: "/admin/registration-requests", label: "Registration Requests", admin: true },
  { href: "/profile", label: "Profile", allowedRoles: ["ADMIN", "MANAGER", "RADIOLOGIST", "HOSPITAL"] },
];

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

/**
 * Deduplicate nav so a role never sees duplicate labels for the same href.
 * When multiple definitions share an href, keep only the one matching the role.
 */
export function navigationForRole(role: UserRole): NavDefinition[] {
  const seen = new Set<string>();
  const items = NAV_DEFS.filter((def) => {
    if (def.admin) return role === "ADMIN";
    if (def.allowedRoles) return def.allowedRoles.includes(role);
    return true;
  });

  const deduped: NavDefinition[] = [];
  for (const def of items) {
    if (!seen.has(def.href)) {
      seen.add(def.href);
      deduped.push(def);
    }
  }
  return deduped;
}
