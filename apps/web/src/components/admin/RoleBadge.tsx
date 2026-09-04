import type { UserRole } from "@axis/types";
import { clsx } from "clsx";

const ROLE_STYLES: Record<UserRole, string> = {
  ADMIN: "bg-error/10 text-error",
  MANAGER: "bg-warning/10 text-warning",
  RADIOLOGIST: "bg-accent/10 text-accent",
  HOSPITAL: "bg-success/10 text-success",
};

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  RADIOLOGIST: "Radiologist",
  HOSPITAL: "Hospital",
};

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
        ROLE_STYLES[role],
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
