/* Notification access and deletion safety; all fixture changes are rolled back. */
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaService } = require('../dist/src/prisma/prisma.service');
const { TasksService } = require('../dist/src/tasks/tasks.service');
const { UsersController } = require('../dist/src/users/users.controller');
const prisma = new PrismaService();
const rollback = new Error('ROLLBACK_WORK_RETENTION');
async function main() {
  const before = await prisma.crmTask.count();
  try {
    await prisma.$transaction(async (tx) => {
      const actors = [];
      for (const role of ['ADMIN', 'ACCOUNTING', 'AFTERSALES']) {
        actors.push(await tx.user.create({ data: {
          id: randomUUID(), email: randomUUID() + '@work-test.invalid',
          name: 'Work retention fixture', role, passwordHash: 'not-a-login',
        } }));
      }
      const [owner, current, former] = actors;
      const task = await tx.crmTask.create({ data: { title: 'Private reassigned work', createdById: owner.id, assignedToId: current.id } });
      await tx.workWatcher.create({ data: { taskId: task.id, userId: former.id } });
      const service = new TasksService(tx, { emitNotificationToUser() {} });
      await service.log(tx, owner, task, 'UPDATED', {});
      const notifications = await tx.notification.findMany({ where: { entityId: task.id }, select: { userId: true } });
      assert.deepEqual(notifications.map((n) => n.userId), [current.id]);
      await tx.user.update({ where: { id: current.id }, data: { isActive: false } });
      const fields = await service.fields(tx, owner, { title: 'Historical assignment retained', assignedToId: current.id }, null, task);
      assert.equal(fields.assignedToId, current.id);
      const db = new Proxy(tx, { get(target, key) { return key === '$transaction' ? async (fn) => fn(tx) : target[key]; } });
      const controller = new UsersController(db);
      await assert.rejects(() => controller.forceDeleteUser({ user: { sub: owner.id } }, current.id),
        (e) => e.getStatus?.() === 409 && e.getResponse().code === 'WORK_USER_HAS_RECORDS');
      assert.equal(await tx.crmTask.count({ where: { id: task.id } }), 1);
      assert.equal(await tx.user.count({ where: { id: current.id } }), 1);
      console.log(JSON.stringify({ notificationPrivacy: 'passed', inactiveAssignee: 'passed', deletionRetention: 'passed', transaction: 'rolling back' }));
      throw rollback;
    }, { maxWait: 30000, timeout: 120000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal(await prisma.crmTask.count(), before);
  console.log(JSON.stringify({ existingTasksPreserved: before, fixtureDataPersisted: false }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.onModuleDestroy());
