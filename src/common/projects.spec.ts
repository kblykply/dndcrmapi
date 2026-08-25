import {
  PROJECT_CATEGORIES,
  PROJECT_LABELS,
  PROJECT_TYPES,
  isProjectType,
  projectLabel,
} from "./projects";

describe("project catalog", () => {
  it("registers Geçitkale 1. Etap as a land project", () => {
    expect(PROJECT_TYPES).toContain("GECITKALE_1_ETAP");
    expect(isProjectType("GECITKALE_1_ETAP")).toBe(true);
    expect(PROJECT_LABELS.GECITKALE_1_ETAP).toBe("Geçitkale 1. Etap");
    expect(PROJECT_CATEGORIES.GECITKALE_1_ETAP).toBe("LAND");
    expect(projectLabel("GECITKALE_1_ETAP")).toBe("Geçitkale 1. Etap");
  });
});
