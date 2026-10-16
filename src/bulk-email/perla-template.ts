import { readFile } from "fs/promises";
import { join } from "path";
export type PerlaLanguage = "tr" | "en" | "ru" | "fa";
export function perlaLanguage(
  language?: string | null,
  nationality?: string | null,
): { language: PerlaLanguage; fallback: boolean } {
  const lang = String(language || "")
    .trim()
    .toLowerCase();
  const groups: Record<PerlaLanguage, string[]> = {
    tr: ["tr", "turkish", "türkçe", "turkce", "türk", "turk"],
    en: ["en", "english", "ingilizce", "en-us", "en-gb"],
    ru: ["ru", "russian", "русский", "rusça", "rusca"],
    fa: ["fa", "farsi", "persian", "فارسی", "farsça", "farsca"],
  };
  for (const key of Object.keys(groups) as PerlaLanguage[])
    if (groups[key].includes(lang)) return { language: key, fallback: false };
  // An explicit unsupported preference must not be overridden by nationality.
  if (!lang) {
    const nat = String(nationality || "")
      .trim()
      .toLowerCase();
    if (
      [
        "turkish",
        "turkey",
        "türkiye",
        "türk",
        "tr",
        "turkey (turkish)",
        "kktc",
        "cypriot turkish",
        "turkish cypriot",
      ].includes(nat)
    )
      return { language: "tr", fallback: true };
    if (["iran", "iranian", "ir", "ایران", "iranlı", "iranli"].includes(nat))
      return { language: "fa", fallback: true };
    if (["russia", "russian", "rusya", "ru"].includes(nat))
      return { language: "ru", fallback: true };
  }
  return { language: "en", fallback: true };
}
async function loadTemplate(language: PerlaLanguage) {
  const dir = join(__dirname, "templates");
  const [html, plain, logo, hero] = await Promise.all([
    readFile(join(dir, `perla-${language}.html`), "utf8"),
    readFile(join(dir, `perla-${language}.txt`), "utf8"),
    readFile(join(dir, "dnd-logo.png")),
    readFile(join(dir, "perla-hero.jpg")),
  ]);
  const [subject, ...parts] = plain.split("\n\n");
  // CID assets travel with the email; no localhost or remote tracking images.
  // A normal image ensures Outlook can show the property even without CSS backgrounds.
  const banner =
    '<tr><td><img src="cid:perla-hero" width="680" alt="LA JOYA PERLA" style="display:block;width:100%;height:auto;border:0"></td></tr>';
  const rendered = html
    .replaceAll("dnd-logo.png", "cid:dnd-logo")
    .replaceAll("perla-hero.jpg", "cid:perla-hero")
    .replace(
      '<tr><td class="pad" background=',
      banner + '<tr><td class="pad" background=',
    );
  return {
    subject,
    text: parts.join("\n\n"),
    html: rendered,
    attachments: [
      {
        filename: "dnd-logo.png",
        content: logo,
        contentType: "image/png",
        cid: "dnd-logo",
        contentDisposition: "inline" as const,
      },
      {
        filename: "perla-hero.jpg",
        content: hero,
        contentType: "image/jpeg",
        cid: "perla-hero",
        contentDisposition: "inline" as const,
      },
    ],
  };
}

const templateCache = new Map<PerlaLanguage, ReturnType<typeof loadTemplate>>();
export function perlaTemplate(language: PerlaLanguage) {
  let template = templateCache.get(language);
  if (!template) {
    template = loadTemplate(language).catch((error) => {
      templateCache.delete(language);
      throw error;
    });
    templateCache.set(language, template);
  }
  return template;
}
