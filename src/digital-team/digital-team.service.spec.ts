import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { DigitalTeamService } from './digital-team.service';
import type { ProjectInput } from './digital-team.dto';

const user = { id: 'admin-1', role: 'ADMIN' };
const time = new Date('2026-09-16T10:00:00Z');
function input(): ProjectInput {
  return {
    kind: 'PROJECT',
    name: 'Project',
    summary: '',
    objective: '',
    status: 'ACTIVE',
    priority: 'NORMAL',
    health: 'NOT_SET',
    ownerId: 'member-1',
    startDate: null,
    targetDate: null,
    cadence: '',
    progress: 25,
    nextStep: '',
    links: [],
    workstreams: [
      {
        id: 'stream-1',
        title: 'API',
        description: '',
        ownerId: 'member-1',
        status: 'ACTIVE',
        targetDate: null,
      },
    ],
    factors: [
      {
        id: 'factor-1',
        title: 'Supplier',
        source: '',
        impact: 'BLOCKING',
        status: 'OPEN',
        ownerId: 'member-1',
        targetDate: null,
        nextAction: '',
        notes: '',
        url: '',
      },
    ],
  };
}

describe('DigitalTeamService', () => {
  let database: any;
  let service: DigitalTeamService;
  let storedProject: any;
  let members: any[];
  let activities: any[];
  let account: any;
  const select = (row: any, fields: Record<string, unknown>) =>
    row
      ? Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]))
      : null;

  beforeEach(() => {
    account = {
      id: user.id,
      name: 'Actual administrator',
      role: 'ADMIN',
      isActive: true,
    };
    storedProject = {
      ...input(),
      id: 'project-1',
      version: 1,
      createdAt: time,
      updatedAt: time,
      updatedByName: 'Original author',
    };
    members = [
      {
        id: 'member-1',
        userId: null,
        name: 'Developer',
        title: 'IT',
        contact: '',
        isActive: true,
        version: 1,
        createdAt: time,
        updatedAt: time,
      },
    ];
    activities = [];
    database = {
      user: {
        findUnique: jest.fn(async () => account),
        findFirst: jest.fn(async ({ where }) =>
          where.id === 'linked-user' ? { id: 'linked-user' } : null,
        ),
        findMany: jest.fn(async () => [
          { id: user.id, name: account.name, role: 'ADMIN' },
        ]),
      },
      digitalTeamMember: {
        findMany: jest.fn(async ({ where, select: fields }) =>
          members
            .filter((member) => !where || where.id.in.includes(member.id))
            .map((member) => select(member, fields)),
        ),
        findUnique: jest.fn(async ({ where, select: fields }) =>
          select(
            members.find((member) => member.id === where.id),
            fields,
          ),
        ),
        findUniqueOrThrow: jest.fn(async ({ where, select: fields }) =>
          select(
            members.find((member) => member.id === where.id),
            fields,
          ),
        ),
        create: jest.fn(async ({ data, select: fields }) => {
          const member = {
            ...data,
            id: 'member-new',
            version: 1,
            createdAt: time,
            updatedAt: time,
          };
          members.push(member);
          return select(member, fields);
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const member = members.find(
            (candidate) =>
              candidate.id === where.id && candidate.version === where.version,
          );
          if (!member) return { count: 0 };
          Object.assign(member, data, { version: member.version + 1 });
          return { count: 1 };
        }),
      },
      digitalProject: {
        findUnique: jest.fn(async ({ where, select: fields }) =>
          select(storedProject?.id === where.id ? storedProject : null, fields),
        ),
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data, select: fields }) => {
          storedProject = {
            ...data,
            id: 'project-new',
            version: 1,
            createdAt: time,
            updatedAt: time,
          };
          return select(storedProject, fields);
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          if (
            !storedProject ||
            where.id !== storedProject.id ||
            where.version !== storedProject.version
          )
            return { count: 0 };
          storedProject = {
            ...storedProject,
            ...data,
            version: storedProject.version + 1,
            updatedAt: time,
          };
          return { count: 1 };
        }),
      },
      digitalProjectActivity: {
        create: jest.fn(async ({ data }) => {
          const activity = {
            ...data,
            id: `activity-${activities.length + 1}`,
            createdAt: time,
          };
          activities.push(activity);
          return activity;
        }),
        findMany: jest.fn(async ({ where, select: fields }) =>
          activities
            .filter(
              (activity) =>
                activity.projectId === where.projectId &&
                (!where.projectVersion ||
                  activity.projectVersion <= where.projectVersion.lte),
            )
            .reverse()
            .map((activity) => select(activity, fields)),
        ),
      },
      $executeRaw: jest.fn(async () => 1),
      $transaction: jest.fn(async (operation) => {
        const before = structuredClone({ storedProject, members, activities });
        try {
          return await operation(database);
        } catch (error) {
          ({ storedProject, members, activities } = before);
          throw error;
        }
      }),
    };
    service = new DigitalTeamService(database as PrismaService);
  });

  it.each([
    'MANAGER',
    'SALES',
    'CALLCENTER',
    'ACCOUNTING',
    'AFTERSALES',
    'PREVIEW',
  ])('rejects %s even when the person has a team assignment', async (role) => {
    await expect(service.workspace({ ...user, role })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.createProject({ ...user, role }, input()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.user.findUnique).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each([{ originalRole: 'PREVIEW' }, { isPreview: true }])(
    'rejects preview identities rewritten to ADMIN',
    async (flags) => {
      await expect(
        service.workspace({ ...user, ...flags }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.createMember({ ...user, ...flags }, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { role: 'MANAGER', isActive: true },
    { role: 'ADMIN', isActive: false },
  ])('rechecks the actual account on reads and writes: %p', async (current) => {
    account = current;
    await expect(service.workspace(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.createProject(user, input())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(database.digitalProject.findMany).not.toHaveBeenCalled();
    expect(database.digitalProject.create).not.toHaveBeenCalled();
  });

  it('returns a light workspace with limited candidate fields and latest note', async () => {
    const { links, workstreams, factors, ...project } = storedProject;
    database.digitalProject.findMany.mockResolvedValue([
      {
        ...project,
        linkCount: 0,
        workstreamCount: 1,
        doneWorkstreamCount: 0,
        openFactorCount: 1,
        blockingFactorCount: 1,
        activities: [
          {
            body: 'Waiting for supplier',
            createdAt: time,
            actorName: 'Actual administrator',
          },
        ],
      },
    ]);
    const result = await service.workspace(user);
    expect(result.canEdit).toBe(true);
    expect(result.projects[0]).not.toHaveProperty('workstreams');
    expect(result.projects[0].lastUpdate?.body).toBe('Waiting for supplier');
    expect(
      database.digitalProject.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty('workstreams');
    expect(database.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, role: { not: 'PREVIEW' } },
        select: { id: true, name: true, role: true },
      }),
    );
  });

  it('creates a project and its actor-attributed initial history atomically', async () => {
    const result = await service.createProject(user, {
      ...input(),
      updatedByName: 'Spoofed',
      version: 99,
    });
    expect(result.project.version).toBe(1);
    expect(result.project.updatedByName).toBe('Actual administrator');
    expect(result.updates).toEqual([
      expect.objectContaining({
        kind: 'CREATED',
        actorName: 'Actual administrator',
        projectVersion: 1,
      }),
    ]);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(storedProject).toMatchObject({
      workstreamCount: 1,
      doneWorkstreamCount: 0,
      openFactorCount: 1,
      blockingFactorCount: 1,
    });
  });

  it('updates nested counts and records exactly the changed input fields', async () => {
    const body = input();
    body.workstreams[0].status = 'DONE';
    body.factors[0].status = 'RESOLVED';
    body.progress = 80;
    const result = await service.updateProject(user, 'project-1', {
      ...body,
      version: 1,
    });
    expect(result.project.version).toBe(2);
    expect(result.updates[0].changedFields).toEqual([
      'progress',
      'workstreams',
      'factors',
    ]);
    expect(storedProject).toMatchObject({
      doneWorkstreamCount: 1,
      openFactorCount: 0,
      blockingFactorCount: 0,
    });
    expect(database.digitalProject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'project-1', version: 1 } }),
    );
  });

  it('rejects a stale version before modifying the project or history', async () => {
    await expect(
      service.updateProject(user, 'project-1', { ...input(), version: 2 }),
    ).rejects.toMatchObject({
      response: { code: 'DIGITAL_TEAM_VERSION_CONFLICT' },
    });
    expect(database.digitalProject.updateMany).not.toHaveBeenCalled();
    expect(database.digitalProjectActivity.create).not.toHaveBeenCalled();
  });

  it('rolls back a project change if its audit insert fails', async () => {
    database.digitalProjectActivity.create.mockRejectedValueOnce(
      new Error('history unavailable'),
    );
    await expect(
      service.updateProject(user, 'project-1', {
        ...input(),
        name: 'Changed',
        version: 1,
      }),
    ).rejects.toThrow('history unavailable');
    expect(storedProject).toMatchObject({ name: 'Project', version: 1 });
  });

  it('appends notes and increments the version without changing project fields', async () => {
    const before = input();
    const result = await service.addUpdate(user, 'project-1', {
      version: 1,
      body: 'Supplier confirmed delivery.',
    });
    expect(result.project).toMatchObject({ ...before, version: 2 });
    expect(result.updates[0]).toMatchObject({
      kind: 'NOTE',
      body: 'Supplier confirmed delivery.',
      changedFields: [],
      projectVersion: 2,
    });
    expect(
      database.digitalProject.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('workstreams');
  });

  it('preserves inactive historical assignments at the same field and child IDs', async () => {
    members[0].isActive = false;
    await expect(
      service.updateProject(user, 'project-1', {
        ...input(),
        summary: 'Historical owner retained',
        version: 1,
      }),
    ).resolves.toMatchObject({ project: { ownerId: 'member-1', version: 2 } });
  });

  it('rejects adding an inactive member to a new child even if already assigned elsewhere', async () => {
    members[0].isActive = false;
    const body = input();
    body.workstreams.push({ ...body.workstreams[0], id: 'stream-new' });
    await expect(
      service.updateProject(user, 'project-1', { ...body, version: 1 }),
    ).rejects.toMatchObject({ response: { code: 'DIGITAL_TEAM_INVALID' } });
    expect(database.digitalProject.updateMany).not.toHaveBeenCalled();
  });

  it('rejects new projects assigned to inactive or nonexistent members', async () => {
    members[0].isActive = false;
    await expect(service.createProject(user, input())).rejects.toMatchObject({
      response: { code: 'DIGITAL_TEAM_INVALID' },
    });
    members = [];
    await expect(service.createProject(user, input())).rejects.toMatchObject({
      response: { code: 'DIGITAL_TEAM_INVALID' },
    });
    expect(database.digitalProject.create).not.toHaveBeenCalled();
  });

  it('deactivates team members without changing account roles or existing project references', async () => {
    const member = members[0];
    const result = await service.updateMember(user, member.id, {
      ...member,
      isActive: false,
    });
    expect(result).toMatchObject({ isActive: false, version: 2 });
    expect(storedProject.ownerId).toBe(member.id);
    expect(storedProject.workstreams[0].ownerId).toBe(member.id);
    expect(account.role).toBe('ADMIN');
    expect(database.digitalProject.updateMany).not.toHaveBeenCalled();
  });

  it('allows future members without a CRM account, and validates new linked accounts', async () => {
    const member = {
      userId: null,
      name: 'New teammate',
      title: '',
      contact: '',
      isActive: true,
    };
    await expect(service.createMember(user, member)).resolves.toMatchObject(
      member,
    );
    await expect(
      service.createMember(user, { ...member, userId: 'missing-user' }),
    ).rejects.toMatchObject({ response: { code: 'DIGITAL_TEAM_INVALID' } });
    await expect(
      service.createMember(user, { ...member, userId: 'linked-user' }),
    ).resolves.toMatchObject({ userId: 'linked-user' });
  });

  it('returns a readable conflict for duplicate account links', async () => {
    database.digitalTeamMember.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.createMember(user, {
        userId: 'linked-user',
        name: 'Person',
        title: '',
        contact: '',
        isActive: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'DIGITAL_TEAM_ACCOUNT_LINKED' },
    });
  });

  it('uses bounded stable pagination and refuses a cursor belonging to another project', async () => {
    const rows = Array.from({ length: 41 }, (_, index) => ({
      id: `activity-${String(index).padStart(3, '0')}`,
      kind: 'NOTE',
      body: 'Update',
      changedFields: [],
      projectVersion: 1,
      actorName: 'Admin',
      createdAt: time,
    }));
    database.digitalProjectActivity.findMany.mockResolvedValueOnce(rows);
    const page = await service.updates(user, 'project-1');
    expect(page.items).toHaveLength(40);
    expect(page.nextCursor).toBeTruthy();
    await service.updates(user, 'project-1', page.nextCursor!);
    expect(
      database.digitalProjectActivity.findMany.mock.calls.at(-1)[0],
    ).toMatchObject({
      where: {
        projectId: 'project-1',
        AND: [
          {
            OR: [
              { createdAt: { lt: time } },
              { createdAt: time, id: { lt: 'activity-039' } },
            ],
          },
        ],
      },
      take: 41,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    storedProject.id = 'other-project';
    await expect(
      service.updates(user, 'other-project', page.nextCursor!),
    ).rejects.toMatchObject({ response: { code: 'DIGITAL_TEAM_INVALID' } });
  });
});
