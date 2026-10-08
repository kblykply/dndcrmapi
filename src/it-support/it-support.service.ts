import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient, ItTicket } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertItIdentity, employeeRoles } from './it-support.guard';
import type { ItUser } from './it-support.guard';
import {
  actionInput,
  allowedStatuses,
  categories,
  createInput,
  entryInput,
  identifier,
  initialPriority,
  invalid,
  oneOf,
  openStatuses,
  priorities,
  statuses,
  string,
  triageInput,
  types,
  validateFiles,
} from './it-support.dto';

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string; role: string; canManage: boolean };
type Files = ReturnType<typeof validateFiles>;
const fileSelect = {
  id: true,
  entryId: true,
  name: true,
  mimeType: true,
  size: true,
  createdAt: true,
} as const;
const entrySelect = {
  id: true,
  kind: true,
  visibility: true,
  body: true,
  authorName: true,
  authorId: true,
  createdAt: true,
  status: true,
  changedFields: true,
  attachments: { select: fileSelect, orderBy: { createdAt: 'asc' as const } },
} as const;
type EntryRow = Prisma.ItTicketEntryGetPayload<{ select: typeof entrySelect }>;
const iso = (value: Date | null) => value?.toISOString() ?? null;
const code = (number: number) => `DND-IT-${String(number).padStart(6, '0')}`;
const missing = () => new NotFoundException('IT support record not found.');
function conflict(): never {
  throw new ConflictException({
    code: 'IT_SUPPORT_VERSION_CONFLICT',
    message: 'This ticket changed. Reload before saving again.',
  });
}

@Injectable()
export class ItSupportService {
  private db: PrismaClient;
  constructor(prisma: PrismaService) {
    this.db = prisma as unknown as PrismaClient;
  }
  private async actor(user: ItUser, tx: Tx = this.db): Promise<Actor> {
    assertItIdentity(user);
    const account = await tx.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!account?.isActive || !employeeRoles.includes(account.role))
      throw new ForbiddenException('An active employee account is required.');
    return {
      id: account.id,
      name: account.name,
      role: account.role,
      canManage: user.role === 'ADMIN' && account.role === 'ADMIN',
    };
  }
  private scope(actor: Actor): Prisma.ItTicketWhereInput {
    return actor.canManage ? {} : { requesterId: actor.id };
  }
  private async ticket(tx: Tx, actor: Actor, id: string) {
    identifier(id);
    const ticket = await tx.itTicket.findFirst({
      where: { id, ...this.scope(actor) },
    });
    if (!ticket) throw missing();
    return ticket;
  }
  private summary(ticket: ItTicket, actor: Actor) {
    return {
      id: ticket.id,
      number: ticket.number,
      code: code(ticket.number),
      subject: ticket.subject,
      type: ticket.type,
      category: ticket.category,
      status: ticket.status,
      priority: ticket.priority,
      impact: ticket.impact,
      urgency: ticket.urgency,
      system: ticket.system,
      location: ticket.location,
      requester: { id: ticket.requesterId, name: ticket.requesterName },
      assignee: ticket.assigneeId
        ? { id: ticket.assigneeId, name: ticket.assigneeName ?? '' }
        : null,
      createdAt: iso(ticket.createdAt)!,
      updatedAt: iso(
        actor.canManage ? ticket.updatedAt : ticket.publicUpdatedAt,
      )!,
      dueAt: iso(ticket.dueAt),
      firstResponseAt: iso(ticket.firstResponseAt),
      resolvedAt: iso(ticket.resolvedAt),
      closedAt: iso(ticket.closedAt),
      version: ticket.version,
    };
  }
  private fileView(
    file: Prisma.ItTicketAttachmentGetPayload<{ select: typeof fileSelect }>,
  ) {
    return { ...file, createdAt: file.createdAt.toISOString() };
  }
  private entryView(entry: EntryRow) {
    return {
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      attachments: entry.attachments.map((file) => this.fileView(file)),
    };
  }
  private cursor(ticketId: string, entry: EntryRow) {
    return Buffer.from(
      JSON.stringify({
        ticketId,
        id: entry.id,
        createdAt: entry.createdAt.toISOString(),
      }),
    ).toString('base64url');
  }
  private decodeCursor(
    ticketId: string,
    cursor?: string,
  ): Prisma.ItTicketEntryWhereInput {
    if (cursor === undefined) return {};
    try {
      if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        invalid('Invalid history cursor.');
      const data = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      );
      const id = identifier(data.id);
      const createdAt = new Date(data.createdAt);
      if (
        data.ticketId !== ticketId ||
        !Number.isFinite(createdAt.getTime()) ||
        createdAt.toISOString() !== data.createdAt
      )
        invalid('Invalid history cursor.');
      return {
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
      };
    } catch {
      invalid('Invalid history cursor.');
    }
  }
  private async page(tx: Tx, actor: Actor, ticket: ItTicket, cursor?: string) {
    const rows = await tx.itTicketEntry.findMany({
      where: {
        ticketId: ticket.id,
        ticketVersion: { lte: ticket.version },
        ...(actor.canManage ? {} : { visibility: 'PUBLIC' }),
        AND: [this.decodeCursor(ticket.id, cursor)],
      },
      select: entrySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 41,
    });
    // Defense in depth in addition to the visibility predicate.
    const visible = rows.filter(
      (row) => actor.canManage || row.visibility === 'PUBLIC',
    );
    const recent = visible.slice(0, 40);
    return {
      items: recent
        .slice()
        .reverse()
        .map((row) => this.entryView(row)),
      nextCursor:
        visible.length > 40
          ? this.cursor(ticket.id, recent[recent.length - 1])
          : null,
    };
  }
  private actions(
    actor: Actor,
    ticket: ItTicket,
  ): ('CONFIRM' | 'REOPEN' | 'CANCEL')[] {
    if (ticket.requesterId !== actor.id) return [];
    if (ticket.status === 'RESOLVED') return ['CONFIRM', 'REOPEN', 'CANCEL'];
    if (ticket.status === 'CLOSED') return ['REOPEN'];
    return openStatuses.includes(ticket.status) ? ['CANCEL'] : [];
  }
  private async detail(tx: Tx, actor: Actor, ticket: ItTicket) {
    const [page, attachments] = await Promise.all([
      this.page(tx, actor, ticket),
      tx.itTicketAttachment.findMany({
        where: {
          ticketId: ticket.id,
          entry: {
            ticketVersion: { lte: ticket.version },
            ...(actor.canManage ? {} : { visibility: 'PUBLIC' }),
          },
        },
        select: { ...fileSelect, entry: { select: { visibility: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      ticket: {
        ...this.summary(ticket, actor),
        description: ticket.description,
        resolution: ticket.resolution,
      },
      canManage: actor.canManage,
      canReply: !['CLOSED', 'CANCELLED'].includes(ticket.status),
      actions: this.actions(actor, ticket),
      allowedStatuses: actor.canManage ? allowedStatuses(ticket.status) : [],
      entries: page.items,
      nextCursor: page.nextCursor,
      attachments: attachments
        .filter((file) => actor.canManage || file.entry.visibility === 'PUBLIC')
        .map(({ entry, ...file }) => this.fileView(file)),
    };
  }
  async workspace(user: ItUser) {
    const actor = await this.actor(user);
    const agents = actor.canManage
      ? await this.db.user.findMany({
          where: { role: 'ADMIN', isActive: true },
          select: { id: true, name: true, role: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        })
      : [];
    return {
      me: { id: actor.id, name: actor.name, role: actor.role },
      canManage: actor.canManage,
      agents,
    };
  }
  async list(user: ItUser, query: Record<string, unknown> = {}) {
    const actor = await this.actor(user);
    const scope = oneOf(
      query.scope ?? (actor.canManage ? 'ALL' : 'MINE'),
      ['MINE', 'ALL', 'ASSIGNED', 'UNASSIGNED'] as const,
      'scope',
    );
    if (!actor.canManage && scope !== 'MINE')
      throw new ForbiddenException(
        'Employees can only list their own tickets.',
      );
    const base: Prisma.ItTicketWhereInput =
      scope === 'MINE'
        ? { requesterId: actor.id }
        : scope === 'ASSIGNED'
          ? { assigneeId: actor.id }
          : scope === 'UNASSIGNED'
            ? { assigneeId: null }
            : {};
    const integer = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (
        typeof value !== 'string' ||
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) > max
      )
        invalid('Invalid pagination.');
      return Number(value);
    };
    const skip = integer(query.skip, 0, 1000000),
      take = integer(query.take, 40, 100);
    if (take < 1) invalid('Page size must be between 1 and 100.');
    const filters: Prisma.ItTicketWhereInput = { ...base };
    if (query.status !== undefined && query.status !== '')
      filters.status = oneOf(query.status, statuses, 'status');
    if (query.priority !== undefined && query.priority !== '')
      filters.priority = oneOf(query.priority, priorities, 'priority');
    if (query.category !== undefined && query.category !== '')
      filters.category = oneOf(query.category, categories, 'category');
    if (query.type !== undefined && query.type !== '')
      filters.type = oneOf(query.type, types, 'type');
    if (query.q !== undefined) {
      const q = string(query.q, 'Search', 160);
      if (q) {
        const number = q.match(/^(?:DND-IT-)?0*(\d+)$/i);
        const n = number ? Number(number[1]) : null;
        filters.OR = ['subject', 'system', 'requesterName'].map((field) => ({
          [field]: { contains: q, mode: 'insensitive' },
        }));
        if (n !== null && Number.isSafeInteger(n) && n > 0 && n <= 2147483647)
          filters.OR.push({ number: n });
      }
    }
    const count = (extra: Prisma.ItTicketWhereInput) =>
      this.db.itTicket.count({ where: { AND: [base, extra] } });
    const [rows, total, open, waitingRequester, resolved, unassigned, overdue] =
      await Promise.all([
        this.db.itTicket.findMany({
          where: filters,
          orderBy: actor.canManage
            ? [{ updatedAt: 'desc' }, { id: 'desc' }]
            : [{ publicUpdatedAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
        }),
        this.db.itTicket.count({ where: filters }),
        count({ status: { in: openStatuses } }),
        count({ status: 'WAITING_REQUESTER' }),
        count({ status: 'RESOLVED' }),
        count({ assigneeId: null, status: { in: openStatuses } }),
        count({ status: { in: openStatuses }, dueAt: { lt: new Date() } }),
      ]);
    return {
      items: rows.map((row) => this.summary(row, actor)),
      total,
      skip,
      take,
      stats: { open, waitingRequester, resolved, unassigned, overdue },
    };
  }
  async get(user: ItUser, id: string) {
    const actor = await this.actor(user);
    return this.detail(this.db, actor, await this.ticket(this.db, actor, id));
  }
  async entries(user: ItUser, id: string, cursor?: string) {
    const actor = await this.actor(user);
    return this.page(
      this.db,
      actor,
      await this.ticket(this.db, actor, id),
      cursor,
    );
  }
  private async log(
    tx: Tx,
    actor: Actor,
    ticket: ItTicket,
    data: {
      kind: 'CREATED' | 'REPLY' | 'NOTE' | 'STATUS' | 'UPDATED';
      visibility: 'PUBLIC' | 'INTERNAL';
      body: string;
      status?: ItTicket['status'];
      changedFields?: string[];
    },
    files: Files = [],
  ) {
    await tx.itTicketEntry.create({
      data: {
        ticketId: ticket.id,
        authorId: actor.id,
        authorName: actor.name,
        ticketVersion: ticket.version,
        ...data,
        changedFields: data.changedFields ?? [],
        attachments: {
          create: files.map((file) => ({ ...file, ticketId: ticket.id })),
        },
      },
    });
  }
  private async fileQuota(tx: Tx, id: string, files: Files) {
    if (!files.length) return;
    const total = await tx.itTicketAttachment.aggregate({
      where: { ticketId: id },
      _count: true,
      _sum: { size: true },
    });
    if (
      total._count + files.length > 10 ||
      (total._sum.size ?? 0) + files.reduce((n, f) => n + f.size, 0) >
        20 * 1024 * 1024
    )
      invalid('This upload exceeds the ticket attachment limit.');
  }
  private async mutate(
    user: ItUser,
    id: string,
    expected: number,
    operation: (tx: Tx, actor: Actor, ticket: ItTicket) => Promise<void>,
  ) {
    assertItIdentity(user);
    return this.db.$transaction(async (tx) => {
      const actor = await this.actor(user, tx);
      const current = await this.ticket(tx, actor, id);
      if (current.version !== expected) conflict();
      // CAS obtains the row lock before quotas, transitions or entries are changed.
      const changed = await tx.itTicket.updateMany({
        where: { id, version: expected },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) conflict();
      const ticket = { ...current, version: expected + 1 };
      await operation(tx, actor, ticket);
      return this.detail(tx, actor, await this.ticket(tx, actor, id));
    });
  }
  async create(user: ItUser, value: unknown, uploads?: Express.Multer.File[]) {
    assertItIdentity(user);
    const input = createInput(value);
    const files = validateFiles(uploads);
    return this.db.$transaction(async (tx) => {
      const actor = await this.actor(user, tx);
      const ticket = await tx.itTicket.create({
        data: {
          ...input,
          priority: initialPriority(input.impact, input.urgency),
          requesterId: actor.id,
          requesterName: actor.name,
        },
      });
      await this.log(
        tx,
        actor,
        ticket,
        {
          kind: 'CREATED',
          visibility: 'PUBLIC',
          body: input.description,
          status: 'NEW',
        },
        files,
      );
      return this.detail(tx, actor, ticket);
    });
  }
  async reply(
    user: ItUser,
    id: string,
    value: unknown,
    uploads?: Express.Multer.File[],
  ) {
    assertItIdentity(user);
    const files = validateFiles(uploads);
    const input = entryInput(value, files.length > 0);
    return this.mutate(user, id, input.version, async (tx, actor, ticket) => {
      if (['CLOSED', 'CANCELLED'].includes(ticket.status))
        invalid('Reopen this ticket before adding a reply.');
      if (input.visibility === 'INTERNAL' && !actor.canManage)
        throw new ForbiddenException(
          'Only administrators may add internal notes.',
        );
      await this.fileQuota(tx, id, files);
      const publicReply = input.visibility === 'PUBLIC';
      const nextStatus =
        publicReply &&
        ticket.requesterId === actor.id &&
        ticket.status === 'WAITING_REQUESTER'
          ? 'IN_PROGRESS'
          : ticket.status;
      const firstResponse =
        publicReply &&
        actor.canManage &&
        actor.id !== ticket.requesterId &&
        !ticket.firstResponseAt;
      await tx.itTicket.update({
        where: { id },
        data: {
          ...(publicReply ? { publicUpdatedAt: new Date() } : {}),
          status: nextStatus,
          ...(firstResponse ? { firstResponseAt: new Date() } : {}),
        },
      });
      await this.log(
        tx,
        actor,
        ticket,
        {
          kind: publicReply ? 'REPLY' : 'NOTE',
          visibility: input.visibility,
          body: input.body,
          ...(nextStatus !== ticket.status
            ? { status: nextStatus, changedFields: ['status'] }
            : {}),
        },
        files,
      );
    });
  }
  async action(user: ItUser, id: string, value: unknown) {
    const input = actionInput(value);
    return this.mutate(user, id, input.version, async (tx, actor, ticket) => {
      if (!this.actions(actor, ticket).includes(input.action))
        throw new ForbiddenException(
          'This action is not available for this ticket.',
        );
      const status =
        input.action === 'CONFIRM'
          ? 'CLOSED'
          : input.action === 'REOPEN'
            ? 'NEW'
            : 'CANCELLED';
      await tx.itTicket.update({
        where: { id },
        data: {
          status,
          publicUpdatedAt: new Date(),
          ...(input.action === 'REOPEN'
            ? { resolution: '', resolvedAt: null, closedAt: null }
            : { closedAt: new Date() }),
        },
      });
      await this.log(tx, actor, ticket, {
        kind: 'STATUS',
        visibility: 'PUBLIC',
        body: input.message,
        status,
        changedFields: ['status'],
      });
    });
  }
  async triage(user: ItUser, id: string, value: unknown) {
    const input = triageInput(value);
    return this.mutate(user, id, input.version, async (tx, actor, ticket) => {
      if (!actor.canManage)
        throw new ForbiddenException(
          'Only administrators may manage IT tickets.',
        );
      if (!allowedStatuses(ticket.status).includes(input.status))
        invalid('This status transition is not allowed.');
      const statusChanged = input.status !== ticket.status;
      const reopened =
        statusChanged &&
        ['RESOLVED', 'CLOSED', 'CANCELLED'].includes(ticket.status) &&
        input.status === 'IN_PROGRESS';
      if (
        statusChanged &&
        ([
          'WAITING_REQUESTER',
          'WAITING_VENDOR',
          'RESOLVED',
          'CANCELLED',
        ].includes(input.status) ||
          reopened) &&
        !input.reason
      )
        invalid('A reason is required for this status change.');
      let assigneeName = ticket.assigneeName;
      if (input.assigneeId !== ticket.assigneeId) {
        assigneeName = null;
        if (input.assigneeId) {
          const assignee = await tx.user.findFirst({
            where: { id: input.assigneeId, role: 'ADMIN', isActive: true },
            select: { name: true },
          });
          if (!assignee) invalid('Select an active administrator as assignee.');
          assigneeName = assignee.name;
        }
      }
      const changedFields = [
        'category',
        'priority',
        'status',
        'assigneeId',
        'dueAt',
      ].filter((field) =>
        field === 'dueAt'
          ? iso(input.dueAt) !== iso(ticket.dueAt)
          : input[field] !== ticket[field],
      );
      await tx.itTicket.update({
        where: { id },
        data: {
          category: input.category,
          priority: input.priority,
          status: input.status,
          assigneeId: input.assigneeId,
          assigneeName,
          dueAt: input.dueAt,
          publicUpdatedAt: new Date(),
          ...(statusChanged && input.status === 'RESOLVED'
            ? {
                resolution: input.reason,
                resolvedAt: new Date(),
                closedAt: null,
              }
            : {}),
          ...(statusChanged && ['CLOSED', 'CANCELLED'].includes(input.status)
            ? { closedAt: new Date() }
            : {}),
          ...(reopened
            ? { resolution: '', resolvedAt: null, closedAt: null }
            : {}),
          ...(statusChanged &&
          input.reason &&
          actor.id !== ticket.requesterId &&
          !ticket.firstResponseAt
            ? { firstResponseAt: new Date() }
            : {}),
        },
      });
      await this.log(tx, actor, ticket, {
        kind: statusChanged ? 'STATUS' : 'UPDATED',
        visibility: 'PUBLIC',
        body: input.reason,
        ...(statusChanged ? { status: input.status } : {}),
        changedFields,
      });
    });
  }
  async attachment(user: ItUser, id: string) {
    const actor = await this.actor(user);
    identifier(id);
    const file = await this.db.itTicketAttachment.findFirst({
      where: {
        id,
        ticket: this.scope(actor),
        ...(actor.canManage ? {} : { entry: { visibility: 'PUBLIC' } }),
      },
      include: { entry: { select: { visibility: true } } },
    });
    if (!file || (!actor.canManage && file.entry.visibility !== 'PUBLIC'))
      throw missing();
    return {
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      content: file.content,
    };
  }
}
