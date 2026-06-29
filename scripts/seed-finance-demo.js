require("dotenv/config");

const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const COMMIT = process.argv.includes("--commit");
const CLEAN = process.argv.includes("--clean");
const PREFIX = "[DEMO FINANCE]";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

function addDays(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function dueOptions(originalDueDate, selectedDays, days = [0, 30, 60, 90]) {
  const unique = [...new Set([...days, selectedDays])].sort((a, b) => a - b);
  return unique.map((day) => ({
    label: day === 0 ? "Normal vade" : `${day} gün vade`,
    daysFromOriginal: day,
    dueDate: new Date(originalDueDate.getTime() + day * 24 * 60 * 60 * 1000),
    isSelected: day === selectedDays,
  }));
}

async function cleanup() {
  const entries = await prisma.financeEntry.deleteMany({
    where: { title: { startsWith: PREFIX } },
  });
  const rates = await prisma.financeExchangeRate.deleteMany({
    where: { note: { startsWith: PREFIX } },
  });
  return { entries: entries.count, rates: rates.count };
}

async function findDemoContext() {
  const user = await prisma.user.findFirst({
    where: { isActive: true, role: { in: ["ADMIN", "ACCOUNTING"] } },
    select: { id: true, email: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  const units = await prisma.customerUnitSelection.findMany({
    where: { customer: { type: "EXISTING" } },
    select: {
      id: true,
      project: true,
      unitNumber: true,
      customerId: true,
      customer: { select: { id: true, fullName: true } },
    },
    orderBy: [{ project: "asc" }, { unitNumber: "asc" }],
    take: 10,
  });

  const customers = await prisma.customer.findMany({
    where: { type: "EXISTING" },
    select: { id: true, fullName: true },
    orderBy: { createdAt: "asc" },
    take: 8,
  });

  return { user, units, customers };
}

function relationData(unit, customers, index) {
  const fallbackCustomer = customers[index % Math.max(customers.length, 1)];
  return {
    customerId: unit?.customerId || fallbackCustomer?.id || null,
    unitSelectionId: unit?.id || null,
    project: unit?.project || null,
  };
}

async function createEntry(context, row, index) {
  const unit = context.units[index % Math.max(context.units.length, 1)];
  const linked = row.linkUnit === false ? {} : relationData(unit, context.customers, index);
  const originalDueDate = addDays(row.dueIn);
  const selectedDeferralDays = row.selectedDays || 0;

  return prisma.financeEntry.create({
    data: {
      kind: row.kind,
      paymentType: row.paymentType,
      status: row.status || "PLANNED",
      title: `${PREFIX} ${row.title}`,
      description: `${PREFIX} Demo data - kolay temizlenebilir örnek kayıt.`,
      vendorName: row.vendorName || null,
      contractReference: row.contractReference || `DEMO-${String(index + 1).padStart(3, "0")}`,
      amount: row.amount,
      currency: row.currency || "GBP",
      exchangeRateToBase: row.exchangeRateToBase || null,
      baseCurrency: "GBP",
      originalDueDate,
      plannedDueDate: new Date(originalDueDate.getTime() + selectedDeferralDays * 24 * 60 * 60 * 1000),
      selectedDeferralDays,
      paidAt: row.status === "PAID" ? addDays(row.dueIn - 2) : null,
      customerId: linked.customerId || null,
      unitSelectionId: linked.unitSelectionId || null,
      project: linked.project || row.project || null,
      createdById: context.user?.id || null,
      updatedById: context.user?.id || null,
      dueOptions: {
        create: dueOptions(originalDueDate, selectedDeferralDays, row.optionDays),
      },
      splits:
        row.splits && row.splits.length
          ? {
              create: row.splits.map((split) => ({
                method: split.method,
                ratio: split.ratio,
                amount: Math.round(row.amount * (split.ratio / 100) * 100) / 100,
                unitSelectionId:
                  split.method === "BARTER"
                    ? context.units[(index + 2) % Math.max(context.units.length, 1)]?.id || null
                    : null,
                note: split.note || null,
              })),
            }
          : undefined,
    },
  });
}

async function seed() {
  const context = await findDemoContext();

  const rates = [
    { currency: "GBP", rateToBase: 1 },
    { currency: "USD", rateToBase: 0.79 },
    { currency: "EUR", rateToBase: 0.86 },
    { currency: "TRY", rateToBase: 0.024 },
  ];

  for (const rate of rates) {
    await prisma.financeExchangeRate.create({
      data: {
        ...rate,
        baseCurrency: "GBP",
        effectiveDate: addDays(-3),
        note: `${PREFIX} Manual demo exchange rate`,
        createdById: context.user?.id || null,
      },
    });
  }

  const entries = [
    {
      kind: "INCOME",
      paymentType: "SALE_INSTALLMENT",
      title: "Lagoon Verde satış taksiti 1",
      amount: 52000,
      dueIn: -8,
      status: "PAID",
    },
    {
      kind: "INCOME",
      paymentType: "SALE_INSTALLMENT",
      title: "La Joya Perla satış taksiti 2",
      amount: 68000,
      dueIn: 6,
      status: "PLANNED",
    },
    {
      kind: "INCOME",
      paymentType: "RENTAL_INCOME",
      title: "Kısa dönem kira geliri",
      amount: 4200,
      dueIn: 4,
      status: "PLANNED",
    },
    {
      kind: "INCOME",
      paymentType: "RENTAL_INCOME",
      title: "Uzun dönem kira geliri",
      amount: 1850,
      dueIn: 18,
      status: "PLANNED",
    },
    {
      kind: "INCOME",
      paymentType: "OTHER",
      title: "Rezervasyon kapora geliri",
      amount: 7500,
      dueIn: 12,
      status: "PLANNED",
    },
    {
      kind: "EXPENSE",
      paymentType: "SUBCONTRACTOR",
      title: "Taşeron kaba inşaat hakediş",
      vendorName: "Demo Taşeron A",
      amount: 44000,
      dueIn: 3,
      selectedDays: 30,
      optionDays: [0, 30, 60, 90],
      splits: [
        { method: "CASH", ratio: 55 },
        { method: "CHECK", ratio: 30 },
        { method: "BARTER", ratio: 15, note: "Barter unit opsiyonel" },
      ],
    },
    {
      kind: "EXPENSE",
      paymentType: "SUBCONTRACTOR",
      title: "Taşeron mekanik işçilik",
      vendorName: "Demo Taşeron B",
      amount: 26500,
      dueIn: 15,
      selectedDays: 60,
      optionDays: [0, 30, 60],
      splits: [
        { method: "CASH", ratio: 70 },
        { method: "CHECK", ratio: 20 },
        { method: "BARTER", ratio: 10 },
      ],
    },
    {
      kind: "EXPENSE",
      paymentType: "CHECK_PAYMENT",
      title: "Çek ödemesi - tedarikçi",
      vendorName: "Demo Tedarikçi",
      amount: 19000,
      dueIn: 21,
      selectedDays: 30,
      optionDays: [0, 30],
      linkUnit: false,
    },
    {
      kind: "EXPENSE",
      paymentType: "CREDIT_INSTALLMENT",
      title: "Banka kredi taksiti",
      vendorName: "Demo Bank",
      amount: 12500,
      dueIn: 2,
      linkUnit: false,
    },
    {
      kind: "EXPENSE",
      paymentType: "REALTOR_COMMISSION",
      title: "Emlakçı komisyon ödemesi",
      vendorName: "Demo Agency",
      amount: 8200,
      dueIn: 10,
    },
    {
      kind: "EXPENSE",
      paymentType: "INVOICE",
      title: "Elektrik ve su fatura paketi",
      vendorName: "Demo Utility",
      amount: 3600,
      dueIn: 7,
      linkUnit: false,
    },
    {
      kind: "EXPENSE",
      paymentType: "TAX",
      title: "KDV/vergi ödeme planı",
      vendorName: "Tax Office",
      amount: 14800,
      dueIn: 25,
      linkUnit: false,
    },
    {
      kind: "EXPENSE",
      paymentType: "SALARY",
      title: "Personel maaş ödemesi",
      amount: 23500,
      dueIn: 1,
      linkUnit: false,
    },
    {
      kind: "EXPENSE",
      paymentType: "OTHER",
      title: "Şantiye küçük giderler",
      amount: 2100,
      dueIn: -4,
      status: "OVERDUE",
      linkUnit: false,
    },
  ];

  for (let i = 0; i < entries.length; i += 1) {
    await createEntry(context, entries[i], i);
  }

  return { rates: rates.length, entries: entries.length };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  if (!COMMIT) {
    console.log("Dry run. Add --commit to write demo finance data.");
    console.log("Use --clean --commit to delete demo finance data.");
    return;
  }

  const removed = await cleanup();
  if (CLEAN) {
    console.log({ cleaned: removed });
    return;
  }

  const created = await seed();
  console.log({ cleaned: removed, created });
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
