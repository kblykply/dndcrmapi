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
    "node scripts/import-old-leads.js ./old-leads.xlsx --dry-run --owner=callcenter@dndcyprus.com"
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
  return String(v).trim();
}

function normalizePhone(raw) {
  let p = clean(raw).replace(/\D/g, "");

  if (!p) return "";

  // 10 haneli TR GSM -> 90 ile başlat
  if (p.length === 10) {
    return `90${p}`;
  }

  // 0 ile başlayan 11 haneli -> baştaki 0 kaldır, 90 ekle
  if (p.length === 11 && p.startsWith("0")) {
    return `90${p.slice(1)}`;
  }

  // 90 ile başlayan 12 haneli -> olduğu gibi
  if (p.length === 12 && p.startsWith("90")) {
    return p;
  }

  // Diğerlerini olduğu gibi döndür
  return p;
}

function parseTRDate(value) {
  const s = clean(value);
  if (!s) return null;

  // excel serial olabilir
  if (!isNaN(Number(s)) && Number(s) > 20000) {
    const excelDate = XLSX.SSF.parse_date_code(Number(s));
    if (!excelDate) return null;
    return new Date(
      excelDate.y,
      excelDate.m - 1,
      excelDate.d,
      12,
      0,
      0,
      0
    );
  }

  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);

  if (!dd || !mm || !yyyy) return null;

  return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
}

function mapCallOutcome(leadDurumu) {
  const s = clean(leadDurumu).toLowerCase();

  if (!s) return "NO_ANSWER";
  if (s.includes("açmad")) return "NO_ANSWER";
  if (s.includes("olumsuz")) return "NOT_INTERESTED";
  if (s.includes("olumlu")) return "INTERESTED";
  if (s.includes("ileriye dönük takip")) return "CALL_AGAIN";
  if (s.includes("tekrar ara")) return "CALL_AGAIN";
  if (s.includes("yanlış")) return "WRONG_NUMBER";

  return "NO_ANSWER";
}

function mapLeadStatus(leadDurumu) {
  const s = clean(leadDurumu).toLowerCase();

  if (!s) return "WORKING";
  if (s.includes("olumsuz")) return "LOST";
  if (s.includes("olumlu")) return "WORKING";
  if (s.includes("ileriye dönük takip")) return "WORKING";
  if (s.includes("açmad")) return "WORKING";

  return "WORKING";
}

function buildSource(row) {
  const parts = [
    clean(row["campaign_name"]),
    clean(row["platform"]),
    clean(row["size_nasıl_yardımcı_olabiliriz_?"]),
  ].filter(Boolean);

  if (!parts.length) return "Excel Import";
  return parts.join(" / ");
}

function buildPreferredTime(row) {
  return clean(row["sizi_ne_zaman_aramamızı_istersiniz_?"]);
}

function buildRowNote(row) {
  const parts = [];

  const note = clean(row["Not"]);
  const preferredTime = buildPreferredTime(row);
  const campaign = clean(row["campaign_name"]);
  const platform = clean(row["platform"]);
  const helpType = clean(row["size_nasıl_yardımcı_olabiliriz_?"]);
  const appointment = clean(row["Randevu Tarihi"]);

  if (note) parts.push(`Not: ${note}`);
  if (campaign) parts.push(`Campaign: ${campaign}`);
  if (platform) parts.push(`Platform: ${platform}`);
  if (helpType) parts.push(`Talep: ${helpType}`);
  if (preferredTime) parts.push(`Tercih Edilen Arama Saati: ${preferredTime}`);
  if (appointment) parts.push(`Randevu Tarihi: ${appointment}`);

  return parts.join("\n");
}

function latestDate(...dates) {
  const valid = dates.filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
  return valid.length ? valid[valid.length - 1] : null;
}

function rowSortDate(row) {
  return (
    parseTRDate(row["Son Aksiyon Tarihi"]) ||
    parseTRDate(row["Takip Tarihi"]) ||
    parseTRDate(row["Randevu Tarihi"]) ||
    new Date(2000, 0, 1)
  ).getTime();
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

  console.log(`Sheet: ${sheetName}`);
  console.log(`Raw rows: ${rows.length}`);

  const prepared = [];
  const skipped = [];

  for (const row of rows) {
    const fullName = clean(row["full_name"]);
    const phone = normalizePhone(row["phone_number"]);
    const email = clean(row["email"]).toLowerCase();
    const leadDurumu = clean(row["Lead Durumu"]);
    const note = clean(row["Not"]);

    if (!phone) {
      skipped.push({ reason: "missing phone", row });
      continue;
    }

    prepared.push({
      raw: row,
      fullName: fullName || null,
      phone,
      email: email || null,
      source: buildSource(row),
      preferredTime: buildPreferredTime(row),
      leadDurumu,
      leadStatus: mapLeadStatus(leadDurumu),
      callOutcome: mapCallOutcome(leadDurumu),
      actionDate: parseTRDate(row["Son Aksiyon Tarihi"]),
      followDate: parseTRDate(row["Takip Tarihi"]),
      appointmentDate: parseTRDate(row["Randevu Tarihi"]),
      details: buildRowNote(row),
      note,
    });
  }

  console.log(`Prepared rows: ${prepared.length}`);
  console.log(`Skipped rows: ${skipped.length}`);

  const groups = new Map();

  for (const item of prepared) {
    const key = item.phone;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  console.log(`Unique phones / unique leads: ${groups.size}`);

  let createdLeads = 0;
  let updatedLeads = 0;
  let createdActivities = 0;
  let createdMeetings = 0;

  for (const [phone, items] of groups.entries()) {
    items.sort((a, b) => rowSortDate(a.raw) - rowSortDate(b.raw));

    const latest = items[items.length - 1];
    const fullName =
      latest.fullName ||
      items.find((x) => x.fullName)?.fullName ||
      "İsimsiz Lead";

    const email =
      latest.email ||
      items.find((x) => x.email)?.email ||
      null;

    const source =
      latest.source ||
      items.find((x) => x.source)?.source ||
      "Excel Import";

    const leadStatus = latest.leadStatus || "WORKING";
    const nextFollowUpAt = latest.followDate || null;
    const lastActivityAt = latestDate(
      ...items.map((x) => x.actionDate).filter(Boolean)
    );

    const existingLead = await prisma.lead.findFirst({
      where: {
        archivedAt: null,
        phone,
      },
      select: { id: true, fullName: true, phone: true },
    });

    if (DRY_RUN) {
      console.log(
        `[DRY] ${existingLead ? "UPDATE" : "CREATE"} LEAD`,
        phone,
        fullName,
        `rows=${items.length}`
      );
      continue;
    }

    let leadId;

    if (existingLead) {
      const updated = await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          fullName,
          email,
          source,
          status: leadStatus,
          nextFollowUpAt,
          lastActivityAt,
        },
        select: { id: true },
      });

      leadId = updated.id;
      updatedLeads += 1;
    } else {
      const created = await prisma.lead.create({
        data: {
          fullName,
          phone,
          email,
          source,
          status: leadStatus,
          ownerCallCenterId: owner.id,
          nextFollowUpAt,
          lastActivityAt,
        },
        select: { id: true },
      });

      leadId = created.id;
      createdLeads += 1;
    }

    for (const item of items) {
      const createdAt = item.actionDate || new Date();

      await prisma.leadActivity.create({
        data: {
          leadId,
          type: "CALL",
          summary: `Excel Import: ${item.leadDurumu || "Geçmiş Kayıt"}`,
          details: item.details || null,
          callOutcome: item.callOutcome,
          createdById: owner.id,
          createdAt,
        },
      });

      createdActivities += 1;

      if (item.appointmentDate) {
        await prisma.leadActivity.create({
          data: {
            leadId,
            type: "MEETING",
            summary: "Excel Import Randevu Kaydı",
            details: item.details || null,
            createdById: owner.id,
            createdAt: item.appointmentDate,
          },
        });

        createdMeetings += 1;
      }
    }
  }

  console.log("---- IMPORT RESULT ----");
  console.log("createdLeads:", createdLeads);
  console.log("updatedLeads:", updatedLeads);
  console.log("createdActivities:", createdActivities);
  console.log("createdMeetings:", createdMeetings);
  console.log("skippedRows:", skipped.length);

  if (skipped.length) {
    console.log("---- SKIPPED SAMPLE ----");
    console.log(skipped.slice(0, 10).map((x) => x.reason));
  }
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