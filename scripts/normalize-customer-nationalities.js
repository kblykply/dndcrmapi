require("dotenv/config");

const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const COMMIT = process.argv.includes("--commit");

const NATIONALITIES = [
  ["Australia", "Australian", "AU"],
  ["Azerbaijan", "Azerbaijani", "AZ"],
  ["Belarus", "Belarusian", "BY"],
  ["British Virgin Islands", "British Virgin Islander", "VG"],
  ["Bulgaria", "Bulgarian", "BG"],
  ["Canada", "Canadian", "CA"],
  ["Cyprus", "Cypriot", "CY"],
  ["Czechia", "Czech", "CZ"],
  ["Estonia", "Estonian", "EE"],
  ["Finland", "Finnish", "FI"],
  ["France", "French", "FR"],
  ["Germany", "German", "DE"],
  ["Hungary", "Hungarian", "HU"],
  ["Iran", "Iranian", "IR"],
  ["Iraq", "Iraqi", "IQ"],
  ["Israel", "Israeli", "IL"],
  ["Kazakhstan", "Kazakh", "KZ"],
  ["Lithuania", "Lithuanian", "LT"],
  ["Moldova", "Moldovan", "MD"],
  ["Montenegro", "Montenegrin", "ME"],
  ["Netherlands", "Dutch", "NL"],
  ["Northern Cyprus", "Turkish Cypriot", "KKTC"],
  ["Norway", "Norwegian", "NO"],
  ["Poland", "Polish", "PL"],
  ["Romania", "Romanian", "RO"],
  ["Russia", "Russian", "RU"],
  ["Saudi Arabia", "Saudi", "SA"],
  ["Spain", "Spanish", "ES"],
  ["Turkey", "Turkish", "TR"],
  ["Ukraine", "Ukrainian", "UA"],
  ["United Arab Emirates", "Emirati", "AE"],
  ["United Kingdom", "British", "GB"],
  ["United States", "American", "US"],
].map(([country, nationality, iso2]) => ({ country, nationality, iso2 }));

const ALIASES = {
  AE: "United Arab Emirates",
  AU: "Australia",
  AZ: "Azerbaijan",
  BELARUSIAN: "Belarus",
  BL: "Belarus",
  BG: "Bulgaria",
  BRITISH: "United Kingdom",
  BY: "Belarus",
  CA: "Canada",
  CY: "Cyprus",
  CYPRIOT: "Cyprus",
  CYPRU: "Cyprus",
  CZ: "Czechia",
  DE: "Germany",
  DIR: "Poland",
  DUTCH: "Netherlands",
  EE: "Estonia",
  EMIRATI: "United Arab Emirates",
  ES: "Spain",
  FE: "Poland",
  FI: "Finland",
  FR: "France",
  GB: "United Kingdom",
  GERMAN: "Germany",
  HU: "Hungary",
  IL: "Israel",
  IR: "Iran",
  IQ: "Iraq",
  KKTC: "Northern Cyprus",
  KZ: "Kazakhstan",
  LT: "Lithuania",
  MD: "Moldova",
  ME: "Montenegro",
  NE: "Netherlands",
  NETHERLANDS: "Netherlands",
  NL: "Netherlands",
  NM: "Netherlands",
  NO: "Norway",
  NW: "Netherlands",
  PL: "Poland",
  PO: "Poland",
  POLAND: "Poland",
  POLISH: "Poland",
  POLNAD: "Poland",
  POLONYA: "Poland",
  RO: "Romania",
  RU: "Russia",
  SA: "Saudi Arabia",
  TC: "Turkey",
  TR: "Turkey",
  TURKEY: "Turkey",
  TURKISH: "Turkey",
  TURKIYE: "Turkey",
  UA: "Ukraine",
  UAE: "United Arab Emirates",
  UK: "United Kingdom",
  UKRAINE: "Ukraine",
  UNITEDKINGDOM: "United Kingdom",
  UNITEDSTATES: "United States",
  US: "United States",
  USA: "United States",
  VG: "British Virgin Islands",
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

function clean(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._-]/g, " ")
    .replace(/\s+/g, "")
    .toUpperCase();
}

const byCountry = new Map(NATIONALITIES.map((item) => [item.country, item]));
const byKey = new Map();

for (const item of NATIONALITIES) {
  byKey.set(key(item.country), item);
  byKey.set(key(item.nationality), item);
  byKey.set(key(item.iso2), item);
}

for (const [alias, country] of Object.entries(ALIASES)) {
  const item = byCountry.get(country);
  if (item) byKey.set(key(alias), item);
}

function oldCode(value) {
  const match = clean(value).match(/^([A-Za-z]+)/);
  return match?.[1] || "";
}

function normalize(value) {
  return byKey.get(key(value)) || null;
}

function resolve(row) {
  return (
    normalize(row.country) ||
    normalize(row.nationality) ||
    normalize(oldCode(row.oldCustomerCode)) ||
    normalize(oldCode(row.oldCariCodes))
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      country: true,
      nationality: true,
      oldCustomerCode: true,
      oldCariCodes: true,
    },
  });

  const updates = [];
  const unmapped = new Map();

  for (const customer of customers) {
    const info = resolve(customer);
    const raw =
      oldCode(customer.oldCustomerCode) ||
      oldCode(customer.oldCariCodes) ||
      clean(customer.nationality) ||
      clean(customer.country) ||
      "(blank)";

    if (!info) {
      unmapped.set(raw, (unmapped.get(raw) || 0) + 1);
      continue;
    }

    if (
      customer.country !== info.country ||
      customer.nationality !== info.nationality
    ) {
      updates.push({
        id: customer.id,
        country: info.country,
        nationality: info.nationality,
      });
    }
  }

  if (COMMIT) {
    for (const update of updates) {
      await prisma.customer.update({
        where: { id: update.id },
        data: {
          country: update.country,
          nationality: update.nationality,
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: !COMMIT,
        scanned: customers.length,
        changed: COMMIT ? updates.length : 0,
        wouldChange: updates.length,
        unmapped: [...unmapped.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      },
      null,
      2,
    ),
  );

  if (!COMMIT) {
    console.log("\nDry run only. Re-run with --commit to update customers.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
