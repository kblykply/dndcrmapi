import { ValidationPipe } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PreviewDataInterceptor } from '../common/preview-data.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { ItSupportModule } from './it-support.module';

const now = new Date('2026-09-16T12:00:00.000Z');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
  'base64',
);
const createBody = {
  subject: 'Cannot access the CRM',
  description: 'The sign-in page reports a connection error.',
  type: 'INCIDENT',
  category: 'ACCESS',
  impact: 'SINGLE',
  urgency: 'NORMAL',
  system: 'CRM',
  location: 'Head office',
};
const triageBody = {
  version: 1,
  category: 'ACCESS',
  priority: 'NORMAL',
  status: 'IN_PROGRESS',
  assigneeId: null,
  dueAt: null,
  reason: 'Checking access',
};

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    number: 1,
    ...createBody,
    status: 'NEW',
    priority: 'NORMAL',
    requesterId: 'test-user',
    requesterName: 'Test Employee',
    assigneeId: null,
    assigneeName: null,
    resolution: '',
    dueAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    publicUpdatedAt: now,
    ...overrides,
  };
}

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attachment-1',
    ticketId: 'ticket-1',
    entryId: 'entry-1',
    name: 'screenshot.png',
    mimeType: 'image/png',
    size: png.length,
    content: png,
    createdAt: now,
    ...overrides,
  };
}

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    ticketId: 'ticket-1',
    kind: 'CREATED',
    visibility: 'PUBLIC',
    body: createBody.description,
    authorId: 'test-user',
    authorName: 'Test Employee',
    status: 'NEW',
    changedFields: [],
    ticketVersion: 1,
    createdAt: now,
    attachments: [],
    ...overrides,
  };
}

describe('IT support HTTP pipeline', () => {
  let app: INestApplication;
  let currentTicket = ticketRow();
  let currentFile = {
    ...attachmentRow(),
    entry: entryRow(),
    ticket: ticketRow(),
  };
  let transactionDepth = 0;
  const writeLocations: boolean[] = [];
  const database = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    itTicket: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    itTicketEntry: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    itTicketAttachment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const ticketQueries = [
    ...Object.values(database.itTicket),
    ...Object.values(database.itTicketEntry),
    ...Object.values(database.itTicketAttachment),
  ];
  const endpoints = [
    { method: 'get', path: '/it-support/workspace' },
    { method: 'get', path: '/it-support/tickets' },
    { method: 'post', path: '/it-support/tickets', body: createBody },
    { method: 'get', path: '/it-support/tickets/ticket-1' },
    { method: 'get', path: '/it-support/tickets/ticket-1/entries' },
    {
      method: 'post',
      path: '/it-support/tickets/ticket-1/entries',
      body: { version: 1, body: 'Additional details', visibility: 'PUBLIC' },
    },
    {
      method: 'post',
      path: '/it-support/tickets/ticket-1/actions',
      body: { version: 1, action: 'CANCEL', message: 'No longer required' },
    },
    {
      method: 'put',
      path: '/it-support/tickets/ticket-1/triage',
      body: triageBody,
    },
    { method: 'get', path: '/it-support/attachments/attachment-1' },
  ] as const;

  function currentAccount(role = 'SALES', isActive = true) {
    database.user.findUnique.mockResolvedValue({
      id: 'test-user',
      name: 'Test Employee',
      role,
      isActive,
    });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ItSupportModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          req.user = {
            id: 'test-user',
            role: req.headers['x-test-role'] ?? 'SALES',
            originalRole: req.headers['x-test-original-role'],
            isPreview: req.headers['x-test-is-preview'] === 'true',
          };
          return true;
        },
      })
      .useMocker((token) => (token === PrismaService ? database : undefined))
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalInterceptors(new PreviewDataInterceptor());
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    currentTicket = ticketRow();
    currentFile = {
      ...attachmentRow(),
      entry: entryRow(),
      ticket: ticketRow(),
    };
    transactionDepth = 0;
    writeLocations.length = 0;
    currentAccount();
    database.user.findMany.mockResolvedValue([]);
    database.$transaction.mockImplementation(async (operation) => {
      transactionDepth += 1;
      try {
        return await (typeof operation === 'function'
          ? operation(database)
          : Promise.all(operation));
      } finally {
        transactionDepth -= 1;
      }
    });
    database.$executeRaw.mockResolvedValue(1);
    database.itTicket.findUnique.mockResolvedValue(ticketRow());
    database.itTicket.findFirst.mockImplementation(({ where }) =>
      where.id === currentTicket.id &&
      (!where.requesterId || where.requesterId === currentTicket.requesterId)
        ? currentTicket
        : null,
    );
    database.itTicket.findMany.mockImplementation(({ where }) =>
      !where.requesterId || where.requesterId === currentTicket.requesterId
        ? [currentTicket]
        : [],
    );
    database.itTicket.count.mockResolvedValue(1);
    database.itTicket.updateMany.mockResolvedValue({ count: 1 });
    database.itTicket.update.mockImplementation(({ data }) => ticketRow(data));
    database.itTicket.create.mockImplementation(({ data }) => {
      writeLocations.push(transactionDepth > 0);
      return ticketRow(data);
    });
    database.itTicketEntry.findUnique.mockResolvedValue(entryRow());
    database.itTicketEntry.findMany.mockResolvedValue([entryRow()]);
    database.itTicketEntry.create.mockImplementation(({ data }) => {
      writeLocations.push(transactionDepth > 0);
      return entryRow(data);
    });
    database.itTicketAttachment.findMany.mockResolvedValue([]);
    database.itTicketAttachment.findUnique.mockResolvedValue({
      ...attachmentRow(),
      entry: entryRow(),
      ticket: ticketRow(),
    });
    database.itTicketAttachment.findFirst.mockImplementation(({ where }) =>
      where.id === currentFile.id &&
      (!where.ticket?.requesterId ||
        where.ticket.requesterId === currentFile.ticket.requesterId) &&
      (!where.entry?.visibility ||
        where.entry.visibility === currentFile.entry.visibility)
        ? currentFile
        : null,
    );
    database.itTicketAttachment.create.mockImplementation(({ data }) =>
      attachmentRow(data),
    );
    database.itTicketAttachment.createMany.mockResolvedValue({ count: 1 });
    database.itTicketAttachment.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { size: null },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    'ADMIN',
    'MANAGER',
    'SALES',
    'CALLCENTER',
    'AFTERSALES',
    'ACCOUNTING',
  ])(
    'allows an active %s account to use its own workspace and ticket',
    async (role) => {
      currentAccount(role);
      const workspace = await request(app.getHttpServer())
        .get('/it-support/workspace')
        .set('x-test-role', role)
        .expect(200);
      expect(workspace.body).toMatchObject({
        me: { id: 'test-user', role },
        canManage: role === 'ADMIN',
      });
      const detail = await request(app.getHttpServer())
        .get('/it-support/tickets/ticket-1')
        .set('x-test-role', role)
        .expect(200);
      expect(detail.body.ticket.requester.id).toBe('test-user');
      expect(detail.body.canManage).toBe(role === 'ADMIN');
    },
  );

  it.each([
    { 'x-test-role': 'PREVIEW' },
    { 'x-test-role': 'ADMIN', 'x-test-original-role': 'PREVIEW' },
    { 'x-test-role': 'ADMIN', 'x-test-is-preview': 'true' },
  ])(
    'rejects preview identity %p on every endpoint before querying the database',
    async (headers) => {
      for (const endpoint of endpoints) {
        const call = request(app.getHttpServer())
          [endpoint.method](endpoint.path)
          .set(headers);
        if ('body' in endpoint) call.send(endpoint.body);
        await call.expect(403);
      }
      expect(database.user.findUnique).not.toHaveBeenCalled();
      expect(database.user.findMany).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
      for (const query of ticketQueries) expect(query).not.toHaveBeenCalled();
    },
  );

  it('rejects an inactive account on every endpoint before ticket access', async () => {
    currentAccount('ADMIN', false);
    for (const endpoint of endpoints) {
      const call = request(app.getHttpServer())
        [endpoint.method](endpoint.path)
        .set('x-test-role', 'ADMIN');
      if ('body' in endpoint) call.send(endpoint.body);
      await call.expect(403);
    }
    for (const query of ticketQueries) expect(query).not.toHaveBeenCalled();
  });

  it('creates a JSON ticket through the global pipe using the current account identity', async () => {
    const response = await request(app.getHttpServer())
      .post('/it-support/tickets')
      .send({
        ...createBody,
        requesterId: 'another-user',
        priority: 'URGENT',
        assigneeId: 'another-user',
      })
      .expect(201);
    expect(response.body.ticket).toMatchObject({
      ...createBody,
      requester: { id: 'test-user', name: 'Test Employee' },
      priority: 'NORMAL',
    });
    expect(database.itTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ...createBody,
          requesterId: 'test-user',
          requesterName: 'Test Employee',
          priority: 'NORMAL',
        }),
      }),
    );
    expect(database.itTicketEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketId: 'ticket-1',
          kind: 'CREATED',
          visibility: 'PUBLIC',
          authorId: 'test-user',
        }),
      }),
    );
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it('parses a multipart JSON payload and creates the ticket, entry and attachments in one transaction', async () => {
    const response = await request(app.getHttpServer())
      .post('/it-support/tickets')
      .field('payload', JSON.stringify(createBody))
      .attach('files', png, {
        filename: 'screen.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(response.body.ticket.subject).toBe(createBody.subject);
    expect(database.itTicket.create).toHaveBeenCalledTimes(1);
    expect(database.itTicketEntry.create).toHaveBeenCalledTimes(1);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.itTicketEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attachments: {
            create: [
              {
                ticketId: 'ticket-1',
                name: 'screen.png',
                mimeType: 'image/png',
                size: png.length,
                content: new Uint8Array(png),
              },
            ],
          },
        }),
      }),
    );
    expect(writeLocations).toEqual([true, true]);
  });

  it('rejects invalid multipart JSON before creating any records', async () => {
    await request(app.getHttpServer())
      .post('/it-support/tickets')
      .field('payload', '{invalid')
      .attach('files', png, {
        filename: 'screen.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(database.itTicket.create).not.toHaveBeenCalled();
    expect(database.itTicketEntry.create).not.toHaveBeenCalled();
    expect(database.itTicketAttachment.create).not.toHaveBeenCalled();
    expect(database.itTicketAttachment.createMany).not.toHaveBeenCalled();
  });

  it('preserves a Turkish UTF-8 filename through multipart parsing', async () => {
    await request(app.getHttpServer())
      .post('/it-support/tickets')
      .field('payload', JSON.stringify(createBody))
      .attach('files', png, {
        filename: 'görüntü-bağlantı-İŞ.png',
        contentType: 'image/png',
      })
      .expect(201);
    const saved =
      database.itTicketEntry.create.mock.calls[0][0].data.attachments.create;
    expect(saved[0].name).toBe('görüntü-bağlantı-İŞ.png');
  });

  it('rejects four files before creating any records', async () => {
    const call = request(app.getHttpServer())
      .post('/it-support/tickets')
      .field('payload', JSON.stringify(createBody));
    for (let i = 0; i < 4; i++)
      call.attach('files', png, {
        filename: `screen-${i}.png`,
        contentType: 'image/png',
      });
    await call.expect(400);
    expect(database.itTicket.create).not.toHaveBeenCalled();
    expect(database.itTicketEntry.create).not.toHaveBeenCalled();
    expect(database.itTicketAttachment.create).not.toHaveBeenCalled();
    expect(database.itTicketAttachment.createMany).not.toHaveBeenCalled();
  });

  it('accepts exactly three files together with the create payload', async () => {
    const call = request(app.getHttpServer())
      .post('/it-support/tickets')
      .field('payload', JSON.stringify(createBody));
    for (let index = 0; index < 3; index += 1) {
      call.attach('files', png, {
        filename: `screen-${index}.png`,
        contentType: 'image/png',
      });
    }
    await call.expect(201);
    const saved =
      database.itTicketEntry.create.mock.calls[0][0].data.attachments.create;
    expect(saved).toHaveLength(3);
    expect(writeLocations).toEqual([true, true]);
  });

  it('accepts a reply multipart payload and keeps its attachment with the entry transaction', async () => {
    await request(app.getHttpServer())
      .post('/it-support/tickets/ticket-1/entries')
      .field(
        'payload',
        JSON.stringify({
          version: 1,
          body: 'Screenshot of the error',
          visibility: 'PUBLIC',
        }),
      )
      .attach('files', png, { filename: 'error.png', contentType: 'image/png' })
      .expect(201);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.itTicketEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'REPLY',
          visibility: 'PUBLIC',
          body: 'Screenshot of the error',
          attachments: {
            create: [
              {
                ticketId: 'ticket-1',
                name: 'error.png',
                mimeType: 'image/png',
                size: png.length,
                content: new Uint8Array(png),
              },
            ],
          },
        }),
      }),
    );
    expect(writeLocations).toEqual([true]);
  });

  it('rejects a file above 5 MiB before creating any records', async () => {
    await request(app.getHttpServer())
      .post('/it-support/tickets')
      .field('payload', JSON.stringify(createBody))
      .attach('files', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(database.itTicket.create).not.toHaveBeenCalled();
    expect(database.itTicketEntry.create).not.toHaveBeenCalled();
    expect(database.itTicketAttachment.create).not.toHaveBeenCalled();
    expect(database.itTicketAttachment.createMany).not.toHaveBeenCalled();
  });

  it('accepts a valid file of exactly 5 MiB', async () => {
    const size = 5 * 1024 * 1024;
    await request(app.getHttpServer())
      .post('/it-support/tickets')
      .field('payload', JSON.stringify(createBody))
      .attach('files', Buffer.alloc(size, 'x'), {
        filename: 'diagnostics.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const saved =
      database.itTicketEntry.create.mock.calls[0][0].data.attachments.create;
    expect(saved[0].size).toBe(size);
  });

  it('uses the current MANAGER role to restrict a stale ADMIN token to MINE', async () => {
    currentAccount('MANAGER');
    const workspace = await request(app.getHttpServer())
      .get('/it-support/workspace')
      .set('x-test-role', 'ADMIN')
      .expect(200);
    expect(workspace.body).toEqual({
      me: { id: 'test-user', name: 'Test Employee', role: 'MANAGER' },
      canManage: false,
      agents: [],
    });
    expect(database.user.findMany).not.toHaveBeenCalled();
    const list = await request(app.getHttpServer())
      .get('/it-support/tickets?scope=MINE')
      .set('x-test-role', 'ADMIN')
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(database.itTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requesterId: 'test-user' },
      }),
    );
    for (const scope of ['ALL', 'ASSIGNED', 'UNASSIGNED']) {
      await request(app.getHttpServer())
        .get(`/it-support/tickets?scope=${scope}`)
        .set('x-test-role', 'ADMIN')
        .expect(403);
    }
    await request(app.getHttpServer())
      .put('/it-support/tickets/ticket-1/triage')
      .set('x-test-role', 'ADMIN')
      .send(triageBody)
      .expect(403);
    await request(app.getHttpServer())
      .post('/it-support/tickets/ticket-1/entries')
      .set('x-test-role', 'ADMIN')
      .send({
        version: 1,
        body: 'Internal instruction',
        visibility: 'INTERNAL',
      })
      .expect(403);
    expect(database.itTicket.update).not.toHaveBeenCalled();
    expect(database.itTicketEntry.create).not.toHaveBeenCalled();
  });

  it('keeps employee list queries and every statistic scoped to their own requester ID', async () => {
    currentTicket = ticketRow({
      requesterId: 'other-user',
      requesterName: 'Other Employee',
    });
    const response = await request(app.getHttpServer())
      .get('/it-support/tickets')
      .expect(200);
    expect(response.body.items).toEqual([]);
    expect(database.itTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requesterId: 'test-user' },
      }),
    );
    expect(database.itTicket.count).toHaveBeenCalledTimes(6);
    for (const [{ where }] of database.itTicket.count.mock.calls) {
      expect(
        where.requesterId === 'test-user' ||
          where.AND?.some(
            (clause: Record<string, unknown>) =>
              clause.requesterId === 'test-user',
          ),
      ).toBe(true);
    }
  });

  it('denies another employee ticket on detail, entries, reply, action and attachment routes', async () => {
    currentTicket = ticketRow({
      requesterId: 'other-user',
      requesterName: 'Other Employee',
    });
    currentFile = { ...currentFile, ticket: currentTicket };
    await request(app.getHttpServer())
      .get('/it-support/tickets/ticket-1')
      .expect(404);
    await request(app.getHttpServer())
      .get('/it-support/tickets/ticket-1/entries')
      .expect(404);
    await request(app.getHttpServer())
      .post('/it-support/tickets/ticket-1/entries')
      .send({ version: 1, body: 'Unauthorized reply', visibility: 'PUBLIC' })
      .expect(404);
    await request(app.getHttpServer())
      .post('/it-support/tickets/ticket-1/actions')
      .send({
        version: 1,
        action: 'CANCEL',
        message: 'Unauthorized cancellation',
      })
      .expect(404);
    await request(app.getHttpServer())
      .get('/it-support/attachments/attachment-1')
      .expect(404);
    expect(database.itTicket.findFirst).toHaveBeenCalledWith({
      where: { id: 'ticket-1', requesterId: 'test-user' },
    });
    expect(database.itTicketAttachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attachment-1',
          ticket: { requesterId: 'test-user' },
          entry: { visibility: 'PUBLIC' },
        },
      }),
    );
    expect(database.itTicketEntry.findMany).not.toHaveBeenCalled();
    expect(database.itTicketEntry.create).not.toHaveBeenCalled();
    expect(database.itTicket.updateMany).not.toHaveBeenCalled();
    expect(database.itTicket.update).not.toHaveBeenCalled();
  });

  it('hides internal notes and their attachment metadata on both requester history routes', async () => {
    const {
      content: _content,
      ticketId: _ticketId,
      ...metadata
    } = attachmentRow();
    const secret = entryRow({
      id: 'internal-entry',
      kind: 'NOTE',
      visibility: 'INTERNAL',
      body: 'Internal only',
      attachments: [
        { ...metadata, id: 'internal-file', entryId: 'internal-entry' },
      ],
    });
    database.itTicketEntry.findMany.mockResolvedValue([secret, entryRow()]);
    database.itTicketAttachment.findMany.mockResolvedValue([
      { ...metadata, entry: { visibility: 'PUBLIC' } },
      {
        ...metadata,
        id: 'internal-file',
        entryId: 'internal-entry',
        entry: { visibility: 'INTERNAL' },
      },
    ]);
    const detail = await request(app.getHttpServer())
      .get('/it-support/tickets/ticket-1')
      .expect(200);
    expect(
      detail.body.entries.map((entry: { id: string }) => entry.id),
    ).toEqual(['entry-1']);
    expect(
      detail.body.attachments.map((file: { id: string }) => file.id),
    ).toEqual(['attachment-1']);
    const history = await request(app.getHttpServer())
      .get('/it-support/tickets/ticket-1/entries')
      .expect(200);
    expect(history.body.items.map((entry: { id: string }) => entry.id)).toEqual(
      ['entry-1'],
    );
    expect(JSON.stringify(detail.body)).not.toContain('Internal only');
    expect(JSON.stringify(history.body)).not.toContain('Internal only');
    for (const [{ where }] of database.itTicketEntry.findMany.mock.calls) {
      expect(where.visibility).toBe('PUBLIC');
    }
    expect(database.itTicketAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entry: expect.objectContaining({ visibility: 'PUBLIC' }),
        }),
      }),
    );
  });

  it('denies direct download of an internal note attachment even on the requester own ticket', async () => {
    currentFile = {
      ...currentFile,
      entry: entryRow({ visibility: 'INTERNAL' }),
    };
    await request(app.getHttpServer())
      .get('/it-support/attachments/attachment-1')
      .expect(404);
    expect(database.itTicketAttachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entry: { visibility: 'PUBLIC' } }),
      }),
    );
  });

  it('allows an active ADMIN to read another ticket and download internal attachments', async () => {
    currentAccount('ADMIN');
    currentTicket = ticketRow({
      requesterId: 'other-user',
      requesterName: 'Other Employee',
    });
    currentFile = {
      ...currentFile,
      ticket: currentTicket,
      entry: entryRow({ visibility: 'INTERNAL' }),
    };
    const detail = await request(app.getHttpServer())
      .get('/it-support/tickets/ticket-1')
      .set('x-test-role', 'ADMIN')
      .expect(200);
    expect(detail.body.canManage).toBe(true);
    expect(detail.body.ticket.requester.id).toBe('other-user');
    expect(database.itTicket.findFirst).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
    });
    const file = await request(app.getHttpServer())
      .get('/it-support/attachments/attachment-1')
      .set('x-test-role', 'ADMIN')
      .expect(200);
    expect(file.body).toEqual(png);
  });

  it('downloads public attachments with private cache, nosniff and attachment disposition headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/it-support/attachments/attachment-1')
      .expect(200);
    expect(response.body).toEqual(png);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-length']).toBe(String(png.length));
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''screenshot.png",
    );
  });

  it('rejects an SVG disguised as a PNG before creating the ticket or entry', async () => {
    await request(app.getHttpServer())
      .post('/it-support/tickets')
      .field('payload', JSON.stringify(createBody))
      .attach('files', Buffer.from('<svg/>'), {
        filename: 'screen.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(database.itTicket.create).not.toHaveBeenCalled();
    expect(database.itTicketEntry.create).not.toHaveBeenCalled();
  });
});
