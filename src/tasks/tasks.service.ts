import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { Role } from "../common/types";

type ReqUser = { id: string; role: Role; email: string };

@Injectable()
export class TasksService {
  // ✅ IMPORTANT: must be `private prisma:` so it becomes this.prisma
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private ensureAuth(user: ReqUser) {
    if (!user?.id) throw new ForbiddenException("Unauthorized");
  }

  async listMy(user: ReqUser, q: { status?: string; range?: string }) {
    this.ensureAuth(user);

    const where: any = { assignedToId: user.id };

    if (q.status) where.status = q.status;

    const now = new Date();

    if (q.range === "today") {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      where.dueAt = { gte: start, lte: end };
      where.status = where.status ?? "OPEN";
    } else if (q.range === "overdue") {
      where.dueAt = { lt: now };
      where.status = where.status ?? "OPEN";
    } else if (q.range === "week") {
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      where.dueAt = { gte: now, lte: end };
      where.status = where.status ?? "OPEN";
    }

    return this.prisma.task.findMany({
      where,
      include: {
        lead: { select: { id: true, fullName: true, phone: true, status: true } },
      },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
  }

  async create(user: ReqUser, body: any) {
    this.ensureAuth(user);

    if (!body?.title || !body?.dueAt || !body?.assignedToId) {
      throw new BadRequestException("Missing fields: title, dueAt, assignedToId");
    }

    const dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new BadRequestException("Invalid dueAt");

    const task = await this.prisma.task.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        type: body.type ?? "FOLLOW_UP",
        status: "OPEN",
        priority: body.priority ?? "MEDIUM",
        dueAt,
        leadId: body.leadId ?? null,
        createdById: user.id,
        assignedToId: body.assignedToId,
      },
    });

    await this.audit.log(user, "TASK_CREATE", "Task", task.id, {
      assignedToId: task.assignedToId,
      leadId: task.leadId,
    });

    return task;
  }

  async markDone(user: ReqUser, id: string) {
    this.ensureAuth(user);

    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new BadRequestException("Task not found");

    const ok = task.assignedToId === user.id || user.role === "MANAGER" || user.role === "ADMIN";
    if (!ok) throw new ForbiddenException("No access");

    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: "DONE", doneAt: new Date() },
    });

    await this.audit.log(user, "TASK_DONE", "Task", id, {});
    return updated;
  }

  async cancel(user: ReqUser, id: string) {
    this.ensureAuth(user);

    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new BadRequestException("Task not found");

    const ok = task.createdById === user.id || user.role === "MANAGER" || user.role === "ADMIN";
    if (!ok) throw new ForbiddenException("No access");

    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    await this.audit.log(user, "TASK_CANCEL", "Task", id, {});
    return updated;
  }

  async listTeam(user: ReqUser, q: { status?: string; range?: string }) {
    this.ensureAuth(user);

    if (user.role !== "MANAGER" && user.role !== "ADMIN") {
      throw new ForbiddenException("No access");
    }

    const reps = await this.prisma.user.findMany({
      where: { managerId: user.id, isActive: true },
      select: { id: true },
    });

    const ids = reps.map((r) => r.id);
    if (ids.length === 0) return [];

    const where: any = { assignedToId: { in: ids } };
    if (q.status) where.status = q.status;

    const now = new Date();

    if (q.range === "today") {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      where.dueAt = { gte: start, lte: end };
      where.status = where.status ?? "OPEN";
    } else if (q.range === "overdue") {
      where.dueAt = { lt: now };
      where.status = where.status ?? "OPEN";
    } else if (q.range === "week") {
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      where.dueAt = { gte: now, lte: end };
      where.status = where.status ?? "OPEN";
    }

    return this.prisma.task.findMany({
      where,
      include: {
        lead: { select: { id: true, fullName: true, phone: true, status: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      take: 300,
    });
  }
}