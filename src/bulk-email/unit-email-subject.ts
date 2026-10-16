import { projectLabel } from "../common/projects";
export function unitEmailSubject(project: string, units: string[]) {
  const unique = [...new Set(units.map(unit => unit.trim().replace(/^([a-z]+)[ _-]?(\d+)$/i, (_all, block, number) => `${block.toUpperCase()}-${number}`)).filter(Boolean))];
  unique.sort(new Intl.Collator("en", { numeric: true }).compare);
  return `${projectLabel(project)} ${unique.join(", ")}`.trim();
}
