/* All fixtures, notifications and audit records are rolled back. No customer records are changed. */
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaService } = require("../dist/src/prisma/prisma.service");
const { TasksService } = require("../dist/src/tasks/tasks.service");
const prisma = new PrismaService();
const rollback = new Error("ROLLBACK_WORK_TEST");
let checks = 0;
async function main() {
  const before = await prisma.crmTask.count();
  try {
    await prisma.$transaction(async (tx) => {
      let savepoint = 0;
      const db = new Proxy(tx, { get(target, key) {
        if (key === "$transaction") return async (fn) => {
          const name = "work_test_" + (++savepoint);
          await tx.$executeRawUnsafe("SAVEPOINT " + name);
          try { const result = await fn(tx); await tx.$executeRawUnsafe("RELEASE SAVEPOINT " + name); return result; }
          catch (e) { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT " + name); throw e; }
        };
        return target[key];
      } });
      const service = new TasksService(db, { emitNotificationToUser() {} });
      service.publish = async () => {};
      const actors = {};
      for (const [key, role] of Object.entries({ owner: "AFTERSALES", member: "ACCOUNTING", viewer: "SALES", outside: "CALLCENTER", admin: "ADMIN" })) {
        actors[key] = await tx.user.create({ data: { id: randomUUID(), email: randomUUID() + "@work-test.invalid", passwordHash: "not-a-login", name: "Work test " + key, role } });
      }
      const { owner, member, viewer, outside, admin } = actors;
      const expectReject = async (fn, code) => {
        await assert.rejects(fn, (e) => code ? (e.getResponse?.().code === code || e.code === code) : e.getStatus?.() >= 400);
        checks++; if (checks % 5 === 0) console.log(JSON.stringify({ checks }));
      };
      const definition = { key: "T" + randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase(), name: "Isolated work project", color: "#147d73", members: [{ userId: member.id, role: "MEMBER" }, { userId: viewer.id, role: "VIEWER" }] };
      const project = await service.createProject(owner, definition);
      const task = await service.create(owner, { title: "Contract review", projectId: project.id, assignedToId: member.id, priority: "URGENT", estimateMinutes: 120 });
      assert.equal((await service.getOne(member, task.id)).canEdit, true); checks++;
      assert.equal((await service.getOne(viewer, task.id)).canEdit, false); checks++;
      await expectReject(async () => service.getOne(outside, task.id));
      await expectReject(async () => service.getOne({ ...outside, role: "ADMIN" }, task.id));
      await expectReject(async () => service.update(viewer, task.id, { version: 1, title: "Unauthorized" }));
      assert.deepEqual((await service.workspace({ id: "preview", role: "PREVIEW" })).projects, []); checks++;
      await expectReject(async () => service.create({ id: "preview", role: "PREVIEW" }, { title: "No write" }));
      await expectReject(async () => service.create(owner, { title: "Invalid assignment", projectId: project.id, assignedToId: outside.id }), "WORK_ASSIGNEE_NOT_MEMBER");
      const detail = () => service.getOne(owner, task.id);
      const version = async (id = task.id) => (await tx.crmTask.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;
      let current = await detail();
      await service.update(member, task.id, { version: current.version, status: "IN_PROGRESS" });
      await expectReject(async () => service.update(owner, task.id, { version: current.version, title: "Stale" }), "WORK_VERSION_CONFLICT");
      await expectReject(async () => service.update(owner, task.id, { version: (2), startAt: "2026-09-20T00:00:00Z", dueAt: "2026-09-10T00:00:00Z" }), "WORK_DATE_ORDER");
      await service.checklist(member, task.id, { version: await version(), title: "Verify terms", done: false });
      await expectReject(async () => service.update(owner, task.id, { version: 3, status: "DONE" }), "WORK_UNFINISHED");
      const child = await service.create(owner, { title: "Legal review", projectId: project.id, parentId: task.id });
      const blocker = await service.create(owner, { title: "Supplier response", projectId: project.id });
      await service.dependency(owner, task.id, { version: await version(), blockerId: blocker.id });
      await expectReject(async () => service.dependency(owner, child.id, { version: 1, blockerId: task.id }), "WORK_DEPENDENCY_CYCLE");
      await expectReject(async () => service.dependency(owner, blocker.id, { version: await version(blocker.id), blockerId: task.id }), "WORK_DEPENDENCY_CYCLE");
      const comment = await service.comment(member, task.id, { version: await version(), body: "Verified the quotation" });
      await expectReject(async () => service.comment(owner, task.id, { version: await version(), body: "Someone else's comment" }, comment.id));
      await service.comment(member, task.id, { version: await version(), body: "Verified quotation and delivery date" }, comment.id);
      const time = await service.time(member, task.id, { version: await version(), minutes: 45, workedOn: "2026-09-09", note: "Review" });
      await service.time(member, task.id, { version: await version(), minutes: 60, workedOn: "2026-09-09", note: "Review and call" }, time.id);
      assert.equal((await detail()).spentMinutes, 60); checks++;
      const file = await service.upload(member, task.id, await version(), { originalname: "review.txt", size: 4, buffer: Buffer.from("test") });
      assert.equal(Buffer.from((await service.download(viewer, task.id, file.id)).content).toString(), "test"); checks++;
      await expectReject(async () => service.download(outside, task.id, file.id));
      assert(!JSON.stringify((await detail()).attachments).includes("content")); checks++;
      await expectReject(async () => service.updateProject(owner, project.id, { ...definition, version: 1, members: [] }), "WORK_MEMBER_ASSIGNED");
      await service.update(owner, child.id, { version: await version(child.id), status: "DONE" });
      await service.update(owner, blocker.id, { version: await version(blocker.id), status: "DONE" });
      current = await detail(); const check = current.checklist[0];
      await service.checklist(member, task.id, { version: current.version, title: check.title, done: true }, check.id);
      await service.update(member, task.id, { version: await version(), status: "DONE" });
      await expectReject(async () => service.update(owner, child.id, { version: await version(child.id), status: "TODO" }), "WORK_COMPLETED_DEPENDENT");
      const report = await service.report(owner, { projectId: project.id });
      assert.equal(report.total, 3); assert.equal(report.spentMinutes, 60); checks++;
      await service.archive(owner, child.id, { version: await version(child.id), archived: true });
      await service.archive(owner, task.id, { version: await version(), archived: true });
      await service.archive(owner, task.id, { version: await version(), archived: false });
      assert((await detail()).activity.some((e) => e.action === "ARCHIVED")); checks++;
      assert((await detail()).activity.some((e) => e.action === "FILE_ADDED")); checks++;
      assert((await detail()).activity.every((e) => !!e.actorName)); checks++;
      await tx.user.update({ where: { id: owner.id }, data: { isActive: false } });
      await expectReject(async () => service.workspace(owner));
      await tx.user.update({ where: { id: owner.id }, data: { isActive: true } });
      await service.archiveProject(admin, project.id, { version: 1, archived: true });
      await expectReject(async () => service.create(member, { title: "Archived project", projectId: project.id }), "WORK_ARCHIVED");
      const anon = await tx.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE relname = 'WorkAttachment'`;
      assert.equal(anon[0].relrowsecurity, true); checks++;
      console.log(JSON.stringify({ checks, fixtureTasks: 3, history: (await detail()).activity.length, transaction: "rolling back" }));
      throw rollback;
    }, { maxWait: 30000, timeout: 600000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal(await prisma.crmTask.count(), before);
  console.log(JSON.stringify({ passed: checks, existingTasksPreserved: before, fixtureDataPersisted: false }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.onModuleDestroy());
