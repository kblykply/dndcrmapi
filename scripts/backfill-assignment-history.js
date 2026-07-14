require("dotenv/config");

const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const COMMIT = process.argv.includes("--commit");
const BASELINE_CURRENT = process.argv.includes("--baseline-current");
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const runStartedAt = new Date();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta);
    } catch {
      return {};
    }
  }
  return meta;
}

function cleanId(value) {
  const id = String(value || "").trim();
  return id || null;
}

function sameId(a, b) {
  return (a || null) === (b || null);
}

function withinWindow(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= DUPLICATE_WINDOW_MS;
}

function isDuplicate(rows, candidate, previousKey, newKey) {
  return rows.some(
    (row) =>
      sameId(row[previousKey], candidate[previousKey]) &&
      sameId(row[newKey], candidate[newKey]) &&
      sameId(row.changedById, candidate.changedById) &&
      withinWindow(row.createdAt, candidate.createdAt),
  );
}

function userSnapshot(usersById, id) {
  if (!id) return null;
  return usersById.get(id) || null;
}

function customerHistoryData(candidate, usersById) {
  const previous = userSnapshot(usersById, candidate.previousOwnerId);
  const next = userSnapshot(usersById, candidate.newOwnerId);
  const changedBy = userSnapshot(usersById, candidate.changedById);

  return {
    customerId: candidate.customerId,
    previousOwnerId: previous ? candidate.previousOwnerId : null,
    newOwnerId: next ? candidate.newOwnerId : null,
    changedById: changedBy ? candidate.changedById : null,
    createdAt: candidate.createdAt,
    previousOwnerName: previous?.name || null,
    previousOwnerEmail: previous?.email || null,
    previousOwnerRole: previous?.role || null,
    newOwnerName: next?.name || null,
    newOwnerEmail: next?.email || null,
    newOwnerRole: next?.role || null,
    changedByName: changedBy?.name || null,
    changedByEmail: changedBy?.email || null,
    changedByRole: changedBy?.role || null,
  };
}

function agencyHistoryData(candidate, usersById) {
  const previous = userSnapshot(usersById, candidate.previousSalesId);
  const next = userSnapshot(usersById, candidate.newSalesId);
  const changedBy = userSnapshot(usersById, candidate.changedById);

  return {
    agencyId: candidate.agencyId,
    previousSalesId: previous ? candidate.previousSalesId : null,
    newSalesId: next ? candidate.newSalesId : null,
    changedById: changedBy ? candidate.changedById : null,
    createdAt: candidate.createdAt,
    previousSalesName: previous?.name || null,
    previousSalesEmail: previous?.email || null,
    previousSalesRole: previous?.role || null,
    newSalesName: next?.name || null,
    newSalesEmail: next?.email || null,
    newSalesRole: next?.role || null,
    changedByName: changedBy?.name || null,
    changedByEmail: changedBy?.email || null,
    changedByRole: changedBy?.role || null,
  };
}

async function main() {
  const [notifications, customers, agencies, users, existingCustomerHistory, existingAgencyHistory] =
    await Promise.all([
      prisma.notification.findMany({
        where: { type: { in: ["CUSTOMER_UPDATED", "AGENCY_UPDATED"] } },
        select: {
          id: true,
          type: true,
          entityId: true,
          metaJson: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.customer.findMany({ select: { id: true, ownerId: true } }),
      prisma.agency.findMany({ select: { id: true, assignedSalesId: true } }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true },
      }),
      prisma.customerOwnerHistory.findMany({
        select: {
          customerId: true,
          previousOwnerId: true,
          newOwnerId: true,
          changedById: true,
          createdAt: true,
        },
      }),
      prisma.agencySalesHistory.findMany({
        select: {
          agencyId: true,
          previousSalesId: true,
          newSalesId: true,
          changedById: true,
          createdAt: true,
        },
      }),
    ]);

  const customerIds = new Set(customers.map((row) => row.id));
  const agencyIds = new Set(agencies.map((row) => row.id));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const existingCustomerHistoryByCustomer = new Map();
  const existingAgencyHistoryByAgency = new Map();

  for (const row of existingCustomerHistory) {
    const rows = existingCustomerHistoryByCustomer.get(row.customerId) || [];
    rows.push(row);
    existingCustomerHistoryByCustomer.set(row.customerId, rows);
  }

  for (const row of existingAgencyHistory) {
    const rows = existingAgencyHistoryByAgency.get(row.agencyId) || [];
    rows.push(row);
    existingAgencyHistoryByAgency.set(row.agencyId, rows);
  }

  const customerCandidates = [];
  const agencyCandidates = [];
  let skipped = 0;

  for (const notification of notifications) {
    const meta = parseMeta(notification.metaJson);

    if (notification.type === "CUSTOMER_UPDATED") {
      const customerId = cleanId(meta.customerId || notification.entityId);
      const previousOwnerId = cleanId(meta.previousOwnerId);
      const newOwnerId = cleanId(meta.ownerId);
      const changedById = cleanId(meta.actorId);

      if (
        !customerId ||
        !customerIds.has(customerId) ||
        sameId(previousOwnerId, newOwnerId) ||
        (!previousOwnerId && !newOwnerId)
      ) {
        skipped += 1;
        continue;
      }

      customerCandidates.push({
        customerId,
        previousOwnerId,
        newOwnerId,
        changedById,
        createdAt: notification.createdAt,
      });
    }

    if (notification.type === "AGENCY_UPDATED") {
      const agencyId = cleanId(meta.agencyId || notification.entityId);
      const previousSalesId = cleanId(meta.previousAssignedSalesId);
      const newSalesId = cleanId(meta.assignedSalesId);
      const changedById = cleanId(meta.actorId);

      if (
        !agencyId ||
        !agencyIds.has(agencyId) ||
        sameId(previousSalesId, newSalesId) ||
        (!previousSalesId && !newSalesId)
      ) {
        skipped += 1;
        continue;
      }

      agencyCandidates.push({
        agencyId,
        previousSalesId,
        newSalesId,
        changedById,
        createdAt: notification.createdAt,
      });
    }
  }

  const customerRows = customerCandidates
    .filter(
      (candidate) =>
        !isDuplicate(
          existingCustomerHistoryByCustomer.get(candidate.customerId) || [],
          candidate,
          "previousOwnerId",
          "newOwnerId",
        ),
    )
    .map((candidate) => customerHistoryData(candidate, usersById));

  const agencyRows = agencyCandidates
    .filter(
      (candidate) =>
        !isDuplicate(
          existingAgencyHistoryByAgency.get(candidate.agencyId) || [],
          candidate,
          "previousSalesId",
          "newSalesId",
        ),
    )
    .map((candidate) => agencyHistoryData(candidate, usersById));

  const baselineCustomerRows = BASELINE_CURRENT
    ? customers
        .filter(
          (customer) =>
            customer.ownerId &&
            !existingCustomerHistoryByCustomer.has(customer.id) &&
            usersById.has(customer.ownerId),
        )
        .map((customer) => {
          const next = usersById.get(customer.ownerId);
          return {
            customerId: customer.id,
            previousOwnerId: null,
            newOwnerId: customer.ownerId,
            changedById: null,
            createdAt: runStartedAt,
            previousOwnerName: null,
            previousOwnerEmail: null,
            previousOwnerRole: null,
            newOwnerName: next?.name || null,
            newOwnerEmail: next?.email || null,
            newOwnerRole: next?.role || null,
            changedByName: "System baseline",
            changedByEmail: null,
            changedByRole: "SYSTEM",
          };
        })
    : [];

  const baselineAgencyRows = BASELINE_CURRENT
    ? agencies
        .filter(
          (agency) =>
            agency.assignedSalesId &&
            !existingAgencyHistoryByAgency.has(agency.id) &&
            usersById.has(agency.assignedSalesId),
        )
        .map((agency) => {
          const next = usersById.get(agency.assignedSalesId);
          return {
            agencyId: agency.id,
            previousSalesId: null,
            newSalesId: agency.assignedSalesId,
            changedById: null,
            createdAt: runStartedAt,
            previousSalesName: null,
            previousSalesEmail: null,
            previousSalesRole: null,
            newSalesName: next?.name || null,
            newSalesEmail: next?.email || null,
            newSalesRole: next?.role || null,
            changedByName: "System baseline",
            changedByEmail: null,
            changedByRole: "SYSTEM",
          };
        })
    : [];

  const allCustomerRows = [...customerRows, ...baselineCustomerRows];
  const allAgencyRows = [...agencyRows, ...baselineAgencyRows];

  console.log(
    JSON.stringify(
      {
        mode: COMMIT ? "commit" : "dry-run",
        baselineCurrent: BASELINE_CURRENT,
        notificationsScanned: notifications.length,
        customerCandidates: customerCandidates.length,
        agencyCandidates: agencyCandidates.length,
        customerRowsToInsert: customerRows.length,
        agencyRowsToInsert: agencyRows.length,
        baselineCustomerRowsToInsert: baselineCustomerRows.length,
        baselineAgencyRowsToInsert: baselineAgencyRows.length,
        totalCustomerRowsToInsert: allCustomerRows.length,
        totalAgencyRowsToInsert: allAgencyRows.length,
        skipped,
      },
      null,
      2,
    ),
  );

  if (!COMMIT) {
    console.log(
      "Dry run only. Re-run with --commit to insert history rows. Add --baseline-current to seed current assignments.",
    );
    return;
  }

  if (allCustomerRows.length > 0) {
    await prisma.customerOwnerHistory.createMany({ data: allCustomerRows });
  }

  if (allAgencyRows.length > 0) {
    await prisma.agencySalesHistory.createMany({ data: allAgencyRows });
  }

  console.log("Backfill complete.");
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
