import { ItSupportService } from './it-support.service';
import { PrismaService } from '../prisma/prisma.service';

const at = new Date('2026-09-16T10:00:00.000Z');
const admin = { id: 'admin', role: 'ADMIN' };
const employee = { id: 'employee', role: 'SALES' };
const input = {
  subject: 'Printer unavailable',
  description: 'Printing fails on floor 2.',
  type: 'INCIDENT',
  category: 'HARDWARE',
  impact: 'TEAM',
  urgency: 'HIGH',
  system: 'Printer',
  location: 'Floor 2',
};
function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    number: 1,
    ...input,
    requesterId: 'employee',
    requesterName: 'Employee',
    assigneeId: null,
    assigneeName: null,
    status: 'NEW',
    priority: 'HIGH',
    resolution: '',
    dueAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    publicUpdatedAt: at,
    ...overrides,
  };
}
function upload(text = 'hello') {
  return {
    originalname: 'note.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from(text),
    size: Buffer.byteLength(text),
  } as Express.Multer.File;
}
function fixture(overrides: Record<string, unknown> = {}) {
  let state = {
    ticket: ticket(overrides),
    entries: [] as any[],
    attachments: [] as any[],
  };
  const db = {
    user: {
      findUnique: jest.fn(async ({ where }) => ({
        id: where.id,
        name: where.id === 'admin' ? 'Actual Admin' : 'Employee',
        role: where.id === 'admin' ? 'ADMIN' : 'SALES',
        isActive: true,
      })),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => ({ id: 'admin', name: 'Actual Admin' })),
    },
    itTicket: {
      findFirst: jest.fn(async ({ where }) =>
        where.id === state.ticket.id &&
        (!where.requesterId || where.requesterId === state.ticket.requesterId)
          ? { ...state.ticket }
          : null,
      ),
      findMany: jest.fn(async () => [state.ticket]),
      count: jest.fn(async () => 1),
      create: jest.fn(async ({ data }) => {
        state.ticket = ticket({ ...data });
        return { ...state.ticket };
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.version !== state.ticket.version) return { count: 0 };
        state.ticket = {
          ...state.ticket,
          version: state.ticket.version + data.version.increment,
          updatedAt: new Date(),
        };
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => {
        state.ticket = { ...state.ticket, ...data, updatedAt: new Date() };
        return { ...state.ticket };
      }),
    },
    itTicketEntry: {
      create: jest.fn(async ({ data }) => {
        const { attachments, ...entry } = data;
        const row = {
          id: `entry-${state.entries.length + 1}`,
          createdAt: at,
          status: null,
          ...entry,
          attachments: [] as any[],
        };
        for (const file of attachments?.create ?? []) {
          const result = {
            id: `file-${state.attachments.length + 1}`,
            entryId: row.id,
            ...file,
            createdAt: at,
            entry: { visibility: row.visibility },
          };
          state.attachments.push(result);
          row.attachments.push(result);
        }
        state.entries.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where, take }) =>
        state.entries
          .filter(
            (row) =>
              row.ticketId === where.ticketId &&
              (!where.visibility || row.visibility === where.visibility) &&
              row.ticketVersion <= where.ticketVersion.lte,
          )
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
          .slice(0, take),
      ),
    },
    itTicketAttachment: {
      findMany: jest.fn(async ({ where }) =>
        state.attachments.filter(
          (file) =>
            file.ticketId === where.ticketId &&
            (!where.entry.visibility ||
              file.entry.visibility === where.entry.visibility),
        ),
      ),
      findFirst: jest.fn(async () => null),
      aggregate: jest.fn(async () => ({
        _count: state.attachments.length,
        _sum: { size: state.attachments.reduce((n, f) => n + f.size, 0) },
      })),
    },
    $transaction: jest.fn(async (operation) => {
      const before = structuredClone(state);
      try {
        return await operation(db);
      } catch (error) {
        state = before;
        throw error;
      }
    }),
  };
  const service = new ItSupportService(db as unknown as PrismaService);
  return { service, db, state: () => state };
}

describe('IT support ownership and workflow', () => {
  it('returns no agent directory for employees; uses current ADMIN and identity for management', async () => {
    const { service, db } = fixture();
    expect(await service.workspace(employee)).toMatchObject({
      canManage: false,
      agents: [],
    });
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(await service.workspace(admin)).toMatchObject({ canManage: true });
    db.user.findUnique.mockResolvedValue({
      id: 'admin',
      name: 'Former Admin',
      role: 'MANAGER',
      isActive: true,
    });
    expect(await service.workspace(admin)).toMatchObject({
      canManage: false,
      agents: [],
    });
    db.user.findUnique.mockResolvedValue({
      id: 'employee',
      name: 'Promoted',
      role: 'ADMIN',
      isActive: true,
    });
    expect(await service.workspace(employee)).toMatchObject({
      canManage: false,
    });
  });
  it.each([
    null,
    { id: 'employee', name: 'Disabled', role: 'SALES', isActive: false },
    { id: 'employee', name: 'Preview', role: 'PREVIEW', isActive: true },
  ])('rejects removed/inactive/preview current user %p', async (account) => {
    const { service, db } = fixture();
    db.user.findUnique.mockResolvedValue(account as any);
    await expect(service.workspace(employee)).rejects.toThrow();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it('denies other tickets and applies own scope to list stats before filters', async () => {
    const { service, db } = fixture({ requesterId: 'other' });
    await expect(service.get(employee, 'ticket-1')).rejects.toThrow(
      'not found',
    );
    await service.list(employee, {
      scope: 'MINE',
      q: 'needle',
      status: 'RESOLVED',
    });
    expect(db.itTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requesterId: 'employee',
          status: 'RESOLVED',
        }),
      }),
    );
    for (const [call] of db.itTicket.count.mock.calls as any[])
      expect(call.where.requesterId ?? call.where.AND?.[0].requesterId).toBe(
        'employee',
      );
    await expect(service.list(employee, { scope: 'ALL' })).rejects.toThrow();
  });
  it('queries only public entries/files and serializes no internal details defensively', async () => {
    const { service, db } = fixture();
    db.itTicketEntry.findMany.mockResolvedValue([
      {
        id: 'private',
        kind: 'NOTE',
        visibility: 'INTERNAL',
        body: 'secret',
        authorName: 'Hidden',
        authorId: 'admin',
        createdAt: at,
        status: null,
        changedFields: [],
        attachments: [],
      },
    ]);
    db.itTicketAttachment.findMany.mockResolvedValue([
      {
        id: 'secretfile',
        entryId: 'private',
        name: 'secret.txt',
        mimeType: 'text/plain',
        size: 1,
        createdAt: at,
        entry: { visibility: 'INTERNAL' },
      },
    ]);
    const detail = await service.get(employee, 'ticket-1');
    expect(detail.entries).toEqual([]);
    expect(detail.attachments).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain('secret');
    expect(db.itTicketEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visibility: 'PUBLIC' }),
      }),
    );
    expect(db.itTicketAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entry: expect.objectContaining({ visibility: 'PUBLIC' }),
        }),
      }),
    );
  });
  it('creates ticket, computed priority, immutable actor and file entry in one transaction', async () => {
    const { service, db, state } = fixture();
    const detail = await service.create(
      employee,
      { ...input, requesterId: 'spoof', priority: 'URGENT' },
      [upload()],
    );
    expect(detail.ticket).toMatchObject({
      code: 'DND-IT-000001',
      priority: 'HIGH',
      requester: { id: 'employee', name: 'Employee' },
      version: 1,
    });
    expect(state().entries[0]).toMatchObject({
      kind: 'CREATED',
      visibility: 'PUBLIC',
      authorName: 'Employee',
    });
    expect(detail.attachments).toHaveLength(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('rolls back new ticket when entry insertion fails', async () => {
    const { service, db, state } = fixture();
    const before = structuredClone(state());
    db.itTicketEntry.create.mockRejectedValue(new Error('storage failure'));
    await expect(
      service.create(employee, { ...input, subject: 'New subject' }, [
        upload(),
      ]),
    ).rejects.toThrow('storage failure');
    expect(state()).toEqual(before);
  });
  it('CAS conflict never inserts a reply or attachment', async () => {
    const { service, db, state } = fixture();
    db.itTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.reply(
        employee,
        'ticket-1',
        { version: 1, body: 'reply', visibility: 'PUBLIC' },
        [upload()],
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'IT_SUPPORT_VERSION_CONFLICT',
      }),
    });
    expect(state().entries).toHaveLength(0);
  });
  it('rejects stale expected versions before mutation', async () => {
    const { service, db } = fixture({ version: 2 });
    await expect(
      service.reply(employee, 'ticket-1', {
        version: 1,
        body: 'reply',
        visibility: 'PUBLIC',
      }),
    ).rejects.toThrow('changed');
    expect(db.itTicket.updateMany).not.toHaveBeenCalled();
  });
  it('employee internal-note attempts roll back version', async () => {
    const { service, state } = fixture();
    await expect(
      service.reply(employee, 'ticket-1', {
        version: 1,
        body: 'hidden',
        visibility: 'INTERNAL',
      }),
    ).rejects.toThrow();
    expect(state().ticket.version).toBe(1);
    expect(state().entries).toHaveLength(0);
  });
  it('admin internal note changes only private activity timestamp and version', async () => {
    const { service, state } = fixture();
    await service.reply(
      admin,
      'ticket-1',
      { version: 1, body: 'Internal diagnosis', visibility: 'INTERNAL' },
      [upload('private')],
    );
    expect(state().ticket.publicUpdatedAt).toEqual(at);
    expect(state().ticket.firstResponseAt).toBeNull();
    const own = await service.get(employee, 'ticket-1');
    expect(own.ticket.updatedAt).toBe(at.toISOString());
    expect(own.entries).toHaveLength(0);
    expect(own.attachments).toHaveLength(0);
  });
  it('requester reply resumes WAITING_REQUESTER automatically', async () => {
    const { service, state } = fixture({ status: 'WAITING_REQUESTER' });
    await service.reply(employee, 'ticket-1', {
      version: 1,
      body: 'The requested screenshot',
      visibility: 'PUBLIC',
    });
    expect(state().ticket.status).toBe('IN_PROGRESS');
    expect(state().entries[0]).toMatchObject({
      status: 'IN_PROGRESS',
      changedFields: ['status'],
    });
    expect(state().ticket.firstResponseAt).toBeNull();
  });
  it('first substantive public admin reply sets first response and preserves it later', async () => {
    const { service, state } = fixture();
    await service.reply(admin, 'ticket-1', {
      version: 1,
      body: 'We are investigating.',
      visibility: 'PUBLIC',
    });
    const first = state().ticket.firstResponseAt;
    expect(first).toBeInstanceOf(Date);
    await service.reply(admin, 'ticket-1', {
      version: 2,
      body: 'Update',
      visibility: 'PUBLIC',
    });
    expect(state().ticket.firstResponseAt).toEqual(first);
  });
  it('an administrator replying to their own ticket is not a first response', async () => {
    const { service, state } = fixture({ requesterId: 'admin' });
    await service.reply(admin, 'ticket-1', {
      version: 1,
      body: 'More information',
      visibility: 'PUBLIC',
    });
    expect(state().ticket.firstResponseAt).toBeNull();
  });
  it.each(['CLOSED', 'CANCELLED'])(
    'blocks all replies on %s including admin internal',
    async (status) => {
      const { service, state } = fixture({ status });
      await expect(
        service.reply(admin, 'ticket-1', {
          version: 1,
          body: 'note',
          visibility: 'INTERNAL',
        }),
      ).rejects.toThrow('Reopen');
      expect(state().ticket.version).toBe(1);
    },
  );
  it('total attachment quotas include internal files without exposing counts', async () => {
    const { service, db, state } = fixture();
    db.itTicketAttachment.aggregate.mockResolvedValue({
      _count: 10,
      _sum: { size: 10 },
    });
    await expect(
      service.reply(
        employee,
        'ticket-1',
        { version: 1, body: 'file', visibility: 'PUBLIC' },
        [upload()],
      ),
    ).rejects.toThrow('attachment limit');
    expect(state().ticket.version).toBe(1);
    expect(state().attachments).toHaveLength(0);
  });
  it('requester can confirm or reopen resolved ticket, clearing resolution on reopen', async () => {
    const { service, state } = fixture({
      status: 'RESOLVED',
      resolution: 'Fixed',
      resolvedAt: at,
      firstResponseAt: at,
    });
    await service.action(employee, 'ticket-1', {
      version: 1,
      action: 'CONFIRM',
      message: '',
    });
    expect(state().ticket.status).toBe('CLOSED');
    await service.action(employee, 'ticket-1', {
      version: 2,
      action: 'REOPEN',
      message: 'Problem returned',
    });
    expect(state().ticket).toMatchObject({
      status: 'NEW',
      resolution: '',
      resolvedAt: null,
      closedAt: null,
      firstResponseAt: at,
    });
  });
  it('administrator cannot use requester actions on someone else ticket', async () => {
    const { service, state } = fixture({ status: 'RESOLVED' });
    await expect(
      service.action(admin, 'ticket-1', {
        version: 1,
        action: 'CONFIRM',
        message: '',
      }),
    ).rejects.toThrow();
    expect(state().ticket.version).toBe(1);
  });
  it('requester can cancel open ticket with reason', async () => {
    const { service, state } = fixture();
    await service.action(employee, 'ticket-1', {
      version: 1,
      action: 'CANCEL',
      message: 'No longer needed',
    });
    expect(state().ticket.status).toBe('CANCELLED');
    expect(state().entries[0].body).toBe('No longer needed');
  });
  it('triage requires ADMIN and a public solution to resolve', async () => {
    const { service, state } = fixture();
    const change = {
      version: 1,
      category: 'HARDWARE',
      priority: 'HIGH',
      status: 'RESOLVED',
      assigneeId: null,
      dueAt: null,
      reason: '',
    };
    await expect(service.triage(employee, 'ticket-1', change)).rejects.toThrow(
      'administrators',
    );
    await expect(service.triage(admin, 'ticket-1', change)).rejects.toThrow(
      'reason',
    );
    expect(state().ticket.version).toBe(1);
    await service.triage(admin, 'ticket-1', {
      ...change,
      reason: 'Updated printer driver.',
    });
    expect(state().ticket).toMatchObject({
      status: 'RESOLVED',
      resolution: 'Updated printer driver.',
    });
    expect(state().entries[0]).toMatchObject({
      kind: 'STATUS',
      visibility: 'PUBLIC',
      body: 'Updated printer driver.',
    });
  });
  it('assignment only is not a first public response', async () => {
    const { service, state } = fixture();
    await service.triage(admin, 'ticket-1', {
      version: 1,
      category: 'HARDWARE',
      priority: 'HIGH',
      status: 'NEW',
      assigneeId: 'admin',
      dueAt: null,
      reason: '',
    });
    expect(state().ticket.firstResponseAt).toBeNull();
    expect(state().ticket.assigneeName).toBe('Actual Admin');
  });
  it('rejects new inactive assignee but retains existing inactive assignment', async () => {
    const { service, db, state } = fixture({
      assigneeId: 'old-admin',
      assigneeName: 'Retired',
    });
    db.user.findFirst.mockResolvedValue(null as any);
    const change = {
      version: 1,
      category: 'HARDWARE',
      priority: 'NORMAL',
      status: 'NEW',
      assigneeId: 'new-admin',
      dueAt: null,
      reason: '',
    };
    await expect(service.triage(admin, 'ticket-1', change)).rejects.toThrow(
      'active administrator',
    );
    await service.triage(admin, 'ticket-1', {
      ...change,
      assigneeId: 'old-admin',
    });
    expect(state().ticket.assigneeId).toBe('old-admin');
  });
  it('rejects direct NEW reset; admin reopening requires reason and clears closed metadata', async () => {
    const { service, state } = fixture({
      status: 'CLOSED',
      resolution: 'Fixed',
      resolvedAt: at,
      closedAt: at,
    });
    const change = {
      version: 1,
      category: 'HARDWARE',
      priority: 'HIGH',
      status: 'NEW',
      assigneeId: null,
      dueAt: null,
      reason: 'Reopening',
    };
    await expect(service.triage(admin, 'ticket-1', change)).rejects.toThrow(
      'transition',
    );
    await expect(
      service.triage(admin, 'ticket-1', {
        ...change,
        status: 'IN_PROGRESS',
        reason: '',
      }),
    ).rejects.toThrow('reason');
    await service.triage(admin, 'ticket-1', {
      ...change,
      status: 'IN_PROGRESS',
    });
    expect(state().ticket).toMatchObject({
      status: 'IN_PROGRESS',
      resolution: '',
      resolvedAt: null,
      closedAt: null,
    });
  });
  it('private downloads require ticket ownership and public entry visibility', async () => {
    const { service, db } = fixture();
    await expect(service.attachment(employee, 'file-1')).rejects.toThrow(
      'not found',
    );
    expect(db.itTicketAttachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'file-1',
          ticket: { requesterId: 'employee' },
          entry: { visibility: 'PUBLIC' },
        },
      }),
    );
    db.itTicketAttachment.findFirst.mockResolvedValue({
      name: 'private',
      mimeType: 'text/plain',
      size: 1,
      content: Buffer.from('x'),
      entry: { visibility: 'INTERNAL' },
    } as any);
    await expect(service.attachment(employee, 'file-1')).rejects.toThrow(
      'not found',
    );
    expect(await service.attachment(admin, 'file-1')).toMatchObject({
      name: 'private',
    });
  });
  it('returns recent page chronological with project-scoped older cursor', async () => {
    const { service, db } = fixture({ version: 50 });
    const rows = Array.from({ length: 41 }, (_, i) => ({
      id: `entry-${50 - i}`,
      kind: 'REPLY',
      visibility: 'PUBLIC',
      body: String(50 - i),
      authorName: 'Employee',
      authorId: 'employee',
      createdAt: new Date(at.getTime() + (50 - i) * 1000),
      status: null,
      changedFields: [],
      attachments: [],
    }));
    db.itTicketEntry.findMany.mockResolvedValue(rows as any);
    const page = await service.entries(employee, 'ticket-1');
    expect(page.items).toHaveLength(40);
    expect(page.items[0].body).toBe('11');
    expect(page.items[39].body).toBe('50');
    expect(page.nextCursor).toBeTruthy();
    const bad = Buffer.from(
      JSON.stringify({
        ticketId: 'other',
        id: 'entry-11',
        createdAt: at.toISOString(),
      }),
    ).toString('base64url');
    await expect(service.entries(employee, 'ticket-1', bad)).rejects.toThrow(
      'cursor',
    );
  });
});
