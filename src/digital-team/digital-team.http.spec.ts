import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bodyParser from 'body-parser';
import request from 'supertest';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PreviewDataInterceptor } from '../common/preview-data.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectInput } from './digital-team.dto';
import { DigitalTeamModule } from './digital-team.module';

@Controller('body-limit-probe')
class BodyLimitProbeController {
  @Post()
  create(@Body() body: unknown) {
    return { accepted: Boolean(body) };
  }
}

const now = new Date('2026-09-16T10:00:00.000Z');
const member = {
  userId: null,
  name: 'Team member',
  title: 'Bilgi Teknolojileri',
  contact: '',
  isActive: true,
};

function fullProject(): ProjectInput {
  return {
    kind: 'PROJECT',
    name: 'DND infrastructure',
    summary: 'Application and database inventory',
    objective: 'Keep the digital inventory current',
    status: 'ACTIVE',
    priority: 'HIGH',
    health: 'ON_TRACK',
    ownerId: 'member-1',
    startDate: '2026-09-16',
    targetDate: '2026-10-16',
    cadence: 'Weekly',
    progress: 25,
    nextStep: 'Confirm service owners',
    links: [
      {
        id: 'link-1',
        label: 'System panel',
        url: 'https://example.com/panel',
        kind: 'PANEL',
      },
    ],
    workstreams: [
      {
        id: 'stream-1',
        title: 'Map services',
        description: 'Record backend and database dependencies',
        ownerId: 'member-1',
        status: 'ACTIVE',
        targetDate: '2026-09-30',
      },
    ],
    factors: [
      {
        id: 'factor-1',
        title: 'Supplier credentials',
        source: 'Hosting provider',
        impact: 'RISK',
        status: 'OPEN',
        ownerId: 'member-1',
        targetDate: '2026-09-25',
        nextAction: 'Confirm the administrator contact',
        notes: 'Waiting for the support response',
        url: 'https://example.com/support',
      },
    ],
  };
}

describe('Digital team HTTP pipeline', () => {
  let app: INestApplication;
  const database = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    digitalTeamMember: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    digitalProject: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    digitalProjectActivity: { findMany: jest.fn(), create: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const domainQueries = [
    ...Object.values(database.digitalTeamMember),
    ...Object.values(database.digitalProject),
    ...Object.values(database.digitalProjectActivity),
    database.user.findMany,
    database.user.findFirst,
  ];
  const endpoints = [
    { method: 'get', path: '/digital-team/workspace' },
    { method: 'post', path: '/digital-team/members', body: member },
    {
      method: 'put',
      path: '/digital-team/members/member-1',
      body: { ...member, version: 1 },
    },
    { method: 'post', path: '/digital-team/projects', body: fullProject() },
    { method: 'get', path: '/digital-team/projects/project-1' },
    {
      method: 'put',
      path: '/digital-team/projects/project-1',
      body: { ...fullProject(), version: 1 },
    },
    {
      method: 'post',
      path: '/digital-team/projects/project-1/updates',
      body: { body: 'Latest update', version: 1 },
    },
    { method: 'get', path: '/digital-team/projects/project-1/updates' },
  ] as const;

  async function expectEveryEndpointDenied(
    headers: Record<string, string> = {},
  ) {
    for (const endpoint of endpoints) {
      const call = request(app.getHttpServer())
        [endpoint.method](endpoint.path)
        .set(headers);
      if ('body' in endpoint) call.send(endpoint.body);
      await call.expect(403);
    }
    for (const query of domainQueries) expect(query).not.toHaveBeenCalled();
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [DigitalTeamModule],
      controllers: [BodyLimitProbeController],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          req.user = {
            id: 'test-user',
            role: req.headers['x-test-role'] ?? 'ADMIN',
            originalRole: req.headers['x-test-original-role'],
            isPreview: req.headers['x-test-is-preview'] === 'true',
          };
          return true;
        },
      })
      .useMocker((token) => (token === PrismaService ? database : undefined))
      .compile();
    app = module.createNestApplication();
    // Keep the production parser order: module-specific 1 MiB, then 100 KiB.
    app.use('/digital-team', bodyParser.json({ limit: '1mb' }));
    app.use(bodyParser.json());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalInterceptors(new PreviewDataInterceptor());
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    database.user.findUnique.mockResolvedValue({
      id: 'test-user',
      name: 'Test Admin',
      role: 'ADMIN',
      isActive: true,
    });
    database.user.findMany.mockResolvedValue([]);
    database.digitalTeamMember.findMany.mockImplementation(({ where }) =>
      where ? [{ id: 'member-1', isActive: true }] : [],
    );
    database.digitalProject.findMany.mockResolvedValue([]);
    database.digitalProjectActivity.findMany.mockResolvedValue([]);
    database.$executeRaw.mockResolvedValue(1);
    database.$transaction.mockImplementation((operation) =>
      operation(database),
    );
    database.digitalTeamMember.create.mockImplementation(({ data }) => ({
      ...data,
      id: 'member-1',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }));
    database.digitalProject.create.mockImplementation(({ data, select }) => {
      const stored = {
        ...data,
        id: 'project-1',
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      return Object.fromEntries(
        Object.keys(select).map((key) => [key, stored[key]]),
      );
    });
    database.digitalProjectActivity.create.mockImplementation(({ data }) => ({
      ...data,
      id: 'activity-1',
      createdAt: now,
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('allows an active ADMIN to read an empty workspace', async () => {
    const response = await request(app.getHttpServer())
      .get('/digital-team/workspace')
      .expect(200);
    expect(response.body).toEqual({
      me: { id: 'test-user', name: 'Test Admin', role: 'ADMIN' },
      canEdit: true,
      members: [],
      candidates: [],
      projects: [],
    });
  });

  it.each([
    'MANAGER',
    'PREVIEW',
    'SALES',
    'ACCOUNTING',
    'CALLCENTER',
    'AFTERSALES',
  ])(
    'rejects %s on all eight endpoints before any database query or preview rewriting',
    async (role) => {
      await expectEveryEndpointDenied({ 'x-test-role': role });
      expect(database.user.findUnique).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
      expect(database.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it.each([
    { 'x-test-original-role': 'PREVIEW' },
    { 'x-test-is-preview': 'true' },
  ])(
    'rejects an ADMIN identity carrying preview markers %p',
    async (headers) => {
      await expectEveryEndpointDenied(headers);
      expect(database.user.findUnique).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    { role: 'MANAGER', isActive: true },
    { role: 'ADMIN', isActive: false },
    null,
  ])(
    'rejects a stale ADMIN token when the database account is %p',
    async (account) => {
      database.user.findUnique.mockResolvedValue(
        account && { id: 'test-user', name: 'Test Admin', ...account },
      );
      await expectEveryEndpointDenied();
      expect(database.user.findUnique).toHaveBeenCalledTimes(endpoints.length);
    },
  );

  it('preserves the full project body through global whitelisting and records the actual actor', async () => {
    const input = fullProject();
    const response = await request(app.getHttpServer())
      .post('/digital-team/projects')
      .send({
        ...input,
        updatedByName: 'Spoofed',
        createdById: 'other-user',
        unexpected: true,
      })
      .expect(201);
    expect(response.body).toMatchObject({
      project: {
        ...input,
        id: 'project-1',
        version: 1,
        updatedByName: 'Test Admin',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      canEdit: true,
      updates: [],
      nextCursor: null,
    });
    expect(database.digitalProject.create).toHaveBeenCalledWith({
      data: {
        ...input,
        startDate: new Date('2026-09-16T00:00:00.000Z'),
        targetDate: new Date('2026-10-16T00:00:00.000Z'),
        linkCount: 1,
        workstreamCount: 1,
        doneWorkstreamCount: 0,
        openFactorCount: 1,
        blockingFactorCount: 0,
        createdById: 'test-user',
        createdByName: 'Test Admin',
        updatedById: 'test-user',
        updatedByName: 'Test Admin',
      },
      select: expect.any(Object),
    });
    expect(database.digitalProjectActivity.create).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        projectVersion: 1,
        kind: 'CREATED',
        changedFields: [],
        body: '',
        actorId: 'test-user',
        actorName: 'Test Admin',
      },
    });
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns module validation errors through the global pipeline', async () => {
    const response = await request(app.getHttpServer())
      .post('/digital-team/projects')
      .send({
        ...fullProject(),
        links: [{ ...fullProject().links[0], url: 'javascript:alert(1)' }],
      })
      .expect(400);
    expect(response.body).toEqual({
      code: 'DIGITAL_TEAM_INVALID',
      message: expect.any(String),
    });
    expect(database.digitalProject.create).not.toHaveBeenCalled();
    expect(database.digitalProjectActivity.create).not.toHaveBeenCalled();
  });

  it('accepts member contact at 240 characters and rejects 241 characters', async () => {
    const response = await request(app.getHttpServer())
      .post('/digital-team/members')
      .send({ ...member, contact: 'x'.repeat(240) })
      .expect(201);
    expect(response.body.contact).toHaveLength(240);
    database.digitalTeamMember.create.mockClear();
    const rejected = await request(app.getHttpServer())
      .post('/digital-team/members')
      .send({ ...member, contact: 'x'.repeat(241) })
      .expect(400);
    expect(rejected.body.code).toBe('DIGITAL_TEAM_INVALID');
    expect(database.digitalTeamMember.create).not.toHaveBeenCalled();
  });

  it('accepts a valid aggregate above 100 KiB through the scoped 1 MiB parser', async () => {
    const input = fullProject();
    input.workstreams = Array.from({ length: 50 }, (_, index) => ({
      ...input.workstreams[0],
      id: `stream-${index}`,
      description: 'ü'.repeat(1500),
    }));
    const size = Buffer.byteLength(JSON.stringify(input));
    expect(size).toBeGreaterThan(100 * 1024);
    expect(size).toBeLessThan(1024 * 1024);
    const response = await request(app.getHttpServer())
      .post('/digital-team/projects')
      .send(input)
      .expect(201);
    expect(response.body.project.workstreams).toEqual(input.workstreams);
    expect(database.digitalProject.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a module request above 1 MiB before guards or database access', async () => {
    await request(app.getHttpServer())
      .post('/digital-team/projects')
      .send({ ...fullProject(), summary: 'x'.repeat(1024 * 1024) })
      .expect(413);
    expect(database.user.findUnique).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.digitalProject.create).not.toHaveBeenCalled();
  });

  it('keeps the 100 KiB default limit on unrelated routes', async () => {
    await request(app.getHttpServer())
      .post('/body-limit-probe')
      .send({ text: 'small' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/body-limit-probe')
      .send({ text: 'x'.repeat(100 * 1024) })
      .expect(413);
    expect(database.user.findUnique).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
