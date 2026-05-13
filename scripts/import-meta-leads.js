require("dotenv/config");
const XLSX = require("xlsx");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const FILE_PATH = process.argv[2];
const DRY_RUN = process.argv.includes("--dry-run");

const OWNER_CALLCENTER_EMAIL = process.argv.find((x) => x.startsWith("--owner="))
  ? process.argv.find((x) => x.startsWith("--owner=")).split("=")[1]
  : "callcenter@dndcyprus.com";

if (!FILE_PATH) {
  console.error("Usage:");
  console.error(
    "node scripts/import-meta-leads.js ./meta-leads.csv --dry-run --owner=callcenter@dndcyprus.com"
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

function clean(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim().replace(/^"|"$/g, "");
}

function cleanEmail(v) {
  const email = clean(v).toLowerCase();

  if (!email) return null;
  if (email.includes("@devnull.facebook.com")) return null;
  if (!email.includes("@")) return null;

  return email;
}

function normalizePhone(raw) {
  let p = clean(raw);

  p = p.replace(/^p:/i, "");
  p = p.replace(/\D/g, "");

  if (!p) return "";

  if (p.length === 10) return `90${p}`;

  if (p.length === 11 && p.startsWith("0")) {
    return `90${p.slice(1)}`;
  }

  if (p.length === 12 && p.startsWith("90")) {
    return p;
  }

  return p;
}

function parseMetaDate(value) {
  const s = clean(value);
  if (!s) return null;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  return d;
}

function mapMetaPlatform(platform) {
  const p = clean(platform).toLowerCase();

  if (p === "ig" || p === "instagram") return "IG";
  if (p.includes("messenger")) return "FB_MESSENGER";

  return "LEAD_ADS";
}

function buildSource(row) {
  const parts = [
    clean(row["campaign_name"]),
    clean(row["ad_name"]),
    clean(row["adset_name"]),
    clean(row["platform"]),
  ].filter(Boolean);

  return parts.length ? parts.join(" / ") : "Meta Lead Ads";
}

function buildDetails(row) {
  const parts = [];

  const keys = [
    "id",
    "created_time",
    "campaign_name",
    "ad_name",
    "adset_name",
    "form_name",
    "platform",
    "is_organic",
  ];

  for (const key of keys) {
    const value = clean(row[key]);
    if (value) parts.push(`${key}: ${value}`);
  }

  return parts.join("\n");
}

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: OWNER_CALLCENTER_EMAIL },
    select: { id: true, email: true, role: true },
  });

  if (!owner) {
    throw new Error(`Owner user not found: ${OWNER_CALLCENTER_EMAIL}`);
  }

  const workbook = XLSX.readFile(FILE_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  console.log(`Sheet/File: ${sheetName}`);
  console.log(`Raw rows: ${rows.length}`);
  console.log(`Owner: ${owner.email}`);

  let createdLeads = 0;
  let updatedLeads = 0;
  let skippedRows = 0;
  let createdActivities = 0;

  for (const row of rows) {
    const metaLeadId = clean(row["id"]);
    const fullName = clean(row["full_name"]) || "İsimsiz Lead";
    const phone = normalizePhone(row["phone_number"]);
    const email = cleanEmail(row["email"]);
    const source = buildSource(row);
    const createdTime = parseMetaDate(row["created_time"]) || new Date();
    const metaPlatform = mapMetaPlatform(row["platform"]);
    const details = buildDetails(row);

    if (!phone) {
      skippedRows++;
      console.log("[SKIP] Missing phone:", fullName, metaLeadId);
      continue;
    }

    const existingByMeta = metaLeadId
      ? await prisma.lead.findUnique({
          where: { metaLeadId },
          select: { id: true, metaLeadId: true, phone: true },
        })
      : null;

    const existingByPhone = !existingByMeta
      ? await prisma.lead.findFirst({
          where: {
            phone,
            archivedAt: null,
          },
          select: {
            id: true,
            metaLeadId: true,
            phone: true,
          },
        })
      : null;

    const existing = existingByMeta || existingByPhone;

    if (DRY_RUN) {
      console.log(
        `[DRY] ${existing ? "UPDATE" : "CREATE"} | ${phone} | ${fullName} | ${metaLeadId}`
      );
      continue;
    }

    let leadId;

    if (existing) {
      const updated = await prisma.lead.update({
        where: { id: existing.id },
        data: {
          fullName,
          email,
          source,
          status: "NEW",
          ownerCallCenterId: owner.id,
          lastActivityAt: createdTime,
          ...(metaLeadId && !existing.metaLeadId ? { metaLeadId } : {}),
          metaPlatform,
        },
        select: { id: true },
      });

      leadId = updated.id;
      updatedLeads++;
    } else {
      const created = await prisma.lead.create({
        data: {
          fullName,
          phone,
          email,
          source,
          status: "NEW",
          ownerCallCenterId: owner.id,
          lastActivityAt: createdTime,
          createdAt: createdTime,
          metaLeadId: metaLeadId || null,
          metaPlatform,
        },
        select: { id: true },
      });

      leadId = created.id;
      createdLeads++;
    }

    await prisma.leadActivity.create({
      data: {
        leadId,
        type: "NOTE",
        summary: "Meta Lead Ads import",
        details,
        createdById: owner.id,
        createdAt: createdTime,
      },
    });

    createdActivities++;
  }

  console.log("---- IMPORT RESULT ----");
  console.log("createdLeads:", createdLeads);
  console.log("updatedLeads:", updatedLeads);
  console.log("createdActivities:", createdActivities);
  console.log("skippedRows:", skippedRows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });