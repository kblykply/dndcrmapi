import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Role } from "../common/types";
import { OrgActionDto, OrgAssignmentDto, OrgDefinitionDto, UpdateOrgDefinitionDto } from "./org-chart.dto";

export type OrgUser = { id: string; role: Role; originalRole?: Role; isPreview?: boolean };
const personSelect = { id: true, name: true, isActive: true } satisfies Prisma.UserSelect;
const include = {
  assignee: { select: personSelect },
  approvedBy: { select: personSelect },
  processes: {
    include: { card: { select: { id: true, code: true, title: true, status: true } } },
    orderBy: { cardId: "asc" as const },
  },
} satisfies Prisma.OrgChartNodeInclude;
export type OrganizationNode = Prisma.OrgChartNodeGetPayload<{ include: typeof include }>;
type TreeNode = OrganizationNode & { children: TreeNode[] };
const clean = (value?: string | null) => value?.trim() || null;

@Injectable()
export class OrgChartService {
  private readonly db: PrismaClient;

  constructor(prisma: PrismaService) { this.db = prisma as unknown as PrismaClient; }

  private preview(user: OrgUser) {
    if (!user?.id) throw new ForbiddenException("Unauthorized");
    return user.role === "PREVIEW" || user.originalRole === "PREVIEW" || user.isPreview === true;
  }

  private ensureEditor(user: OrgUser) {
    if (this.preview(user) || !["ADMIN", "MANAGER"].includes(user.role)) {
      throw new ForbiddenException("Only administrators and managers can edit the organization");
    }
  }

  private invalid(code: string, message: string): never {
    throw new BadRequestException({ code, message });
  }

  private async node(tx: Prisma.TransactionClient, id: string) {
    const node = await tx.orgChartNode.findUnique({ where: { id }, include });
    if (!node) throw new NotFoundException("Organization record not found");
    return node;
  }

  private checkVersion(node: OrganizationNode, version: number) {
    if (node.version !== version) {
      throw new ConflictException({ code: "ORG_VERSION_CONFLICT", message: "This record has changed. Reload it before saving." });
    }
  }

  private async validateDefinition(tx: Prisma.TransactionClient, dto: OrgDefinitionDto, id?: string) {
    if (!clean(dto.name)) this.invalid("ORG_NAME_REQUIRED", "A title is required");
    const parentId = clean(dto.parentId);
    const visited = new Set<string>(id ? [id] : []);
    let next = parentId;
    while (next) {
      if (visited.has(next)) this.invalid("ORG_CYCLE", "A reporting line cannot create a cycle");
      visited.add(next);
      const parent = await tx.orgChartNode.findUnique({ where: { id: next }, select: { parentId: true, status: true } });
      if (!parent || parent.status === "ARCHIVED") this.invalid("ORG_INVALID_PARENT", "Choose a non-archived reporting line");
      next = parent.parentId;
    }
    const code = clean(dto.code);
    if (code) {
      const duplicate = await tx.orgChartNode.findUnique({ where: { code }, select: { id: true } });
      if (duplicate && duplicate.id !== id) this.invalid("ORG_DUPLICATE_CODE", "This document code is already in use");
    }
    const ids = dto.processes.map((link) => link.cardId);
    if (new Set(ids).size !== ids.length) this.invalid("ORG_DUPLICATE_PROCESS", "A process can only be linked once");
    if (ids.length) {
      const count = await tx.qualityProcessCard.count({ where: { id: { in: ids }, status: { not: "ARCHIVED" } } });
      if (count !== ids.length) this.invalid("ORG_INVALID_PROCESS", "Choose active quality processes");
    }
    return {
      name: dto.name.trim(), kind: dto.kind, code, parentId, order: dto.order ?? 0,
      purpose: clean(dto.purpose), responsibilities: clean(dto.responsibilities),
      authority: clean(dto.authority), competencies: clean(dto.competencies),
      performanceIndicators: clean(dto.performanceIndicators),
      reviewDueAt: dto.reviewDueAt ? new Date(dto.reviewDueAt + "T00:00:00.000Z") : null,
    };
  }

  private snapshot(node: OrganizationNode): Prisma.InputJsonObject {
    // Preserve names and the entire definition even if linked people or processes change later.
    return JSON.parse(JSON.stringify(node)) as Prisma.InputJsonObject;
  }

  private async log(tx: Prisma.TransactionClient, actor: { id: string; name: string }, action: string,
    before: OrganizationNode | null, after: OrganizationNode, note?: string) {
    await tx.orgChartLog.create({
      data: {
        nodeId: after.id, actorId: actor.id, actorName: actor.name, action, note: clean(note),
        beforeJson: before ? this.snapshot(before) : Prisma.DbNull, afterJson: this.snapshot(after),
      },
    });
  }

  private async write<T>(user: OrgUser, operation: (tx: Prisma.TransactionClient, actor: { id: string; name: string }) => Promise<T>, requireEditor = true) {
    return this.db.$transaction(async (tx) => {
      // Serialize hierarchy writes so concurrent reparent/archive requests cannot create cycles or orphans.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(18410533)`;
      const actor = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, name: true, isActive: true, role: true } });
      if (!actor?.isActive) throw new ForbiddenException("An active user account is required");
      if (actor.role === "PREVIEW" || (requireEditor && !["ADMIN", "MANAGER"].includes(actor.role))) {
        throw new ForbiddenException("Your current account no longer has permission to perform this action");
      }
      return operation(tx, actor);
    }, { maxWait: 10000, timeout: 20000 });
  }

  async workspace(user: OrgUser) {
    if (this.preview(user)) return { nodes: [], users: [], qualityCards: [] };
    const [nodes, users, qualityCards] = await this.db.$transaction([
      this.db.orgChartNode.findMany({ include, orderBy: [{ order: "asc" }, { name: "asc" }] }),
      this.db.user.findMany({ where: { isActive: true, role: { not: "PREVIEW" } }, select: personSelect, orderBy: { name: "asc" } }),
      this.db.qualityProcessCard.findMany({
        where: { status: { not: "ARCHIVED" } }, select: { id: true, code: true, title: true, status: true }, orderBy: { sortOrder: "asc" },
      }),
    ]);
    return { nodes, users, qualityCards };
  }

  async listFlat(user: OrgUser) {
    if (this.preview(user)) return [];
    return this.db.orgChartNode.findMany({
      where: { status: { not: "ARCHIVED" } }, include, orderBy: [{ order: "asc" }, { name: "asc" }],
    });
  }

  async getTree(user: OrgUser) {
    const rows = await this.listFlat(user);
    const map = new Map<string, TreeNode>(rows.map((row) => [row.id, { ...row, children: [] }]));
    const roots: TreeNode[] = [];
    for (const row of rows) {
      const current = map.get(row.id)!;
      if (row.parentId && map.has(row.parentId)) map.get(row.parentId)!.children.push(current);
      else roots.push(current);
    }
    return roots;
  }

  async getOne(user: OrgUser, id: string) {
    if (this.preview(user)) return null;
    const node = await this.node(this.db, id);
    const logs = await this.db.orgChartLog.findMany({
      where: { nodeId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    });
    return { ...node, logs, logCount: await this.db.orgChartLog.count({ where: { nodeId: id } }) };
  }

  async history(user: OrgUser, id: string, cursor?: string) {
    if (this.preview(user)) return [];
    await this.node(this.db, id);
    return this.db.orgChartLog.findMany({
      where: { nodeId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async create(user: OrgUser, dto: OrgDefinitionDto) {
    this.ensureEditor(user);
    return this.write(user, async (tx, actor) => {
      const data = await this.validateDefinition(tx, dto);
      const after = await tx.orgChartNode.create({ data: { ...data, processes: { create: dto.processes } }, include });
      await this.log(tx, actor, "CREATED", null, after, dto.note);
      return after;
    });
  }

  async update(user: OrgUser, id: string, dto: UpdateOrgDefinitionDto) {
    this.ensureEditor(user);
    return this.write(user, async (tx, actor) => {
      const before = await this.node(tx, id);
      this.checkVersion(before, dto.version);
      if (before.status === "ARCHIVED") this.invalid("ORG_ARCHIVED", "Restore the record before editing");
      if (before.assigneeId && dto.kind !== "POSITION") this.invalid("ORG_ASSIGNED_KIND", "Remove the position assignment before changing its type");
      const data = await this.validateDefinition(tx, dto, id);
      const after = await tx.orgChartNode.update({
        where: { id }, data: {
          ...data, revision: { increment: 1 }, version: { increment: 1 },
          status: "DRAFT", approvedAt: null, approvedById: null,
          acknowledgedAt: null, acknowledgedRevision: null,
          processes: { deleteMany: {}, create: dto.processes },
        }, include,
      });
      await this.log(tx, actor, "DEFINITION_UPDATED", before, after, dto.note);
      return after;
    });
  }

  async assign(user: OrgUser, id: string, dto: OrgAssignmentDto) {
    this.ensureEditor(user);
    return this.write(user, async (tx, actor) => {
      const before = await this.node(tx, id);
      this.checkVersion(before, dto.version);
      if (before.kind !== "POSITION" || before.status === "ARCHIVED") this.invalid("ORG_NOT_POSITION", "Only a non-archived position can have an occupant");
      if (dto.userId === undefined) this.invalid("ORG_ASSIGNEE_REQUIRED", "Choose an occupant or explicitly clear the assignment");
      const userId = clean(dto.userId);
      if (userId) {
        const assignee = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true } });
        if (!assignee?.isActive || assignee.role === "PREVIEW") this.invalid("ORG_INVALID_ASSIGNEE", "Choose an active, non-preview user");
      }
      if (before.assigneeId === userId) return before;
      const after = await tx.orgChartNode.update({
        where: { id }, data: { assigneeId: userId, version: { increment: 1 }, acknowledgedAt: null, acknowledgedRevision: null }, include,
      });
      await this.log(tx, actor, "ASSIGNMENT_CHANGED", before, after, dto.note);
      return after;
    });
  }

  async action(user: OrgUser, id: string, action: "APPROVED" | "ARCHIVED" | "RESTORED" | "ACKNOWLEDGED", dto: OrgActionDto) {
    if (action === "ACKNOWLEDGED") {
      if (this.preview(user)) throw new ForbiddenException("Preview is read-only");
    } else this.ensureEditor(user);
    return this.write(user, async (tx, actor) => {
      const before = await this.node(tx, id);
      this.checkVersion(before, dto.version);
      const data: Prisma.OrgChartNodeUncheckedUpdateInput = { version: { increment: 1 } };
      if (action === "APPROVED") {
        if (before.status !== "DRAFT") this.invalid("ORG_NOT_DRAFT", "Only a draft can be approved");
        const required = [before.code, before.purpose, before.responsibilities, before.authority, before.reviewDueAt];
        if (before.kind === "POSITION") required.push(before.competencies);
        if (required.some((field) => !field)) this.invalid("ORG_INCOMPLETE", "Complete the code, purpose, responsibilities, authority, competencies and review date");
        if (before.reviewDueAt!.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) this.invalid("ORG_REVIEW_PAST", "The review date cannot be in the past");
        data.status = "APPROVED"; data.approvedAt = new Date(); data.approvedById = actor.id;
      } else if (action === "ACKNOWLEDGED") {
        if (before.assigneeId !== actor.id) throw new ForbiddenException("Only the current occupant can acknowledge their job description");
        if (before.status !== "APPROVED") this.invalid("ORG_NOT_APPROVED", "The job description is not approved");
        if (before.acknowledgedRevision === before.revision && before.acknowledgedAt) return before;
        data.acknowledgedAt = new Date(); data.acknowledgedRevision = before.revision;
      } else if (action === "ARCHIVED") {
        if (before.status === "ARCHIVED") return before;
        if (before.assigneeId) this.invalid("ORG_OCCUPIED", "Remove the current assignment before archiving");
        const children = await tx.orgChartNode.count({ where: { parentId: id, status: { not: "ARCHIVED" } } });
        if (children) this.invalid("ORG_HAS_CHILDREN", "Move or archive the child records first");
        data.status = "ARCHIVED";
      } else {
        if (before.status !== "ARCHIVED") this.invalid("ORG_NOT_ARCHIVED", "This record is not archived");
        if (before.parentId) {
          const parent = await this.node(tx, before.parentId);
          if (parent.status === "ARCHIVED") this.invalid("ORG_INVALID_PARENT", "Restore the parent record first");
        }
        data.status = "DRAFT"; data.approvedAt = null; data.approvedById = null;
        data.acknowledgedAt = null; data.acknowledgedRevision = null;
      }
      const after = await tx.orgChartNode.update({ where: { id }, data, include });
      await this.log(tx, actor, action, before, after, dto.note);
      return after;
    }, action !== "ACKNOWLEDGED");
  }
}
