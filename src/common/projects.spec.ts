import { ProjectType as PrismaProjectType } from "@prisma/client";
import {
  PROJECT_CATEGORIES,
  PROJECT_LABELS,
  PROJECT_TYPES,
  isProjectType,
  projectLabel,
} from "./projects";

describe("project catalog", () => {
  it("accepts Neocity without assigning an unconfirmed project category", () => {
    expect(isProjectType("NEOCITY")).toBe(true);
    expect(projectLabel("NEOCITY")).toBe("Neocity");
    expect(PROJECT_CATEGORIES.NEOCITY).toBeNull();
    expect(isProjectType("UNREGISTERED_PROJECT")).toBe(false);
  });

  it("keeps API project validation aligned with the generated Prisma enum", () => {
    expect([...PROJECT_TYPES].sort()).toEqual(
      Object.values(PrismaProjectType).sort(),
    );
  });

  it("preserves existing project labels and categories", () => {
    for (const [code, label, category] of [
      ["LA_JOYA", "La Joya", "RESIDENTIAL"],
      ["LA_JOYA_PERLA", "La Joya Perla", "RESIDENTIAL"],
      ["LA_JOYA_PERLA_II", "La Joya Perla II", "RESIDENTIAL"],
      ["LAGOON_VERDE", "Lagoon Verde", "RESIDENTIAL"],
      ["GECITKALE_1_ETAP", "Geçitkale 1. Etap", "LAND"],
    ] as const) {
      expect(isProjectType(code)).toBe(true);
      expect(projectLabel(code)).toBe(label);
      expect(PROJECT_CATEGORIES[code]).toBe(category);
    }
  });

  it("registers Geçitkale 1. Etap as a land project", () => {
    expect(PROJECT_TYPES).toContain("GECITKALE_1_ETAP");
    expect(isProjectType("GECITKALE_1_ETAP")).toBe(true);
    expect(PROJECT_LABELS.GECITKALE_1_ETAP).toBe("Geçitkale 1. Etap");
    expect(PROJECT_CATEGORIES.GECITKALE_1_ETAP).toBe("LAND");
    expect(projectLabel("GECITKALE_1_ETAP")).toBe("Geçitkale 1. Etap");
  });
});
