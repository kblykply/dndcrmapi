export const PROJECT_TYPES = [
  "LA_JOYA",
  "LA_JOYA_PERLA",
  "LA_JOYA_PERLA_II",
  "LAGOON_VERDE",
  "GECITKALE_1_ETAP",
  "NEOCITY",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];
export type ProjectCategory = "RESIDENTIAL" | "LAND";

export const PROJECT_LABELS: Record<ProjectType, string> = {
  LA_JOYA: "La Joya",
  LA_JOYA_PERLA: "La Joya Perla",
  LA_JOYA_PERLA_II: "La Joya Perla II",
  LAGOON_VERDE: "Lagoon Verde",
  GECITKALE_1_ETAP: "Geçitkale 1. Etap",
  NEOCITY: "Neocity",
};

export const PROJECT_CATEGORIES: Record<ProjectType, ProjectCategory | null> = {
  LA_JOYA: "RESIDENTIAL",
  LA_JOYA_PERLA: "RESIDENTIAL",
  LA_JOYA_PERLA_II: "RESIDENTIAL",
  LAGOON_VERDE: "RESIDENTIAL",
  GECITKALE_1_ETAP: "LAND",
  NEOCITY: null,
};

export function isProjectType(value: string): value is ProjectType {
  return PROJECT_TYPES.includes(value as ProjectType);
}

export function projectLabel(project?: string | null) {
  if (!project) return "";
  return PROJECT_LABELS[project as ProjectType] || project;
}
