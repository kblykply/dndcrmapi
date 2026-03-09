export const ROLES = ["CALLCENTER", "MANAGER", "SALES", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const LEAD_STATUSES = [
  "NEW",
  "WORKING",
  "SALES_READY",
  "MANAGER_REVIEW",
  "ASSIGNED",
  "WON",
  "LOST",
  "ARCHIVED",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "CALL",
  "NOTE",
  "MEETING",
  "WHATSAPP",
  "EMAIL",
  "STATUS_CHANGE",
  "ASSIGNMENT",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];