import type { LeadStatus, Role } from "../common/types";

export function canTransition(from: LeadStatus, to: LeadStatus) {
  const allowed: Record<LeadStatus, LeadStatus[]> = {
    NEW: ["WORKING", "ARCHIVED"],
    WORKING: ["SALES_READY", "ARCHIVED"],
    SALES_READY: ["MANAGER_REVIEW", "WORKING", "ARCHIVED"],
    MANAGER_REVIEW: ["ASSIGNED", "WORKING", "ARCHIVED"],
    ASSIGNED: ["WON", "LOST", "ARCHIVED"],
    WON: ["ARCHIVED"],
    LOST: ["ARCHIVED"],
    ARCHIVED: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

export function canEditCoreFields(role: Role, status: LeadStatus) {
  if (role === "ADMIN") return true;
  if (role === "MANAGER") return true;
  if (role === "CALLCENTER") return status === "NEW" || status === "WORKING" || status === "SALES_READY";
  if (role === "SALES") return false;
  return false;
}