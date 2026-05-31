require("dotenv/config");

const path = require("path");
const XLSX = require("xlsx");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const FILE_ARG = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const FILE_PATH = FILE_ARG || path.join(__dirname, "old-customers-one-table.xlsx");
const COMMIT = process.argv.includes("--commit");
const DEFAULT_FALLBACK_OWNER_EMAIL = "borhan.ghasemzadeh@dndcyprus.com";
const FALLBACK_OWNER_EMAIL = getArgValue("--fallback-owner") || DEFAULT_FALLBACK_OWNER_EMAIL;
const ALLOW_MISSING_OWNER = process.argv.includes("--allow-missing-owner");

const PROJECT_BY_LABEL = {
  "La Joya": "LA_JOYA",
  "La Joya Perla": "LA_JOYA_PERLA",
  "La Joya Perla II": "LA_JOYA_PERLA_II",
  "Lagoon Verde": "LAGOON_VERDE",
};

const NATIONALITY_BY_CODE = {
  AU: { country: "Australia", nationality: "Australian" },
  AZ: { country: "Azerbaijan", nationality: "Azerbaijani" },
  BL: { country: "Belarus", nationality: "Belarusian" },
  BY: { country: "Belarus", nationality: "Belarusian" },
  BG: { country: "Bulgaria", nationality: "Bulgarian" },
  CA: { country: "Canada", nationality: "Canadian" },
  CY: { country: "Cyprus", nationality: "Cypriot" },
  CYPRU: { country: "Cyprus", nationality: "Cypriot" },
  CZ: { country: "Czechia", nationality: "Czech" },
  DE: { country: "Germany", nationality: "German" },
  DIR: { country: "Poland", nationality: "Polish" },
  EE: { country: "Estonia", nationality: "Estonian" },
  ES: { country: "Spain", nationality: "Spanish" },
  FE: { country: "Poland", nationality: "Polish" },
  FI: { country: "Finland", nationality: "Finnish" },
  GB: { country: "United Kingdom", nationality: "British" },
  HU: { country: "Hungary", nationality: "Hungarian" },
  IL: { country: "Israel", nationality: "Israeli" },
  IR: { country: "Iran", nationality: "Iranian" },
  KKTC: { country: "Northern Cyprus", nationality: "Turkish Cypriot" },
  KZ: { country: "Kazakhstan", nationality: "Kazakh" },
  LT: { country: "Lithuania", nationality: "Lithuanian" },
  MD: { country: "Moldova", nationality: "Moldovan" },
  ME: { country: "Montenegro", nationality: "Montenegrin" },
  NE: { country: "Netherlands", nationality: "Dutch" },
  NL: { country: "Netherlands", nationality: "Dutch" },
  NM: { country: "Netherlands", nationality: "Dutch" },
  NO: { country: "Norway", nationality: "Norwegian" },
  NW: { country: "Netherlands", nationality: "Dutch" },
  PL: { country: "Poland", nationality: "Polish" },
  PO: { country: "Poland", nationality: "Polish" },
  RO: { country: "Romania", nationality: "Romanian" },
  RU: { country: "Russia", nationality: "Russian" },
  TC: { country: "Turkey", nationality: "Turkish" },
  TR: { country: "Turkey", nationality: "Turkish" },
  UA: { country: "Ukraine", nationality: "Ukrainian" },
  UK: { country: "United Kingdom", nationality: "British" },
  US: { country: "United States", nationality: "American" },
  VG: { country: "British Virgin Islands", nationality: "British Virgin Islander" },
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

function getArgValue(prefix) {
  const arg = process.argv.find((item) => item.startsWith(`${prefix}=`));
  return arg ? arg.slice(prefix.length + 1).trim() : "";
}

function clean(value) {
  return String(value ?? "").trim();
}

function splitList(value) {
  return clean(value)
    .split("|")
    .map((item) => clean(item))
    .filter(Boolean);
}

function firstListValue(value) {
  return splitList(value)[0] || "";
}

function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  if (!email || !email.includes("@") || email.includes(" ")) return "";
  return email;
}

function normalizeLookup(value) {
  return clean(value).toLocaleLowerCase("tr-TR");
}

function normalizePhone(value) {
  return clean(value);
}

function normalizeNationalityCode(value) {
  const code = clean(value).replace(/[^a-zA-Z]/g, "").toUpperCase();
  return NATIONALITY_BY_CODE[code] || null;
}

function parseUnitSelections(propertyDetails) {
  const units = [];
  const seen = new Set();

  for (const part of splitList(propertyDetails)) {
    const match = part.match(/^(.+?)\s*\/\s*(.+?)\s*\(/);
    if (!match) continue;

    const project = PROJECT_BY_LABEL[clean(match[1])];
    const unitNumber = clean(match[2]);
    if (!project || !unitNumber) continue;

    const key = `${project}__${unitNumber.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    units.push({ project, unitNumber });
  }

  return units;
}

async function findOwnerByEmail(email, userByEmail) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return userByEmail.get(normalized) || null;
}

async function findOrCreateAgency(name, dryRun, agencyByName) {
  const agencyName = clean(name);
  if (!agencyName) return null;

  const key = normalizeLookup(agencyName);
  const existing = agencyByName.get(key);
  if (existing) return existing;
  if (dryRun) return { id: null, name: agencyName };

  const created = await prisma.agency.create({
    data: {
      name: agencyName,
      source: "Old customer import",
      notesSummary: "Created from old customer import broker column.",
    },
    select: { id: true, name: true },
  });
  agencyByName.set(key, created);
  return created;
}

async function main() {
  const dryRun = !COMMIT;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const workbook = XLSX.readFile(FILE_PATH, { raw: false });
  const sheetName = workbook.SheetNames.includes("customers_all_details")
    ? "customers_all_details"
    : workbook.SheetNames[0];
  const rows = XLSX.utils
    .sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false })
    .filter((row) => clean(row.customerKey) || clean(row.fullName));

  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ["SALES", "MANAGER", "ADMIN"] } },
    select: { id: true, email: true, name: true, role: true },
  });
  const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const fallbackOwner = await findOwnerByEmail(FALLBACK_OWNER_EMAIL, userByEmail);
  const oldCustomerCodes = rows.map((row) => clean(row.customerKey)).filter(Boolean);
  const existingCustomers = await prisma.customer.findMany({
    where: { oldCustomerCode: { in: oldCustomerCodes } },
    select: { id: true, fullName: true, oldCustomerCode: true },
  });
  const existingByOldCustomerCode = new Map(
    existingCustomers
      .filter((customer) => customer.oldCustomerCode)
      .map((customer) => [customer.oldCustomerCode, customer]),
  );
  const existingAgencies = await prisma.agency.findMany({
    select: { id: true, name: true },
  });
  const agencyByName = new Map(
    existingAgencies.map((agency) => [normalizeLookup(agency.name), agency]),
  );
  const dryRunAgencyNamesToCreate = new Set();

  const summary = {
    file: FILE_PATH,
    sheet: sheetName,
    dryRun,
    fallbackOwnerEmail: FALLBACK_OWNER_EMAIL || null,
    rows: rows.length,
    prepared: 0,
    created: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    skippedMissingOwner: 0,
    missingOwner: 0,
    assignedToFallbackOwner: 0,
    agenciesToCreate: 0,
  };

  const invalid = [];
  const missingOwnerRows = [];

  for (const row of rows) {
    const fullName = clean(row.fullName);
    const oldCustomerCode = clean(row.customerKey);

    if (!fullName) {
      summary.skippedInvalid += 1;
      invalid.push({ customerKey: oldCustomerCode, reason: "Missing fullName" });
      continue;
    }

    const existing = oldCustomerCode
      ? existingByOldCustomerCode.get(oldCustomerCode)
      : null;

    if (existing) {
      summary.skippedExisting += 1;
      continue;
    }

    const mappedOwner = await findOwnerByEmail(row.ownerEmailForImport, userByEmail);
    const rowOwner = mappedOwner || fallbackOwner;
    if (!mappedOwner && fallbackOwner) {
      summary.assignedToFallbackOwner += 1;
    }

    if (!rowOwner) {
      summary.missingOwner += 1;
      missingOwnerRows.push({
        customerKey: oldCustomerCode,
        fullName,
        oldSalesCode: clean(row.oldSalesCode),
        salesRepresentativeEmail: clean(row.salesRepresentativeEmail),
      });

      if (!ALLOW_MISSING_OWNER) {
        summary.skippedMissingOwner += 1;
        continue;
      }
    }

    const brokerName = firstListValue(row.brokerNames);
    const agency = await findOrCreateAgency(brokerName, dryRun, agencyByName);
    if (agency && !agency.id) dryRunAgencyNamesToCreate.add(normalizeLookup(agency.name));

    const unitSelections = parseUnitSelections(row.propertyDetails);
    const crmProject = unitSelections[0]?.project || firstListValue(row.crmProjects) || undefined;
    const nationalityInfo = normalizeNationalityCode(row.nationalityCode);

    const data = {
      fullName,
      phone: normalizePhone(row.phone) || null,
      email: normalizeEmail(row.email) || null,
      type: "EXISTING",
      source: clean(row.source) || "Old customer import",
      country: nationalityInfo?.country || null,
      nationality: nationalityInfo?.nationality || clean(row.nationalityCode) || null,
      identityNumber: clean(row.identityNumber) || null,
      oldCustomerCode: oldCustomerCode || null,
      oldCariCodes: clean(row.originalCariKod) || null,
      ownerId: rowOwner?.id || null,
      agencyId: agency?.id || null,
      project: crmProject || null,
      notesSummary: clean(row.notesSummary) || null,
      unitSelections:
        unitSelections.length > 0
          ? {
              create: unitSelections.map((unit) => ({
                project: unit.project,
                unitNumber: unit.unitNumber,
              })),
            }
          : undefined,
    };

    summary.prepared += 1;

    if (!dryRun) {
      await prisma.customer.create({ data });
      summary.created += 1;
    }
  }

  summary.agenciesToCreate = dryRunAgencyNamesToCreate.size;

  console.log(JSON.stringify(summary, null, 2));

  if (invalid.length) {
    console.log("\nInvalid rows sample:");
    console.table(invalid.slice(0, 20));
  }

  if (missingOwnerRows.length) {
    console.log("\nRows without mapped owner sample:");
    console.table(missingOwnerRows.slice(0, 20));
    console.log(
      "\nThese rows used the fallback owner. Use --fallback-owner=email@domain.com to assign them to another CRM user.",
    );
  }

  if (dryRun) {
    console.log("\nDry run only. Re-run with --commit to write customers.");
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
