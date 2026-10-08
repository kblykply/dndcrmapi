/* Runs organization writes inside a transaction that is always rolled back. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(root, ".env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { OrgChartService } = require("../dist/src/org-chart/org-chart.service");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { ca: fs.readFileSync(path.join(root, "supabase-ca.crt"), "utf8") },
});
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const rollback = new Error("EXPECTED_TEST_ROLLBACK");

async function main() {
  const beforeCount = await db.orgChartNode.count();
  const logCount = await db.orgChartLog.count();
  let verified = false;
  try {
    await db.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true, role: true } });
      assert(actor, "An active administrator is needed for this rollback-only check");
      const other = await tx.user.findFirst({ where: { role: { not: "PREVIEW" }, isActive: true, id: { not: actor.id } }, select: { id: true } });
      assert(other, "Another active user is needed for assignment history");
      const card = await tx.qualityProcessCard.findFirst({ where: { status: { not: "ARCHIVED" } }, select: { id: true } });
      const client = new Proxy(tx, {
        get(target, key) {
          if (key === "$transaction") return (operation) => typeof operation === "function" ? operation(tx) : Promise.all(operation);
          return target[key];
        },
      });
      const service = new OrgChartService(client);
      const dto = {
        name: "Rollback-only organization verification",
        kind: "POSITION", code: "VERIFY-" + Date.now(), purpose: "Test purpose",
        responsibilities: "Test duties", authority: "Test authority", competencies: "Test competencies",
        reviewDueAt: "2099-01-01", processes: card ? [{ cardId: card.id, responsibility: "RESPONSIBLE" }] : [],
      };
      let record = await service.create(actor, dto);
      assert.equal(record.version, 1);
      assert.equal(record.status, "DRAFT");
      record = await service.assign(actor, record.id, { version: record.version, userId: actor.id });
      record = await service.action(actor, record.id, "APPROVED", { version: record.version });
      record = await service.action(actor, record.id, "ACKNOWLEDGED", { version: record.version });
      assert.equal(record.acknowledgedRevision, record.revision);
      const oldVersion = record.version;
      record = await service.assign(actor, record.id, { version: record.version, userId: other.id });
      assert.equal(record.acknowledgedAt, null);
      assert.equal(record.status, "APPROVED");
      await assert.rejects(service.update(actor, record.id, { ...dto, version: oldVersion }), /changed/);
      await assert.rejects(service.update(actor, record.id, { ...dto, parentId: record.id, version: record.version }), /cycle/);
      await assert.rejects(service.action(actor, record.id, "ARCHIVED", { version: record.version }), /assignment/);
      record = await service.update(actor, record.id, { ...dto, purpose: "Revised purpose", version: record.version });
      assert.equal(record.status, "DRAFT");
      assert.equal(record.revision, 2);
      assert.equal(record.approvedAt, null);
      record = await service.assign(actor, record.id, { version: record.version, userId: null });
      record = await service.action(actor, record.id, "ARCHIVED", { version: record.version });
      assert.equal(record.status, "ARCHIVED");
      record = await service.action(actor, record.id, "RESTORED", { version: record.version });
      assert.equal(record.status, "DRAFT");
      const detail = await service.getOne(actor, record.id);
      assert.equal(detail.logs.length, 9);
      const transfer = detail.logs.find((log) => log.action === "ASSIGNMENT_CHANGED" && log.beforeJson?.assigneeId === actor.id);
      assert.equal(transfer.afterJson.assigneeId, other.id);
      assert(transfer.beforeJson.assignee.name);
      const revised = detail.logs.find((log) => log.action === "DEFINITION_UPDATED");
      assert.equal(revised.beforeJson.purpose, "Test purpose");
      assert.equal(revised.afterJson.purpose, "Revised purpose");
      assert.deepEqual(await service.workspace({ ...actor, originalRole: "PREVIEW", isPreview: true }), { nodes: [], users: [], qualityCards: [] });
      verified = true;
      throw rollback;
    }, { maxWait: 10000, timeout: 90000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert(verified);
  assert.equal(await db.orgChartNode.count(), beforeCount);
  assert.equal(await db.orgChartLog.count(), logCount);
  console.log(JSON.stringify({ databaseWorkflow: "passed", auditEventsVerified: 9, testDataRolledBack: true, existingRecords: beforeCount }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); await pool.end(); });
