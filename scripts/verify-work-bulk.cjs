require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaService } = require('../dist/src/prisma/prisma.service');
const { TasksService } = require('../dist/src/tasks/tasks.service');
const prisma = new PrismaService(); const rollback = new Error('ROLLBACK_BULK_TEST');
async function main() {
  const before = await prisma.crmTask.count();
  try { await prisma.$transaction(async (tx) => {
    const db = new Proxy(tx, { get(target, key) { return key === '$transaction' ? (fn) => fn(tx) : target[key]; } });
    const service = new TasksService(db, {}); service.publish = async () => {};
    const owner = await tx.user.create({ data: { id: randomUUID(), email: randomUUID() + '@bulk-test.invalid', passwordHash: 'not-a-login', name: 'Bulk test', role: 'AFTERSALES' } });
    const project = await service.createProject(owner, { key: 'B' + randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(), name: 'Isolated bulk test', color: '#147d73', members: [] });
    const ids = Array.from({ length: 50 }, () => randomUUID());
    await tx.crmTask.createMany({ data: ids.map((id) => ({ id, title: 'Bulk verification', projectId: project.id, createdById: owner.id, assignedToId: owner.id })) });
    const start = Date.now();
    assert.equal((await service.bulk(owner, { items: ids.map((id) => ({ id, version: 1 })), priority: 'HIGH' })).updated, 50);
    const elapsed = Date.now() - start;
    assert.equal(await tx.crmTask.count({ where: { id: { in: ids }, version: 2, priority: 'HIGH' } }), 50);
    assert.equal(await tx.workActivity.count({ where: { taskId: { in: ids } } }), 50);
    await assert.rejects(() => service.bulk(owner, { items: ids.map((id, i) => ({ id, version: i === 49 ? 1 : 2 })), priority: 'URGENT' }), (e) => e.getResponse?.().code === 'WORK_VERSION_CONFLICT');
    assert.equal(await tx.crmTask.count({ where: { id: { in: ids }, priority: 'URGENT' } }), 0);
    assert(elapsed < 30000, 'Bulk update exceeded production transaction budget: ' + elapsed);
    console.log(JSON.stringify({ batchSize: 50, durationMs: elapsed, activityRows: 50, staleBatch: 'no partial writes', transaction: 'rolling back' }));
    throw rollback;
  }, { maxWait: 30000, timeout: 180000 }); } catch (e) { if (e !== rollback) throw e; }
  assert.equal(await prisma.crmTask.count(), before);
  console.log(JSON.stringify({ preserved: before, fixturesPersisted: false }));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.onModuleDestroy());
