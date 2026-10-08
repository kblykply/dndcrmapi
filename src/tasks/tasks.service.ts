import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  CrmTask,
  WorkProject,
  Role,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import {
  ArchiveDto,
  BulkTaskDto,
  ChecklistDto,
  CommentDto,
  CreateTaskDto,
  DependencyDto,
  ProjectDto,
  TaskFieldsDto,
  TaskQueryDto,
  TimeEntryDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './tasks.dto';
import {
  checkVersion,
  closedStatuses,
  safeFile,
  validDates,
  wouldCycle,
} from './work-rules';

export type WorkUser = {
  id: string;
  role: string;
  originalRole?: string;
  isPreview?: boolean;
};
type Actor = { id: string; name: string; role: Role; isActive: boolean };
type Tx = Prisma.TransactionClient;
const person = {
  id: true,
  name: true,
  isActive: true,
} satisfies Prisma.UserSelect;
const projectInclude = {
  members: { include: { user: { select: person } } },
  owner: { select: person },
  department: { select: { id: true, name: true } },
} satisfies Prisma.WorkProjectInclude;
type Project = Prisma.WorkProjectGetPayload<{ include: typeof projectInclude }>;
const brief = {
  id: true,
  title: true,
  status: true,
  version: true,
  archivedAt: true,
  assignedToId: true,
} satisfies Prisma.CrmTaskSelect;
const itemInclude = {
  assignedTo: { select: person },
  createdBy: { select: person },
  project: { include: projectInclude },
  agency: { select: { id: true, name: true } },
  customer: { select: { id: true, fullName: true } },
  lead: { select: { id: true, fullName: true } },
  parent: { select: { ...brief, createdById: true } },
  _count: { select: { comments: true, attachments: true, subtasks: true } },
  checklist: {
    select: { id: true, title: true, done: true },
    orderBy: { createdAt: 'asc' as const },
  },
  blockers: { include: { blocker: { select: brief } } },
  timeEntries: { select: { minutes: true } },
} satisfies Prisma.CrmTaskInclude;
type Item = Prisma.CrmTaskGetPayload<{ include: typeof itemInclude }>;
const fileSelect = {
  id: true,
  name: true,
  size: true,
  userId: true,
  userName: true,
  createdAt: true,
} satisfies Prisma.WorkAttachmentSelect;
const clean = (value?: string | null) => value?.trim() || null;
const manager = (user: WorkUser) => ['ADMIN', 'MANAGER'].includes(user.role);
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const error = (code: string, message: string): never => {
  throw new BadRequestException({ code, message });
};

@Injectable()
export class TasksService {
  private readonly db: PrismaClient;
  private readonly logger = new Logger(TasksService.name);
  constructor(
    prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {
    this.db = prisma as unknown as PrismaClient;
  }

  private preview(user: WorkUser) {
    return (
      user.role === 'PREVIEW' ||
      user.originalRole === 'PREVIEW' ||
      user.isPreview
    );
  }
  private async actor(user: WorkUser, tx: Tx = this.db): Promise<Actor> {
    if (!user?.id || this.preview(user))
      throw new ForbiddenException('Read-only preview account');
    const actor = await tx.user.findUnique({
      where: { id: user.id },
      select: { ...person, role: true },
    });
    if (!actor?.isActive || actor.role === 'PREVIEW')
      throw new ForbiddenException('An active account is required');
    return actor;
  }
  private projectWhere(actor: WorkUser): Prisma.WorkProjectWhereInput {
    return manager(actor)
      ? {}
      : {
          OR: [
            { ownerId: actor.id },
            { members: { some: { userId: actor.id } } },
          ],
        };
  }
  private accessWhere(actor: WorkUser): Prisma.CrmTaskWhereInput {
    if (manager(actor)) return {};
    const personal: Prisma.CrmTaskWhereInput[] = [
      { assignedToId: actor.id },
      { createdById: actor.id },
      {
        parent: { OR: [{ assignedToId: actor.id }, { createdById: actor.id }] },
      },
    ];
    if (actor.role === 'SALES')
      personal.push(
        { agency: { assignedSalesId: actor.id } },
        { customer: { ownerId: actor.id } },
      );
    return {
      OR: [
        { project: this.projectWhere(actor) },
        { projectId: null, OR: personal },
      ],
    };
  }
  private canManageProject(actor: WorkUser, project: Project) {
    return (
      manager(actor) ||
      project.ownerId === actor.id ||
      project.members.some((m) => m.userId === actor.id && m.role === 'LEAD')
    );
  }
  private canEdit(actor: WorkUser, task: Item) {
    if (task.archivedAt || task.project?.archivedAt) return false;
    if (manager(actor)) return true;
    if (task.project)
      return (
        task.project.ownerId === actor.id ||
        task.project.members.some(
          (m) => m.userId === actor.id && m.role !== 'VIEWER',
        )
      );
    return (
      task.createdById === actor.id ||
      task.assignedToId === actor.id ||
      task.parent?.createdById === actor.id ||
      task.parent?.assignedToId === actor.id
    );
  }
  private canArchive(actor: WorkUser, task: Item) {
    return (
      manager(actor) ||
      (task.project
        ? this.canManageProject(actor, task.project)
        : task.createdById === actor.id)
    );
  }
  private present(task: Item, actor: WorkUser) {
    const { timeEntries, ...rest } = task;
    return {
      ...rest,
      spentMinutes: timeEntries.reduce((sum, entry) => sum + entry.minutes, 0),
      canEdit: this.canEdit(actor, task),
      canArchive: this.canArchive(actor, task),
    };
  }
  private async task(tx: Tx, actor: WorkUser, id: string) {
    const task = await tx.crmTask.findFirst({
      where: { id, AND: [this.accessWhere(actor)] },
      include: itemInclude,
    });
    if (!task) throw new NotFoundException('Work item not found');
    return task;
  }
  private async project(tx: Tx, actor: WorkUser, id: string, edit = false) {
    const project = await tx.workProject.findFirst({
      where: { id, AND: [this.projectWhere(actor)] },
      include: projectInclude,
    });
    if (!project) throw new NotFoundException('Work project not found');
    if (
      edit &&
      !(
        this.canManageProject(actor, project) ||
        project.members.some(
          (m) => m.userId === actor.id && m.role === 'MEMBER',
        )
      )
    )
      throw new ForbiddenException('This project is read-only');
    return project;
  }

  private async write<T>(
    user: WorkUser,
    key: string,
    operation: (tx: Tx, actor: Actor) => Promise<T>,
  ) {
    const result = await this.db.$transaction(
      async (tx) => {
        // Project membership, dependencies and completion must be checked in the same serialized write.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'work:' + key}))`;
        return operation(tx, await this.actor(user, tx));
      },
      { maxWait: 30000, timeout: 30000 },
    );
    return result;
  }
  private async notificationAudience(
    tx: Tx,
    tasks: CrmTask[],
    candidates: string[],
  ) {
    const audience = new Map(tasks.map((task) => [task.id, new Set<string>()]));
    if (!candidates.length) return audience;
    const projectId = tasks[0].projectId;
    const users = await tx.user.findMany({
      where: {
        id: { in: candidates },
        isActive: true,
        role: { not: 'PREVIEW' },
        ...(projectId
          ? {
              OR: [
                { role: { in: ['ADMIN', 'MANAGER'] } },
                { workProjectsOwned: { some: { id: projectId } } },
                { workMemberships: { some: { projectId } } },
              ],
            }
          : {}),
      },
      select: { id: true, role: true },
    });
    if (projectId) {
      for (const task of tasks)
        audience.set(task.id, new Set(users.map((u) => u.id)));
      return audience;
    }
    // A watcher may have lost access after reassignment or a CRM ownership change.
    const personal = await tx.crmTask.findMany({
      where: { id: { in: tasks.map((task) => task.id) } },
      select: {
        id: true,
        assignedToId: true,
        createdById: true,
        parent: { select: { assignedToId: true, createdById: true } },
        agency: { select: { assignedSalesId: true } },
        customer: { select: { ownerId: true } },
      },
    });
    for (const task of personal) {
      audience.set(
        task.id,
        new Set(
          users
            .filter(
              (u) =>
                manager(u) ||
                [
                  task.assignedToId,
                  task.createdById,
                  task.parent?.assignedToId,
                  task.parent?.createdById,
                ].includes(u.id) ||
                (u.role === 'SALES' &&
                  [
                    task.agency?.assignedSalesId,
                    task.customer?.ownerId,
                  ].includes(u.id)),
            )
            .map((u) => u.id),
        ),
      );
    }
    return audience;
  }
  private async log(
    tx: Tx,
    actor: Actor,
    task: CrmTask,
    action: string,
    changes: unknown,
    notify = true,
  ) {
    await tx.workActivity.create({
      data: {
        taskId: task.id,
        actorId: actor.id,
        actorName: actor.name,
        action,
        changes: json(changes),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'TASK_' + action,
        entityType: 'CrmTask',
        entityId: task.id,
        metaJson: json(changes),
      },
    });
    if (!notify) return;
    const watchers = await tx.workWatcher.findMany({
      where: { taskId: task.id },
      select: { userId: true },
    });
    const ids = [
      ...new Set([
        task.assignedToId,
        task.createdById,
        ...watchers.map((w) => w.userId),
      ]),
    ].filter((id): id is string => !!id && id !== actor.id);
    const audience = await this.notificationAudience(tx, [task], ids);
    const allowed = [...audience.get(task.id)!];
    if (allowed.length)
      await tx.notification.createMany({
        data: allowed.map((id) => ({
          userId: id,
          type: 'TASK_UPDATED',
          title: task.title,
          message: actor.name + ' · ' + action,
          entityType: 'CrmTask',
          entityId: task.id,
          link: '/tasks/' + task.id,
          metaJson: { action },
        })),
      });
  }
  private async publish(taskId: string | string[], since: Date) {
    // Notifications are already durable. Socket failure must not turn a committed save into HTTP 500.
    try {
      const rows = await this.db.notification.findMany({
        where: {
          entityType: 'CrmTask',
          entityId: Array.isArray(taskId) ? { in: taskId } : taskId,
          createdAt: { gte: since },
        },
        take: 1000,
      });
      for (const row of rows)
        this.gateway.emitNotificationToUser(row.userId, row);
    } catch {
      this.logger.warn('Task saved; live notification delivery unavailable');
    }
  }
  private async mutation<T>(
    user: WorkUser,
    id: string,
    version: number,
    operation: (tx: Tx, actor: Actor, task: Item) => Promise<T>,
    allowArchive = false,
  ) {
    const actor = await this.actor(user);
    const current = await this.db.crmTask.findFirst({
      where: { id, AND: [this.accessWhere(actor)] },
      select: { projectId: true },
    });
    if (!current) throw new NotFoundException('Work item not found');
    const since = new Date();
    const result = await this.write(
      user,
      current.projectId || 'personal',
      async (tx, actor) => {
        const task = await this.task(tx, actor, id);
        checkVersion(task.version, version);
        if (
          allowArchive
            ? !this.canArchive(actor, task)
            : !this.canEdit(actor, task)
        )
          throw new ForbiddenException('You cannot change this work item');
        const result = await operation(tx, actor, task);
        await tx.crmTask.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        return result;
      },
    );
    void this.publish(id, since);
    return result;
  }
  private where(
    actor: WorkUser,
    query: TaskQueryDto,
  ): Prisma.CrmTaskWhereInput {
    const AND: Prisma.CrmTaskWhereInput[] = [this.accessWhere(actor)];
    if (query.projectId)
      AND.push(
        query.projectId === 'personal'
          ? { projectId: null }
          : { projectId: query.projectId },
      );
    if (query.scope === 'my') AND.push({ assignedToId: actor.id });
    if (query.scope === 'created') AND.push({ createdById: actor.id });
    if (query.scope === 'watching')
      AND.push({ watchers: { some: { userId: actor.id } } });
    if (query.assignedToId)
      AND.push({
        assignedToId:
          query.assignedToId === 'unassigned' ? null : query.assignedToId,
      });
    if (query.agencyId) AND.push({ agencyId: query.agencyId });
    if (query.customerId) AND.push({ customerId: query.customerId });
    if (query.departmentId)
      AND.push({ project: { departmentId: query.departmentId } });
    if (query.label) AND.push({ labels: { has: query.label } });
    if (query.status) AND.push({ status: query.status });
    if (query.priority) AND.push({ priority: query.priority });
    if (query.archived === 'true')
      AND.push({
        OR: [
          { archivedAt: { not: null } },
          { project: { archivedAt: { not: null } } },
        ],
      });
    else
      AND.push({
        archivedAt: null,
        OR: [{ projectId: null }, { project: { archivedAt: null } }],
      });
    const now = new Date();
    if (query.range === 'overdue')
      AND.push({
        dueAt: { lt: now },
        status: { notIn: ['DONE', 'CANCELLED'] },
      });
    if (query.range === 'week' || query.range === 'today') {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      const until = new Date(from);
      until.setDate(until.getDate() + (query.range === 'week' ? 7 : 1));
      AND.push({ dueAt: { gte: from, lt: until } });
    }
    if (query.search?.trim())
      AND.push({
        OR: ['title', 'description'].map((field) => ({
          [field]: { contains: query.search!.trim(), mode: 'insensitive' },
        })),
      });
    return { AND };
  }

  async workspace(user: WorkUser) {
    if (this.preview(user))
      return { projects: [], users: [], departments: [], me: null };
    const actor = await this.actor(user);
    const [projects, users, departments] = await Promise.all([
      this.db.workProject.findMany({
        where: this.projectWhere(actor),
        include: projectInclude,
        orderBy: { name: 'asc' },
      }),
      this.db.user.findMany({
        where: { isActive: true, role: { not: 'PREVIEW' } },
        select: person,
        orderBy: { name: 'asc' },
      }),
      this.db.orgChartNode.findMany({
        where: {
          kind: { in: ['DEPARTMENT', 'TEAM'] },
          status: { not: 'ARCHIVED' },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      projects: projects.map((p) => ({
        ...p,
        canManage: this.canManageProject(actor, p),
        canEdit:
          !p.archivedAt &&
          (this.canManageProject(actor, p) ||
            p.members.some(
              (m) => m.userId === actor.id && m.role === 'MEMBER',
            )),
      })),
      users,
      departments,
      me: actor,
    };
  }
  async listAll(user: WorkUser, query: TaskQueryDto) {
    if (this.preview(user)) return { items: [], total: 0 };
    const actor = await this.actor(user);
    const where = this.where(actor, query);
    const [rows, total] = await Promise.all([
      this.db.crmTask.findMany({
        where,
        include: itemInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.db.crmTask.count({ where }),
    ]);
    return { items: rows.map((r) => this.present(r, actor)), total };
  }
  async listMy(user: WorkUser, query: TaskQueryDto) {
    return (await this.listAll(user, { ...query, scope: 'my' })).items;
  }
  async listTeam(user: WorkUser, query: TaskQueryDto) {
    return (await this.listAll(user, query)).items;
  }

  async report(user: WorkUser, query: TaskQueryDto) {
    if (this.preview(user))
      return {
        total: 0,
        overdue: 0,
        status: [],
        priority: [],
        workload: [],
        due: [],
        estimateMinutes: 0,
        spentMinutes: 0,
      };
    const actor = await this.actor(user);
    const where = this.where(actor, query);
    const [status, priority, workload, overdue, total, duration, spent, due] =
      await Promise.all([
        this.db.crmTask.groupBy({ by: ['status'], where, _count: true }),
        this.db.crmTask.groupBy({ by: ['priority'], where, _count: true }),
        this.db.crmTask.groupBy({
          by: ['assignedToId', 'status'],
          where,
          _count: true,
          _sum: { estimateMinutes: true },
        }),
        this.db.crmTask.count({
          where: {
            AND: [
              where,
              {
                dueAt: { lt: new Date() },
                status: { notIn: ['DONE', 'CANCELLED'] },
              },
            ],
          },
        }),
        this.db.crmTask.count({ where }),
        this.db.crmTask.aggregate({ where, _sum: { estimateMinutes: true } }),
        this.db.workTimeEntry.aggregate({
          where: { task: where },
          _sum: { minutes: true },
        }),
        this.db.crmTask.findMany({
          where: {
            AND: [
              where,
              {
                dueAt: { not: null },
                status: { notIn: ['DONE', 'CANCELLED'] },
              },
            ],
          },
          select: {
            id: true,
            title: true,
            dueAt: true,
            status: true,
            priority: true,
            assignedTo: { select: person },
          },
          orderBy: { dueAt: 'asc' },
          take: 20,
        }),
      ]);
    return {
      total,
      overdue,
      status,
      priority,
      workload,
      due,
      estimateMinutes: duration._sum.estimateMinutes || 0,
      spentMinutes: spent._sum.minutes || 0,
    };
  }
  async getOne(user: WorkUser, id: string) {
    if (this.preview(user)) return null;
    const actor = await this.actor(user);
    const task = await this.task(this.db, actor, id);
    const [
      comments,
      timeEntries,
      attachments,
      activity,
      subtasks,
      blocking,
      watching,
    ] = await Promise.all([
      this.db.workComment.findMany({
        where: { taskId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.workTimeEntry.findMany({
        where: { taskId: id },
        orderBy: [{ workedOn: 'desc' }, { createdAt: 'desc' }],
      }),
      this.db.workAttachment.findMany({
        where: { taskId: id },
        select: fileSelect,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.workActivity.findMany({
        where: { taskId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.db.crmTask.findMany({
        where: { parentId: id, AND: [this.accessWhere(actor)] },
        select: brief,
        orderBy: { createdAt: 'asc' },
      }),
      this.db.workDependency.findMany({
        where: { blockerId: id, task: this.accessWhere(actor) },
        include: { task: { select: brief } },
      }),
      this.db.workWatcher.count({ where: { taskId: id, userId: actor.id } }),
    ]);
    return {
      ...this.present(task, actor),
      comments,
      timeEntries,
      attachments,
      activity,
      subtasks,
      blocking,
      watching: !!watching,
      me: actor,
    };
  }
  async history(user: WorkUser, id: string, skip = 0) {
    if (this.preview(user)) return [];
    const actor = await this.actor(user);
    await this.task(this.db, actor, id);
    return this.db.workActivity.findMany({
      where: { taskId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: 50,
    });
  }

  private async validateProject(
    tx: Tx,
    dto: ProjectDto,
    ownerId: string,
    current?: Project,
  ) {
    const members = dto.members.filter((m) => m.userId !== ownerId);
    if (new Set(members.map((m) => m.userId)).size !== members.length)
      error('WORK_DUPLICATE_MEMBER', 'Select each member once');
    const count = await tx.user.count({
      where: {
        id: { in: members.map((m) => m.userId) },
        isActive: true,
        role: { not: 'PREVIEW' },
      },
    });
    if (count !== members.length)
      error('WORK_INVALID_USER', 'Select active staff accounts');
    if (
      dto.departmentId &&
      !(await tx.orgChartNode.count({
        where: {
          id: dto.departmentId,
          kind: { in: ['DEPARTMENT', 'TEAM'] },
          status: { not: 'ARCHIVED' },
        },
      }))
    )
      error('WORK_INVALID_DEPARTMENT', 'Choose an active department or team');
    if (current) {
      const assignable = [
        ownerId,
        ...members.filter((m) => m.role !== 'VIEWER').map((m) => m.userId),
      ];
      const disallowed = await tx.crmTask.count({
        where: {
          projectId: current.id,
          archivedAt: null,
          status: { notIn: ['DONE', 'CANCELLED'] },
          assignedToId: { not: null, notIn: assignable },
        },
      });
      if (disallowed)
        error(
          'WORK_MEMBER_ASSIGNED',
          "Reassign this member's open work before removing their editing access",
        );
    }
    return members;
  }
  async createProject(user: WorkUser, dto: ProjectDto) {
    const id = randomUUID();
    return this.write(user, id, async (tx, actor) => {
      const members = await this.validateProject(tx, dto, actor.id);
      const project = await tx.workProject.create({
        data: {
          id,
          key: dto.key,
          name: dto.name.trim(),
          description: clean(dto.description),
          color: dto.color,
          departmentId: clean(dto.departmentId),
          ownerId: actor.id,
          members: { create: members },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'WORK_PROJECT_CREATED',
          entityType: 'WorkProject',
          entityId: id,
          metaJson: json({ ...project, members }),
        },
      });
      return project;
    });
  }
  async updateProject(user: WorkUser, id: string, dto: UpdateProjectDto) {
    return this.write(user, id, async (tx, actor) => {
      const project = await this.project(tx, actor, id);
      if (!this.canManageProject(actor, project))
        throw new ForbiddenException('Project lead permission required');
      checkVersion(project.version, dto.version);
      if (project.archivedAt)
        error('WORK_ARCHIVED', 'Restore this project before editing');
      const members = await this.validateProject(
        tx,
        dto,
        project.ownerId,
        project,
      );
      await tx.workProjectMember.deleteMany({ where: { projectId: id } });
      const after = await tx.workProject.update({
        where: { id },
        data: {
          key: dto.key,
          name: dto.name.trim(),
          description: clean(dto.description),
          color: dto.color,
          departmentId: clean(dto.departmentId),
          version: { increment: 1 },
          members: { create: members },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'WORK_PROJECT_UPDATED',
          entityType: 'WorkProject',
          entityId: id,
          metaJson: json({ before: project, after: { ...after, members } }),
        },
      });
      return after;
    });
  }
  async archiveProject(user: WorkUser, id: string, dto: ArchiveDto) {
    return this.write(user, id, async (tx, actor) => {
      const project = await this.project(tx, actor, id);
      if (!this.canManageProject(actor, project))
        throw new ForbiddenException('Project lead permission required');
      checkVersion(project.version, dto.version);
      const after = await tx.workProject.update({
        where: { id },
        data: {
          archivedAt: dto.archived ? new Date() : null,
          version: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: dto.archived
            ? 'WORK_PROJECT_ARCHIVED'
            : 'WORK_PROJECT_RESTORED',
          entityType: 'WorkProject',
          entityId: id,
          metaJson: { name: project.name },
        },
      });
      return after;
    });
  }
  private async fields(
    tx: Tx,
    actor: Actor,
    dto: TaskFieldsDto,
    project: Project | null,
    before?: CrmTask,
  ) {
    const data: Prisma.CrmTaskUncheckedUpdateInput = {};
    for (const key of [
      'title',
      'description',
      'status',
      'priority',
      'kind',
      'estimateMinutes',
    ] as const)
      if (dto[key] !== undefined)
        (data as Record<string, unknown>)[key] =
          typeof dto[key] === 'string' ? dto[key]?.trim() : dto[key];
    if (dto.labels)
      data.labels = [
        ...new Set(dto.labels.map((l) => l.trim()).filter(Boolean)),
      ];
    const startAt =
      dto.startAt === undefined
        ? before?.startAt || null
        : dto.startAt
          ? new Date(dto.startAt)
          : null;
    const dueAt =
      dto.dueAt === undefined
        ? before?.dueAt || null
        : dto.dueAt
          ? new Date(dto.dueAt)
          : null;
    validDates(startAt, dueAt);
    if (dto.startAt !== undefined) data.startAt = startAt;
    if (dto.dueAt !== undefined) data.dueAt = dueAt;
    if (dto.assignedToId !== undefined) {
      const assignedToId = clean(dto.assignedToId);
      if (assignedToId && assignedToId !== before?.assignedToId) {
        if (
          !(await tx.user.count({
            where: {
              id: assignedToId,
              isActive: true,
              role: { not: 'PREVIEW' },
            },
          }))
        )
          error('WORK_INVALID_USER', 'Choose an active staff account');
        if (
          project &&
          assignedToId !== project.ownerId &&
          !project.members.some(
            (m) => m.userId === assignedToId && m.role !== 'VIEWER',
          )
        )
          error(
            'WORK_ASSIGNEE_NOT_MEMBER',
            'Add this person as a project member before assigning work',
          );
      }
      data.assignedToId = assignedToId;
    }
    for (const key of ['agencyId', 'customerId', 'leadId'] as const) {
      if (dto[key] === undefined || dto[key] === before?.[key]) continue;
      const id = clean(dto[key]);
      if (id) {
        if (actor.role === 'ACCOUNTING')
          throw new ForbiddenException(
            'CRM linking is not available for this role',
          );
        const exists =
          key === 'agencyId'
            ? await tx.agency.count({ where: { id } })
            : key === 'customerId'
              ? await tx.customer.count({ where: { id } })
              : await tx.lead.count({ where: { id } });
        if (!exists)
          error(
            'WORK_INVALID_REFERENCE',
            'The linked CRM record no longer exists',
          );
      }
      data[key] = id;
    }
    if (dto.status !== undefined)
      data.completedAt =
        dto.status === 'DONE' ? before?.completedAt || new Date() : null;
    return data;
  }
  private async canComplete(tx: Tx, task: CrmTask) {
    const [blocked, children, checklist] = await Promise.all([
      tx.workDependency.count({
        where: {
          taskId: task.id,
          blocker: { status: { notIn: ['DONE', 'CANCELLED'] } },
        },
      }),
      tx.crmTask.count({
        where: { parentId: task.id, status: { notIn: ['DONE', 'CANCELLED'] } },
      }),
      tx.workChecklistItem.count({ where: { taskId: task.id, done: false } }),
    ]);
    if (blocked || children || checklist)
      error(
        'WORK_UNFINISHED',
        'Complete the checklist, subtasks and blocking work before completing this item',
      );
  }
  async create(user: WorkUser, dto: CreateTaskDto) {
    if (typeof dto.title !== 'string' || !dto.title.trim())
      error('WORK_TITLE_REQUIRED', 'Enter a title');
    const projectId = clean(dto.projectId);
    const since = new Date();
    const result = await this.write(
      user,
      projectId || 'personal',
      async (tx, actor) => {
        const project = projectId
          ? await this.project(tx, actor, projectId, true)
          : null;
        if (project?.archivedAt)
          error('WORK_ARCHIVED', 'Restore this project before adding work');
        if (dto.parentId) {
          const parent = await this.task(tx, actor, dto.parentId);
          if (
            !this.canEdit(actor, parent) ||
            parent.parentId ||
            parent.projectId !== projectId ||
            closedStatuses.includes(parent.status)
          )
            error(
              'WORK_INVALID_PARENT',
              'Choose an open top-level item in the same project',
            );
        }
        const fields = await this.fields(tx, actor, dto, project);
        const task = await tx.crmTask.create({
          data: {
            ...fields,
            title: dto.title.trim(),
            createdById: actor.id,
            projectId,
            parentId: clean(dto.parentId),
          } as Prisma.CrmTaskUncheckedCreateInput,
        });
        await this.log(tx, actor, task, 'CREATED', task);
        return task;
      },
    );
    void this.publish(result.id, since);
    return result;
  }
  private async updateWithin(
    tx: Tx,
    actor: Actor,
    task: Item,
    dto: UpdateTaskDto,
  ) {
    checkVersion(task.version, dto.version);
    if (!this.canEdit(actor, task))
      throw new ForbiddenException('This work item is read-only');
    if (dto.status === 'DONE') await this.canComplete(tx, task);
    if (
      dto.status &&
      !closedStatuses.includes(dto.status) &&
      closedStatuses.includes(task.status)
    ) {
      if (
        task.parent?.status === 'DONE' ||
        (await tx.workDependency.count({
          where: { blockerId: task.id, task: { status: 'DONE' } },
        }))
      )
        error(
          'WORK_COMPLETED_DEPENDENT',
          'Reopen the completed parent or dependent work first',
        );
    }
    const fields = await this.fields(tx, actor, dto, task.project, task);
    const after = await tx.crmTask.update({
      where: { id: task.id },
      data: fields,
    });
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of Object.keys(fields)) {
      const previous = (task as unknown as Record<string, unknown>)[key];
      const next = (after as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(previous) !== JSON.stringify(next))
        changes[key] = { before: previous, after: next };
    }
    await this.log(tx, actor, after, 'UPDATED', changes);
    return after;
  }
  async update(user: WorkUser, id: string, dto: UpdateTaskDto) {
    await this.mutation(user, id, dto.version, (tx, actor, task) =>
      this.updateWithin(tx, actor, task, dto),
    );
    return { ok: true, version: dto.version + 1 };
  }
  async archive(user: WorkUser, id: string, dto: ArchiveDto) {
    return this.mutation(
      user,
      id,
      dto.version,
      async (tx, actor, task) => {
        if (task.project?.archivedAt)
          error('WORK_ARCHIVED', 'Restore the project first');
        if (!dto.archived && task.parent?.archivedAt)
          error('WORK_PARENT_ARCHIVED', 'Restore the parent work item first');
        if (dto.archived && !closedStatuses.includes(task.status))
          error(
            'WORK_CLOSE_FIRST',
            'Complete or cancel this work item before archiving',
          );
        if (
          dto.archived &&
          (await tx.crmTask.count({
            where: { parentId: id, archivedAt: null },
          }))
        )
          error('WORK_ARCHIVE_CHILDREN', 'Archive the subtasks first');
        const after = await tx.crmTask.update({
          where: { id },
          data: { archivedAt: dto.archived ? new Date() : null },
        });
        await this.log(
          tx,
          actor,
          after,
          dto.archived ? 'ARCHIVED' : 'RESTORED',
          { archived: dto.archived },
        );
        return { ok: true };
      },
      true,
    );
  }
  async bulk(user: WorkUser, dto: BulkTaskDto) {
    if (
      !dto.items.length ||
      new Set(dto.items.map((i) => i.id)).size !== dto.items.length
    )
      error('WORK_INVALID_SELECTION', 'Choose 1 to 50 distinct work items');
    if (
      dto.status === undefined &&
      dto.priority === undefined &&
      dto.assignedToId === undefined
    )
      error('WORK_NO_CHANGE', 'Choose a field to update');
    const actor = await this.actor(user);
    const first = await this.task(this.db, actor, dto.items[0].id);
    const since = new Date();
    await this.write(user, first.projectId || 'personal', async (tx, actor) => {
      const ids = dto.items.map((item) => item.id);
      const tasks = await tx.crmTask.findMany({
        where: { id: { in: ids }, AND: [this.accessWhere(actor)] },
        include: itemInclude,
      });
      if (tasks.length !== ids.length)
        throw new NotFoundException(
          'A selected work item is no longer available',
        );
      for (const task of tasks) {
        checkVersion(
          task.version,
          dto.items.find((item) => item.id === task.id)!.version,
        );
        if (!this.canEdit(actor, task))
          throw new ForbiddenException('A selected item is read-only');
        if (task.projectId !== first.projectId)
          error(
            'WORK_SAME_PROJECT',
            'Bulk changes require items from the same project',
          );
      }
      if (dto.status === 'DONE') {
        const [checks, children, blockers] = await Promise.all([
          tx.workChecklistItem.count({
            where: { taskId: { in: ids }, done: false },
          }),
          tx.crmTask.count({
            where: {
              parentId: { in: ids },
              id: { notIn: ids },
              status: { notIn: ['DONE', 'CANCELLED'] },
            },
          }),
          tx.workDependency.count({
            where: {
              taskId: { in: ids },
              blockerId: { notIn: ids },
              blocker: { status: { notIn: ['DONE', 'CANCELLED'] } },
            },
          }),
        ]);
        if (checks || children || blockers)
          error(
            'WORK_UNFINISHED',
            'Complete the checklist, subtasks and blocking work first',
          );
      }
      if (dto.status && !closedStatuses.includes(dto.status)) {
        const reopening = tasks
          .filter((task) => closedStatuses.includes(task.status))
          .map((task) => task.id);
        if (
          tasks.some(
            (task) =>
              reopening.includes(task.id) &&
              task.parent?.status === 'DONE' &&
              !ids.includes(task.parent.id),
          ) ||
          (await tx.workDependency.count({
            where: {
              blockerId: { in: reopening },
              task: { id: { notIn: ids }, status: 'DONE' },
            },
          }))
        ) {
          error(
            'WORK_COMPLETED_DEPENDENT',
            'Reopen completed parents or dependent work first',
          );
        }
      }
      const data = await this.fields(tx, actor, dto, tasks[0].project);
      delete data.completedAt;
      const completedAt = new Date();
      if (dto.status === 'DONE')
        await tx.crmTask.updateMany({
          where: { id: { in: ids }, status: { not: 'DONE' } },
          data: { completedAt },
        });
      else if (dto.status) data.completedAt = null;
      await tx.crmTask.updateMany({
        where: { id: { in: ids } },
        data: { ...data, version: { increment: 1 } },
      });
      const changesFor = (task: Item) =>
        json(
          Object.fromEntries(
            ['status', 'priority', 'assignedToId']
              .filter((key) => dto[key] !== undefined && dto[key] !== task[key])
              .map((key) => [key, { before: task[key], after: dto[key] }]),
          ),
        );
      await tx.workActivity.createMany({
        data: tasks.map((task) => ({
          taskId: task.id,
          actorId: actor.id,
          actorName: actor.name,
          action: 'UPDATED',
          changes: changesFor(task),
        })),
      });
      await tx.auditLog.createMany({
        data: tasks.map((task) => ({
          actorId: actor.id,
          action: 'TASK_UPDATED',
          entityType: 'CrmTask',
          entityId: task.id,
          metaJson: changesFor(task),
        })),
      });
      const watchers = await tx.workWatcher.findMany({
        where: { taskId: { in: ids } },
        select: { userId: true, taskId: true },
      });
      const candidates = [
        ...new Set([
          ...tasks.flatMap((task) => [
            dto.assignedToId === undefined
              ? task.assignedToId
              : dto.assignedToId,
            task.createdById,
          ]),
          ...watchers.map((w) => w.userId),
        ]),
      ].filter((id): id is string => !!id && id !== actor.id);
      const audience = await this.notificationAudience(tx, tasks, candidates);
      const notifications: Prisma.NotificationCreateManyInput[] = tasks.flatMap(
        (task) =>
          [
            ...new Set([
              dto.assignedToId === undefined
                ? task.assignedToId
                : dto.assignedToId,
              task.createdById,
              ...watchers
                .filter((w) => w.taskId === task.id)
                .map((w) => w.userId),
            ]),
          ]
            .filter(
              (id): id is string => !!id && audience.get(task.id)!.has(id),
            )
            .map((userId) => ({
              userId,
              type: 'TASK_UPDATED',
              title: task.title,
              message: actor.name + ' · UPDATED',
              entityType: 'CrmTask',
              entityId: task.id,
              link: '/tasks/' + task.id,
            })),
      );
      if (notifications.length)
        await tx.notification.createMany({ data: notifications });
    });
    void this.publish(
      dto.items.map((item) => item.id),
      since,
    );
    return { updated: dto.items.length };
  }

  async comment(
    user: WorkUser,
    id: string,
    dto: CommentDto,
    commentId?: string,
  ) {
    return this.mutation(user, id, dto.version, async (tx, actor, task) => {
      const before = commentId
        ? await tx.workComment.findFirst({
            where: { id: commentId, taskId: id },
          })
        : null;
      if (commentId && !before)
        throw new NotFoundException('Comment not found');
      if (before && before.authorId !== actor.id && !manager(actor))
        throw new ForbiddenException('Only the author can edit this comment');
      const after = before
        ? await tx.workComment.update({
            where: { id: commentId },
            data: { body: dto.body.trim() },
          })
        : await tx.workComment.create({
            data: {
              taskId: id,
              authorId: actor.id,
              authorName: actor.name,
              body: dto.body.trim(),
            },
          });
      await this.log(
        tx,
        actor,
        task,
        before ? 'COMMENT_EDITED' : 'COMMENT_ADDED',
        { before: before?.body || null, after: after.body },
      );
      return after;
    });
  }
  async checklist(
    user: WorkUser,
    id: string,
    dto: ChecklistDto,
    entryId?: string,
  ) {
    return this.mutation(user, id, dto.version, async (tx, actor, task) => {
      if (task.status === 'DONE' && !dto.done)
        error(
          'WORK_REOPEN_FIRST',
          'Reopen the work item before adding unfinished checks',
        );
      const before = entryId
        ? await tx.workChecklistItem.findFirst({
            where: { id: entryId, taskId: id },
          })
        : null;
      if (entryId && !before)
        throw new NotFoundException('Checklist item not found');
      const after = before
        ? await tx.workChecklistItem.update({
            where: { id: entryId },
            data: { title: dto.title.trim(), done: dto.done },
          })
        : await tx.workChecklistItem.create({
            data: { taskId: id, title: dto.title.trim(), done: dto.done },
          });
      await this.log(
        tx,
        actor,
        task,
        'CHECKLIST_UPDATED',
        { before, after },
        false,
      );
      return after;
    });
  }
  async time(user: WorkUser, id: string, dto: TimeEntryDto, entryId?: string) {
    const workedOn = new Date(dto.workedOn + 'T00:00:00Z');
    if (
      !Number.isFinite(workedOn.getTime()) ||
      workedOn.toISOString().slice(0, 10) !== dto.workedOn ||
      workedOn.getTime() > Date.now() + 86400000
    )
      error('WORK_INVALID_DATE', 'Choose a valid work date, not a future date');
    return this.mutation(user, id, dto.version, async (tx, actor, task) => {
      const before = entryId
        ? await tx.workTimeEntry.findFirst({
            where: { id: entryId, taskId: id },
          })
        : null;
      if (entryId && !before)
        throw new NotFoundException('Time entry not found');
      if (before && before.userId !== actor.id && !manager(actor))
        throw new ForbiddenException(
          'Only the author can edit this time entry',
        );
      const data = { minutes: dto.minutes, workedOn, note: clean(dto.note) };
      const after = before
        ? await tx.workTimeEntry.update({ where: { id: entryId }, data })
        : await tx.workTimeEntry.create({
            data: {
              ...data,
              taskId: id,
              userId: actor.id,
              userName: actor.name,
            },
          });
      await this.log(tx, actor, task, 'TIME_LOGGED', { before, after }, false);
      return after;
    });
  }
  async dependency(user: WorkUser, id: string, dto: DependencyDto) {
    return this.mutation(user, id, dto.version, async (tx, actor, task) => {
      const blocker = await this.task(tx, actor, dto.blockerId);
      if (blocker.projectId !== task.projectId || blocker.archivedAt)
        error(
          'WORK_INVALID_DEPENDENCY',
          'Choose a non-archived item from the same project',
        );
      if (task.status === 'DONE' && !closedStatuses.includes(blocker.status))
        error(
          'WORK_REOPEN_FIRST',
          'Reopen this item before adding unfinished blocking work',
        );
      const tasks = await tx.crmTask.findMany({
        where: { projectId: task.projectId },
        select: { id: true, parentId: true },
      });
      const edges = await tx.workDependency.findMany({
        where: { task: { projectId: task.projectId } },
      });
      const all = [
        ...edges,
        ...tasks
          .filter((t) => t.parentId)
          .map((t) => ({ taskId: t.parentId!, blockerId: t.id })),
      ];
      if (wouldCycle(all, id, blocker.id))
        error(
          'WORK_DEPENDENCY_CYCLE',
          'This dependency would create a circular workflow',
        );
      await tx.workDependency.upsert({
        where: { taskId_blockerId: { taskId: id, blockerId: blocker.id } },
        create: { taskId: id, blockerId: blocker.id },
        update: {},
      });
      await this.log(tx, actor, task, 'DEPENDENCY_ADDED', {
        id: blocker.id,
        title: blocker.title,
      });
      return { ok: true };
    });
  }
  async upload(
    user: WorkUser,
    id: string,
    version: number,
    file?: Express.Multer.File,
  ) {
    const data = safeFile(file);
    return this.mutation(user, id, version, async (tx, actor, task) => {
      const total = await tx.workAttachment.aggregate({
        where: { taskId: id },
        _count: true,
        _sum: { size: true },
      });
      if (
        total._count >= 10 ||
        (total._sum.size || 0) + data.size > 20 * 1024 * 1024
      )
        error(
          'WORK_ATTACHMENT_LIMIT',
          'Maximum 10 files and 20 MB per work item',
        );
      const attachment = await tx.workAttachment.create({
        data: { ...data, taskId: id, userId: actor.id, userName: actor.name },
        select: fileSelect,
      });
      await this.log(tx, actor, task, 'FILE_ADDED', attachment);
      return attachment;
    });
  }
  async download(user: WorkUser, id: string, fileId: string) {
    const actor = await this.actor(user);
    await this.task(this.db, actor, id);
    const file = await this.db.workAttachment.findFirst({
      where: { id: fileId, taskId: id },
    });
    if (!file) throw new NotFoundException('File not found');
    return file;
  }
  async removePart(
    user: WorkUser,
    id: string,
    kind: 'comments' | 'checklist' | 'time' | 'files' | 'dependencies',
    entryId: string,
    version: number,
  ) {
    return this.mutation(user, id, version, async (tx, actor, task) => {
      let before: unknown;
      if (kind === 'dependencies') {
        before = await tx.workDependency.findUnique({
          where: { taskId_blockerId: { taskId: id, blockerId: entryId } },
        });
        if (!before) throw new NotFoundException();
        await tx.workDependency.delete({
          where: { taskId_blockerId: { taskId: id, blockerId: entryId } },
        });
      } else if (kind === 'checklist') {
        before = await tx.workChecklistItem.findFirst({
          where: { id: entryId, taskId: id },
        });
        if (!before) throw new NotFoundException();
        await tx.workChecklistItem.delete({ where: { id: entryId } });
      } else {
        const record =
          kind === 'comments'
            ? await tx.workComment.findFirst({
                where: { id: entryId, taskId: id },
              })
            : kind === 'time'
              ? await tx.workTimeEntry.findFirst({
                  where: { id: entryId, taskId: id },
                })
              : await tx.workAttachment.findFirst({
                  where: { id: entryId, taskId: id },
                  select: fileSelect,
                });
        if (!record) throw new NotFoundException();
        const authorId = 'authorId' in record ? record.authorId : record.userId;
        if (authorId !== actor.id && !manager(actor))
          throw new ForbiddenException('Only the author can remove this entry');
        before = record;
        if (kind === 'comments')
          await tx.workComment.delete({ where: { id: entryId } });
        else if (kind === 'time')
          await tx.workTimeEntry.delete({ where: { id: entryId } });
        else await tx.workAttachment.delete({ where: { id: entryId } });
      }
      await this.log(tx, actor, task, 'ENTRY_REMOVED', { kind, before }, false);
      return { ok: true };
    });
  }
  async watch(user: WorkUser, id: string, watching: boolean) {
    const actor = await this.actor(user);
    await this.task(this.db, actor, id);
    if (watching)
      await this.db.workWatcher.upsert({
        where: { taskId_userId: { taskId: id, userId: actor.id } },
        create: { taskId: id, userId: actor.id },
        update: {},
      });
    else
      await this.db.workWatcher.deleteMany({
        where: { taskId: id, userId: actor.id },
      });
    return { watching };
  }
  async references(user: WorkUser, kind: string, search: string) {
    if (this.preview(user)) return [];
    const actor = await this.actor(user);
    if (actor.role === 'ACCOUNTING' || search.trim().length < 2) return [];
    const filter = {
      contains: search.trim().slice(0, 100),
      mode: 'insensitive' as const,
    };
    if (kind === 'agency')
      return this.db.agency.findMany({
        where: { name: filter },
        select: { id: true, name: true },
        take: 20,
      });
    if (kind === 'customer')
      return (
        await this.db.customer.findMany({
          where: { fullName: filter },
          select: { id: true, fullName: true },
          take: 20,
        })
      ).map((c) => ({ id: c.id, name: c.fullName }));
    if (kind === 'lead')
      return (
        await this.db.lead.findMany({
          where: { fullName: filter },
          select: { id: true, fullName: true },
          take: 20,
        })
      ).map((c) => ({ id: c.id, name: c.fullName }));
    return [];
  }
}
