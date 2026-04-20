import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { Role } from "../common/types";

type ReqUser = { id: string; role: Role; email: string };

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  private ensureAuth(user: ReqUser) {
    if (!user?.id) throw new ForbiddenException("Unauthorized");
  }

  private isAdmin(user: ReqUser) {
    return user.role === "ADMIN";
  }

  private isManager(user: ReqUser) {
    return user.role === "MANAGER" || user.role === "ADMIN";
  }

  private isSales(user: ReqUser) {
    return user.role === "SALES";
  }

  private cleanStr(v?: string | null) {
    const x = (v ?? "").trim();
    return x || null;
  }

  private includeTaskRelations() {
    return {
      lead: {
        select: { id: true, fullName: true, phone: true, status: true },
      },
      agency: {
        select: { id: true, name: true },
      },
      customer: {
        select: { id: true, fullName: true, companyName: true },
      },
      assignedTo: {
        select: { id: true, name: true, email: true, role: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
    };
  }

  private buildRangeWhere(range?: string, status?: string) {
    const where: any = {};
    const now = new Date();

    if (status) {
      where.status = status;
    }

    if (range === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);

      where.dueAt = { gte: start, lte: end };

      if (!status) {
        where.status = { in: ["TODO", "IN_PROGRESS"] };
      }
    } else if (range === "overdue") {
      where.dueAt = { lt: now };

      if (!status) {
        where.status = { in: ["TODO", "IN_PROGRESS"] };
      }
    } else if (range === "week") {
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      where.dueAt = { gte: now, lte: end };

      if (!status) {
        where.status = { in: ["TODO", "IN_PROGRESS"] };
      }
    }

    return where;
  }

  private async validateAssignedUser(assignedToId?: string | null) {
    if (!assignedToId) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: {
        id: true,
        role: true,
        isActive: true,
        name: true,
        email: true,
      },
    });

    if (!user || !user.isActive) {
      throw new BadRequestException("Assigned user not found or inactive");
    }

    return user;
  }

private async validateRelations(body: any) {
  if (body.leadId) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: body.leadId },
      select: { id: true },
    });

    if (!lead) {
      throw new BadRequestException("Lead not found");
    }
  }

  if (body.agencyId) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: body.agencyId },
      select: { id: true },
    });

    if (!agency) {
      throw new BadRequestException("Agency not found");
    }
  }

  if (body.customerId) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: body.customerId },
      select: { id: true },
    });

    if (!customer) {
      throw new BadRequestException("Customer not found");
    }
  }

  await this.validateAssignedUser(body.assignedToId);
}

  private buildTaskLink(task: { id: string }) {
    return `/tasks/${task.id}`;
  }

  private buildTaskMessage(task: {
    title: string;
    lead?: { fullName?: string | null } | null;
    agency?: { name?: string | null } | null;
    customer?: { fullName?: string | null } | null;
  }) {
    const related = [
      task.lead?.fullName,
      task.customer?.fullName,
      task.agency?.name,
    ].filter(Boolean);

    return related.length ? `${task.title} • ${related.join(" • ")}` : task.title;
  }

  async listMy(
    user: ReqUser,
    q: { status?: string; range?: string; search?: string },
  ) {
    this.ensureAuth(user);

    const where: any = {
      assignedToId: user.id,
      ...this.buildRangeWhere(q?.range, q?.status),
    };

    const search = this.cleanStr(q?.search);
    if (search) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { lead: { fullName: { contains: search, mode: "insensitive" } } },
          { agency: { name: { contains: search, mode: "insensitive" } } },
          { customer: { fullName: { contains: search, mode: "insensitive" } } },
          { createdBy: { name: { contains: search, mode: "insensitive" } } },
        ],
      });
    }

    return this.prisma.crmTask.findMany({
      where,
      include: this.includeTaskRelations(),
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      take: 300,
    });
  }

  async listAll(
  user: ReqUser,
  q: {
    status?: string;
    range?: string;
    search?: string;
    assignedToId?: string;
    agencyId?: string;
  },
) {
    this.ensureAuth(user);

    if (!this.isManager(user)) {
      throw new ForbiddenException("No access");
    }

    
    const where: any = {
      ...this.buildRangeWhere(q?.range, q?.status),
    };

    if (q?.assignedToId) {
      where.assignedToId = q.assignedToId;
    }


    if (q?.agencyId) {
  where.agencyId = q.agencyId;
}




    const search = this.cleanStr(q?.search);
    if (search) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { lead: { fullName: { contains: search, mode: "insensitive" } } },
          { agency: { name: { contains: search, mode: "insensitive" } } },
          { customer: { fullName: { contains: search, mode: "insensitive" } } },
          { assignedTo: { name: { contains: search, mode: "insensitive" } } },
          { createdBy: { name: { contains: search, mode: "insensitive" } } },
        ],
      });
    }

    return this.prisma.crmTask.findMany({
      where,
      include: this.includeTaskRelations(),
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  async getOne(user: ReqUser, id: string) {
    this.ensureAuth(user);

    const task = await this.prisma.crmTask.findUnique({
      where: { id },
      include: this.includeTaskRelations(),
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const canAccess =
      this.isManager(user) ||
      task.assignedToId === user.id ||
      task.createdById === user.id;

    if (!canAccess) {
      throw new ForbiddenException("No access");
    }


    console.log("TASK ACCESS CHECK", {
  taskId: task.id,
  userId: user.id,
  userRole: user.role,
  assignedToId: task.assignedToId,
  createdById: task.createdById,
});

    return task;
  }

async create(user: ReqUser, body: any) {
  this.ensureAuth(user);

  const canCreate =
    this.isManager(user) ||
    this.isSales(user) ||
    user.role === "CALLCENTER";

  if (!canCreate) {
    throw new ForbiddenException("No access to create task");
  }

  if (this.isSales(user) || user.role === "CALLCENTER") {
    body.assignedToId = user.id;
  }

  if (!body?.title || !body?.assignedToId) {
    throw new BadRequestException("Missing fields: title, assignedToId");
  }

  let dueAt: Date | null = null;
  if (body?.dueAt) {
    dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      throw new BadRequestException("Invalid dueAt");
    }
  }

  const assignedUser = await this.validateAssignedUser(body.assignedToId);
  await this.validateRelations(body);

  const task = await this.prisma.crmTask.create({
    data: {
      title: body.title.trim(),
      description: this.cleanStr(body.description),
      status: body.status ?? "TODO",
      priority: body.priority ?? "MEDIUM",
      dueAt,
      leadId: body.leadId ?? null,
      agencyId: body.agencyId ?? null,
      customerId: body.customerId ?? null,
      createdById: user.id,
      assignedToId: body.assignedToId ?? null,
    },
    include: this.includeTaskRelations(),
  });

  await this.audit.log(user, "CRM_TASK_CREATE", "CrmTask", task.id, {
    assignedToId: task.assignedToId,
    leadId: task.leadId,
    agencyId: task.agencyId,
    customerId: task.customerId,
  });

  if (task.assignedToId) {
    await this.notifications.createForUser({
      userId: task.assignedToId,
      type: "TASK_ASSIGNED",
      title: "Yeni görev atandı",
      message: this.buildTaskMessage(task),
      entityType: "CrmTask",
      entityId: task.id,
      link: this.buildTaskLink(task),
      metaJson: {
        taskId: task.id,
        title: task.title,
        leadId: task.leadId,
        agencyId: task.agencyId,
        customerId: task.customerId,
        createdById: task.createdById,
        assignedToName: assignedUser?.name ?? null,
      },
    });
  }

  return task;
}

  async update(user: ReqUser, id: string, body: any) {
    this.ensureAuth(user);

    const task = await this.prisma.crmTask.findUnique({
      where: { id },
      include: this.includeTaskRelations(),
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const managerCanEdit = this.isManager(user);
    const assigneeCanEdit = task.assignedToId === user.id;
    const creatorCanEdit = task.createdById === user.id;

    if (!managerCanEdit && !assigneeCanEdit && !creatorCanEdit) {
      throw new ForbiddenException("No access");
    }

    const previousAssignedToId = task.assignedToId;
    const previousStatus = task.status;

    const data: any = {};

    if (body.status !== undefined) {
      data.status = body.status;

      if (body.status === "DONE") {
        data.completedAt = new Date();
      } else {
        data.completedAt = null;
      }
    }

    if (managerCanEdit) {
      if (body.title !== undefined) {
        const title = this.cleanStr(body.title);
        if (!title) {
          throw new BadRequestException("Task title is required");
        }
        data.title = title;
      }

      if (body.description !== undefined) {
        data.description = this.cleanStr(body.description);
      }

      if (body.priority !== undefined) {
        data.priority = body.priority;
      }

      if (body.dueAt !== undefined) {
        if (!body.dueAt) {
          data.dueAt = null;
        } else {
          const dueAt = new Date(body.dueAt);
          if (Number.isNaN(dueAt.getTime())) {
            throw new BadRequestException("Invalid dueAt");
          }
          data.dueAt = dueAt;
        }
      }

      if (body.assignedToId !== undefined) {
        if (!body.assignedToId) {
          data.assignedToId = null;
        } else {
          await this.validateAssignedUser(body.assignedToId);
          data.assignedToId = body.assignedToId;
        }
      }

      if (body.leadId !== undefined) {
        if (!body.leadId) {
          data.leadId = null;
        } else {
          const lead = await this.prisma.lead.findUnique({
            where: { id: body.leadId },
            select: { id: true },
          });
          if (!lead) throw new BadRequestException("Lead not found");
          data.leadId = body.leadId;
        }
      }

      if (body.agencyId !== undefined) {
        if (!body.agencyId) {
          data.agencyId = null;
        } else {
          const agency = await this.prisma.agency.findUnique({
            where: { id: body.agencyId },
            select: { id: true },
          });
          if (!agency) throw new BadRequestException("Agency not found");
          data.agencyId = body.agencyId;
        }
      }

      if (body.customerId !== undefined) {
        if (!body.customerId) {
          data.customerId = null;
        } else {
          const customer = await this.prisma.customer.findUnique({
            where: { id: body.customerId },
            select: { id: true },
          });
          if (!customer) throw new BadRequestException("Customer not found");
          data.customerId = body.customerId;
        }
      }

      const nextLeadId =
        body.leadId !== undefined ? data.leadId ?? null : task.leadId ?? null;
      const nextAgencyId =
        body.agencyId !== undefined
          ? data.agencyId ?? null
          : task.agencyId ?? null;
      const nextCustomerId =
        body.customerId !== undefined
          ? data.customerId ?? null
          : task.customerId ?? null;

    
    }

    const updated = await this.prisma.crmTask.update({
      where: { id },
      data,
      include: this.includeTaskRelations(),
    });

    await this.audit.log(user, "CRM_TASK_UPDATE", "CrmTask", id, {
      status: updated.status,
      assignedToId: updated.assignedToId,
      leadId: updated.leadId,
      agencyId: updated.agencyId,
      customerId: updated.customerId,
    });

    if (
      updated.assignedToId &&
      updated.assignedToId !== previousAssignedToId
    ) {
      await this.notifications.createForUser({
        userId: updated.assignedToId,
        type: "TASK_ASSIGNED",
        title: "Size görev atandı",
        message: this.buildTaskMessage(updated),
        entityType: "CrmTask",
        entityId: updated.id,
        link: this.buildTaskLink(updated),
        metaJson: {
          taskId: updated.id,
          title: updated.title,
          assignedToId: updated.assignedToId,
          createdById: updated.createdById,
        },
      });
    }

    if (
      updated.assignedToId &&
      updated.assignedToId === previousAssignedToId &&
      (
        previousStatus !== updated.status ||
        task.title !== updated.title ||
        task.description !== updated.description ||
        task.priority !== updated.priority ||
        String(task.dueAt ?? "") !== String(updated.dueAt ?? "")
      )
    ) {
      await this.notifications.createForUser({
        userId: updated.assignedToId,
        type: "TASK_UPDATED",
        title: "Görev güncellendi",
        message: this.buildTaskMessage(updated),
        entityType: "CrmTask",
        entityId: updated.id,
        link: this.buildTaskLink(updated),
        metaJson: {
          taskId: updated.id,
          status: updated.status,
          previousStatus,
        },
      });
    }

    return updated;
  }

  async markDone(user: ReqUser, id: string) {
    this.ensureAuth(user);

    const task = await this.prisma.crmTask.findUnique({
      where: { id },
      include: this.includeTaskRelations(),
    });

    if (!task) {
      throw new BadRequestException("Task not found");
    }

    const ok = task.assignedToId === user.id || this.isManager(user);
    if (!ok) {
      throw new ForbiddenException("No access");
    }

    const updated = await this.prisma.crmTask.update({
      where: { id },
      data: { status: "DONE", completedAt: new Date() },
      include: this.includeTaskRelations(),
    });

    await this.audit.log(user, "CRM_TASK_DONE", "CrmTask", id, {});

    if (updated.createdById && updated.createdById !== user.id) {
      await this.notifications.createForUser({
        userId: updated.createdById,
        type: "TASK_UPDATED",
        title: "Görev tamamlandı",
        message: this.buildTaskMessage(updated),
        entityType: "CrmTask",
        entityId: updated.id,
        link: this.buildTaskLink(updated),
        metaJson: {
          taskId: updated.id,
          completedById: user.id,
          status: updated.status,
        },
      });
    }

    return updated;
  }

  async cancel(user: ReqUser, id: string) {
    this.ensureAuth(user);

    const task = await this.prisma.crmTask.findUnique({
      where: { id },
      include: this.includeTaskRelations(),
    });

    if (!task) {
      throw new BadRequestException("Task not found");
    }

    const ok = task.createdById === user.id || this.isManager(user);
    if (!ok) {
      throw new ForbiddenException("No access");
    }

    const updated = await this.prisma.crmTask.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: this.includeTaskRelations(),
    });

    await this.audit.log(user, "CRM_TASK_CANCEL", "CrmTask", id, {});

    if (updated.assignedToId && updated.assignedToId !== user.id) {
      await this.notifications.createForUser({
        userId: updated.assignedToId,
        type: "TASK_UPDATED",
        title: "Görev iptal edildi",
        message: this.buildTaskMessage(updated),
        entityType: "CrmTask",
        entityId: updated.id,
        link: this.buildTaskLink(updated),
        metaJson: {
          taskId: updated.id,
          cancelledById: user.id,
          status: updated.status,
        },
      });
    }

    return updated;
  }

  async listTeam(
    user: ReqUser,
    q: { status?: string; range?: string; search?: string },
  ) {
    this.ensureAuth(user);

    if (!this.isManager(user)) {
      throw new ForbiddenException("No access");
    }

    const reps = await this.prisma.user.findMany({
      where: { managerId: user.id, isActive: true },
      select: { id: true },
    });

    const ids = reps.map((r) => r.id);
    if (ids.length === 0) return [];

    const where: any = {
      assignedToId: { in: ids },
      ...this.buildRangeWhere(q?.range, q?.status),
    };

    const search = this.cleanStr(q?.search);
    if (search) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { lead: { fullName: { contains: search, mode: "insensitive" } } },
          { agency: { name: { contains: search, mode: "insensitive" } } },
          { customer: { fullName: { contains: search, mode: "insensitive" } } },
          { assignedTo: { name: { contains: search, mode: "insensitive" } } },
        ],
      });
    }

    return this.prisma.crmTask.findMany({
      where,
      include: this.includeTaskRelations(),
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      take: 300,
    });
  }
}