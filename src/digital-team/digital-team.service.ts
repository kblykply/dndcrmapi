import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';
import { assertDigitalTeamIdentity } from './digital-team.guard';
import type { DigitalTeamUser } from './digital-team.guard';
import {
  identifier,
  invalidTeam,
  record,
  validateMember,
  validateNote,
  validateProject,
  version,
} from './digital-team.dto';
import type {
  ExternalFactor,
  MemberInput,
  ProjectInput,
  Workstream,
} from './digital-team.dto';

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string; role: string };
const personSelect = { id: true, name: true, role: true } as const;
const memberSelect = {
  id: true,
  userId: true,
  name: true,
  title: true,
  contact: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;
const scalarProjectSelect = {
  id: true,
  kind: true,
  name: true,
  summary: true,
  objective: true,
  status: true,
  priority: true,
  health: true,
  ownerId: true,
  startDate: true,
  targetDate: true,
  cadence: true,
  progress: true,
  nextStep: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  updatedByName: true,
} as const;
const projectSelect = {
  ...scalarProjectSelect,
  links: true,
  workstreams: true,
  factors: true,
} as const;
const activitySelect = {
  id: true,
  kind: true,
  body: true,
  changedFields: true,
  createdAt: true,
  actorName: true,
  projectVersion: true,
} as const;
type ProjectRow = Prisma.DigitalProjectGetPayload<{
  select: typeof projectSelect;
}>;
type MemberRow = Prisma.DigitalTeamMemberGetPayload<{
  select: typeof memberSelect;
}>;
type ActivityRow = Prisma.DigitalProjectActivityGetPayload<{
  select: typeof activitySelect;
}>;
const ACTIVITY_PAGE_SIZE = 40;

function conflict(): never {
  throw new ConflictException({
    code: 'DIGITAL_TEAM_VERSION_CONFLICT',
    message:
      'This record was changed by another user. Reload before saving again.',
  });
}

function checkVersion(current: number, expected: number) {
  if (current !== expected) conflict();
}

const asDate = (value: string | null) =>
  value ? new Date(value + 'T00:00:00.000Z') : null;
const asDay = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

@Injectable()
export class DigitalTeamService {
  private readonly db: PrismaClient;
  constructor(prisma: PrismaService) {
    this.db = prisma as unknown as PrismaClient;
  }

  private async authorize(
    user: DigitalTeamUser,
    tx: Tx = this.db,
  ): Promise<Actor> {
    assertDigitalTeamIdentity(user);
    const actor = await tx.user.findUnique({
      where: { id: user.id },
      select: { ...personSelect, isActive: true },
    });
    if (!actor?.isActive || actor.role !== 'ADMIN')
      throw new ForbiddenException(
        'An active administrator account is required.',
      );
    return { id: actor.id, name: actor.name, role: actor.role };
  }

  private async write<T>(
    user: DigitalTeamUser,
    operation: (tx: Tx, actor: Actor) => Promise<T>,
  ) {
    assertDigitalTeamIdentity(user);
    return this.db.$transaction(async (tx) => {
      // Serialize member deactivation with assignment validation across projects.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('digital-team:write'))`;
      return operation(tx, await this.authorize(user, tx));
    });
  }

  private memberView(member: MemberRow) {
    return {
      ...member,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    };
  }

  private projectView(project: ProjectRow) {
    return {
      ...project,
      startDate: asDay(project.startDate),
      targetDate: asDay(project.targetDate),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  private activityView(activity: ActivityRow) {
    return { ...activity, createdAt: activity.createdAt.toISOString() };
  }

  async workspace(user: DigitalTeamUser) {
    const me = await this.authorize(user);
    const [members, candidates, projects] = await Promise.all([
      this.db.digitalTeamMember.findMany({
        select: memberSelect,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      }),
      this.db.user.findMany({
        where: { isActive: true, role: { not: 'PREVIEW' } },
        select: personSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.db.digitalProject.findMany({
        select: {
          ...scalarProjectSelect,
          linkCount: true,
          workstreamCount: true,
          doneWorkstreamCount: true,
          openFactorCount: true,
          blockingFactorCount: true,
          activities: {
            where: { kind: 'NOTE' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { body: true, createdAt: true, actorName: true },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return {
      me,
      canEdit: true,
      members: members.map((member) => this.memberView(member)),
      candidates,
      projects: projects.map(({ activities, ...project }) => ({
        ...project,
        startDate: asDay(project.startDate),
        targetDate: asDay(project.targetDate),
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        lastUpdate: activities[0]
          ? {
              ...activities[0],
              createdAt: activities[0].createdAt.toISOString(),
            }
          : null,
      })),
    };
  }

  private async linkedUser(tx: Tx, input: MemberInput, previous?: MemberRow) {
    if (!input.userId || input.userId === previous?.userId) return;
    const linked = await tx.user.findFirst({
      where: { id: input.userId, isActive: true, role: { not: 'PREVIEW' } },
      select: { id: true },
    });
    if (!linked)
      invalidTeam(
        'Select an active non-preview CRM account, or leave the account link empty.',
      );
  }

  private memberError(error: unknown): never {
    if ((error as { code?: string })?.code === 'P2002') {
      throw new ConflictException({
        code: 'DIGITAL_TEAM_ACCOUNT_LINKED',
        message: 'This CRM account is already linked to a team member.',
      });
    }
    throw error;
  }

  async createMember(user: DigitalTeamUser, value: unknown) {
    try {
      return await this.write(user, async (tx) => {
        const input = validateMember(value);
        await this.linkedUser(tx, input);
        const member = await tx.digitalTeamMember.create({
          data: input,
          select: memberSelect,
        });
        return this.memberView(member);
      });
    } catch (error) {
      this.memberError(error);
    }
  }

  async updateMember(user: DigitalTeamUser, id: string, value: unknown) {
    try {
      return await this.write(user, async (tx) => {
        identifier(id, 'memberId');
        const input = validateMember(value);
        const expected = version(record(value, 'Team member').version);
        const current = await tx.digitalTeamMember.findUnique({
          where: { id },
          select: memberSelect,
        });
        if (!current) throw new NotFoundException('Team member not found.');
        checkVersion(current.version, expected);
        await this.linkedUser(tx, input, current);
        const changed = await tx.digitalTeamMember.updateMany({
          where: { id, version: expected },
          data: { ...input, version: { increment: 1 } },
        });
        if (changed.count !== 1) conflict();
        return this.memberView(
          await tx.digitalTeamMember.findUniqueOrThrow({
            where: { id },
            select: memberSelect,
          }),
        );
      });
    } catch (error) {
      this.memberError(error);
    }
  }

  private async requireProject(tx: Tx, id: string) {
    identifier(id, 'projectId');
    const project = await tx.digitalProject.findUnique({
      where: { id },
      select: projectSelect,
    });
    if (!project) throw new NotFoundException('Digital project not found.');
    return project;
  }

  private async memberReferences(
    tx: Tx,
    input: ProjectInput,
    previous?: ProjectRow,
  ) {
    const oldStreams = new Map(
      ((previous?.workstreams ?? []) as Workstream[]).map((stream) => [
        stream.id,
        stream.ownerId,
      ]),
    );
    const oldFactors = new Map(
      ((previous?.factors ?? []) as ExternalFactor[]).map((factor) => [
        factor.id,
        factor.ownerId,
      ]),
    );
    const references = [
      { id: input.ownerId, previous: previous?.ownerId },
      ...input.workstreams.map((stream) => ({
        id: stream.ownerId,
        previous: oldStreams.get(stream.id),
      })),
      ...input.factors.map((factor) => ({
        id: factor.ownerId,
        previous: oldFactors.get(factor.id),
      })),
    ].filter(
      (
        reference,
      ): reference is { id: string; previous: string | null | undefined } =>
        reference.id !== null,
    );
    const ids = [...new Set(references.map((reference) => reference.id))];
    if (!ids.length) return;
    const members = await tx.digitalTeamMember.findMany({
      where: { id: { in: ids } },
      select: { id: true, isActive: true },
    });
    const byId = new Map(members.map((member) => [member.id, member]));
    for (const reference of references) {
      const member = byId.get(reference.id);
      if (!member)
        invalidTeam('One or more assigned team members do not exist.');
      if (!member.isActive && reference.previous !== reference.id)
        invalidTeam(
          'New assignments require an active team member. Existing inactive-member assignments may be retained.',
        );
    }
  }

  private projectData(input: ProjectInput) {
    return {
      ...input,
      startDate: asDate(input.startDate),
      targetDate: asDate(input.targetDate),
      links: input.links as Prisma.InputJsonValue,
      workstreams: input.workstreams as Prisma.InputJsonValue,
      factors: input.factors as Prisma.InputJsonValue,
      linkCount: input.links.length,
      workstreamCount: input.workstreams.length,
      doneWorkstreamCount: input.workstreams.filter(
        (stream) => stream.status === 'DONE',
      ).length,
      openFactorCount: input.factors.filter(
        (factor) => factor.status === 'OPEN',
      ).length,
      blockingFactorCount: input.factors.filter(
        (factor) => factor.status === 'OPEN' && factor.impact === 'BLOCKING',
      ).length,
    };
  }

  private async log(
    tx: Tx,
    actor: Actor,
    projectId: string,
    projectVersion: number,
    kind: 'CREATED' | 'UPDATED' | 'NOTE',
    changedFields: string[] = [],
    body = '',
  ) {
    await tx.digitalProjectActivity.create({
      data: {
        projectId,
        projectVersion,
        kind,
        changedFields,
        body,
        actorId: actor.id,
        actorName: actor.name,
      },
    });
  }

  private cursor(projectId: string, activity: ActivityRow) {
    return Buffer.from(
      JSON.stringify({
        projectId,
        id: activity.id,
        createdAt: activity.createdAt.toISOString(),
      }),
    ).toString('base64url');
  }

  private readCursor(
    projectId: string,
    cursor?: string,
  ): Prisma.DigitalProjectActivityWhereInput | undefined {
    if (cursor === undefined) return undefined;
    try {
      if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        invalidTeam('Invalid update-history cursor.');
      const data = record(
        JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
        'cursor',
      );
      const id = identifier(data.id, 'cursor.id');
      const createdAt = new Date(String(data.createdAt));
      if (
        data.projectId !== projectId ||
        !Number.isFinite(createdAt.getTime()) ||
        createdAt.toISOString() !== data.createdAt
      )
        invalidTeam('The update-history cursor is invalid for this project.');
      return {
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
      };
    } catch {
      invalidTeam('Invalid update-history cursor.');
    }
  }

  private async activityPage(
    tx: Tx,
    projectId: string,
    cursor?: string,
    maximumVersion?: number,
  ) {
    const after = this.readCursor(projectId, cursor);
    const rows = await tx.digitalProjectActivity.findMany({
      where: {
        projectId,
        ...(maximumVersion === undefined
          ? {}
          : { projectVersion: { lte: maximumVersion } }),
        ...(after ? { AND: [after] } : {}),
      },
      select: activitySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ACTIVITY_PAGE_SIZE + 1,
    });
    const items = rows.slice(0, ACTIVITY_PAGE_SIZE);
    return {
      items: items.map((activity) => this.activityView(activity)),
      nextCursor:
        rows.length > ACTIVITY_PAGE_SIZE
          ? this.cursor(projectId, items[items.length - 1])
          : null,
    };
  }

  private async detail(tx: Tx, project: ProjectRow) {
    const history = await this.activityPage(
      tx,
      project.id,
      undefined,
      project.version,
    );
    return {
      project: this.projectView(project),
      canEdit: true,
      updates: history.items,
      nextCursor: history.nextCursor,
    };
  }

  async getProject(user: DigitalTeamUser, id: string) {
    await this.authorize(user);
    return this.detail(this.db, await this.requireProject(this.db, id));
  }

  async createProject(user: DigitalTeamUser, value: unknown) {
    return this.write(user, async (tx, actor) => {
      const input = validateProject(value);
      await this.memberReferences(tx, input);
      const project = await tx.digitalProject.create({
        data: {
          ...this.projectData(input),
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
        select: projectSelect,
      });
      await this.log(tx, actor, project.id, project.version, 'CREATED');
      return this.detail(tx, project);
    });
  }

  async updateProject(user: DigitalTeamUser, id: string, value: unknown) {
    return this.write(user, async (tx, actor) => {
      const input = validateProject(value);
      const expected = version(record(value, 'Project').version);
      const current = await this.requireProject(tx, id);
      checkVersion(current.version, expected);
      await this.memberReferences(tx, input, current);
      const previous = this.projectView(current);
      const changedFields = (
        Object.keys(input) as (keyof ProjectInput)[]
      ).filter((field) => !isDeepStrictEqual(input[field], previous[field]));
      const changed = await tx.digitalProject.updateMany({
        where: { id, version: expected },
        data: {
          ...this.projectData(input),
          version: { increment: 1 },
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });
      if (changed.count !== 1) conflict();
      await this.log(tx, actor, id, expected + 1, 'UPDATED', changedFields);
      return this.detail(tx, await this.requireProject(tx, id));
    });
  }

  async addUpdate(user: DigitalTeamUser, id: string, value: unknown) {
    return this.write(user, async (tx, actor) => {
      const input = validateNote(value);
      const current = await this.requireProject(tx, id);
      checkVersion(current.version, input.version);
      const changed = await tx.digitalProject.updateMany({
        where: { id, version: input.version },
        data: {
          version: { increment: 1 },
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });
      if (changed.count !== 1) conflict();
      await this.log(tx, actor, id, input.version + 1, 'NOTE', [], input.body);
      return this.detail(tx, await this.requireProject(tx, id));
    });
  }

  async updates(user: DigitalTeamUser, id: string, cursor?: string) {
    await this.authorize(user);
    const project = await this.requireProject(this.db, id);
    return this.activityPage(this.db, project.id, cursor);
  }
}
