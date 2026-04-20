import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type PdcaPhase = "PLAN" | "DO" | "CHECK" | "ACT";
type PdcaStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
type PdcaPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type PdcaImpactLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type PdcaIssueCategory =
  | "SALES"
  | "MARKETING"
  | "OPERATIONS"
  | "CUSTOMER_SERVICE"
  | "FINANCE"
  | "HR"
  | "PROJECT"
  | "OTHER";

type ListPdcaQuery = {
  q?: string;
  phase?: PdcaPhase | "ALL";
  status?: PdcaStatus | "ALL";
  priority?: PdcaPriority | "ALL";
  impactLevel?: PdcaImpactLevel | "ALL";
  issueCategory?: PdcaIssueCategory | "ALL";
  assignedToId?: string;
  ownerId?: string;
  page?: string | number;
  pageSize?: string | number;
};

type CreatePdcaCaseDto = {
  title: string;
  problemSummary: string;
  department?: string | null;
  issueCategory?: PdcaIssueCategory | null;
  problemType?: string | null;
  impactLevel?: PdcaImpactLevel | null;
  priority?: PdcaPriority;
  phase?: PdcaPhase;
  status?: PdcaStatus;
  ownerId?: string | null;
  assignedToId?: string | null;
  rootCause?: string | null;
  targetResult?: string | null;
  actionPlan?: string | null;
  doNotes?: string | null;
  checkResult?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  finalDecision?: string | null;
  dueAt?: string | null;
};

type UpdatePdcaCaseDto = {
  title?: string;
  problemSummary?: string;
  department?: string | null;
  issueCategory?: PdcaIssueCategory | null;
  problemType?: string | null;
  impactLevel?: PdcaImpactLevel | null;
  priority?: PdcaPriority;
  phase?: PdcaPhase;
  status?: PdcaStatus;
  ownerId?: string | null;
  assignedToId?: string | null;
  rootCause?: string | null;
  targetResult?: string | null;
  actionPlan?: string | null;
  doNotes?: string | null;
  checkResult?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  finalDecision?: string | null;
  dueAt?: string | null;
  closedAt?: string | null;
};

type CreatePdcaLogDto = {
  note: string;
  phase?: PdcaPhase | null;
};

@Injectable()
export class PdcaService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private ensureAuth(user: ReqUser) {
    if (!user?.id) {
      throw new ForbiddenException("Unauthorized");
    }
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

  private isCallcenter(user: ReqUser) {
    return user.role === "CALLCENTER";
  }

  private canManageAll(user: ReqUser) {
    return this.isAdmin(user) || this.isManager(user);
  }

  private canCreate(user: ReqUser) {
    return (
      this.isAdmin(user) ||
      this.isManager(user) ||
      this.isSales(user) ||
      this.isCallcenter(user)
    );
  }

  private cleanStr(v?: string | null) {
    const x = String(v ?? "").trim();
    return x || null;
  }

  private toPositiveNumber(value: string | number | undefined, fallback: number) {
    if (value === undefined || value === null || value === "") return fallback;

    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      throw new BadRequestException("Invalid numeric parameter");
    }

    return Math.floor(num);
  }

  private parseDateOrNull(value?: string | null) {
    if (!value) return null;

    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
      throw new BadRequestException("Invalid date");
    }

    return dt;
  }

  private async validateUserId(
    userId?: string | null,
    fieldName = "userId",
  ) {
    if (!userId) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        role: true,
        name: true,
        email: true,
      },
    });

    if (!user || !user.isActive) {
      throw new BadRequestException(`${fieldName} is invalid`);
    }

    return user;
  }

  private buildAccessWhere(user: ReqUser): any {
    if (this.canManageAll(user)) {
      return {};
    }

    return {
      OR: [
        { assignedToId: user.id },
        { ownerId: user.id },
        { createdById: user.id },
      ],
    };
  }

  private pdcaIncludeDetail() {
    return {
      owner: {
        select: { id: true, name: true, email: true, role: true },
      },
      assignedTo: {
        select: { id: true, name: true, email: true, role: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
      logs: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        orderBy: { createdAt: "desc" as const },
      },
    };
  }

  private pdcaIncludeList() {
    return {
      owner: {
        select: { id: true, name: true, email: true, role: true },
      },
      assignedTo: {
        select: { id: true, name: true, email: true, role: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
      _count: {
        select: { logs: true },
      },
    };
  }

  private async getAccessibleCaseOrThrow(user: ReqUser, id: string): Promise<any> {
    const item = await this.prisma.pdcaCase.findUnique({
      where: { id },
      include: this.pdcaIncludeDetail(),
    });

    if (!item) {
      throw new NotFoundException("PDCA case not found");
    }

    const canAccess =
      this.canManageAll(user) ||
      item.assignedToId === user.id ||
      item.ownerId === user.id ||
      item.createdById === user.id;

    if (!canAccess) {
      throw new ForbiddenException("No access");
    }

    return item;
  }

  async listCases(user: ReqUser, query?: ListPdcaQuery) {
    this.ensureAuth(user);

    const page = this.toPositiveNumber(query?.page, 1);
    const pageSize = Math.min(100, this.toPositiveNumber(query?.pageSize, 20));
    const skip = (page - 1) * pageSize;

    const q = this.cleanStr(query?.q);
    const phase = query?.phase || "ALL";
    const status = query?.status || "ALL";
    const priority = query?.priority || "ALL";
    const impactLevel = query?.impactLevel || "ALL";
    const issueCategory = query?.issueCategory || "ALL";
    const assignedToId = this.cleanStr(query?.assignedToId);
    const ownerId = this.cleanStr(query?.ownerId);

    const where: any = {
      AND: [],
    };

    where.AND.push(this.buildAccessWhere(user));

    if (phase !== "ALL") {
      where.AND.push({ phase });
    }

    if (status !== "ALL") {
      where.AND.push({ status });
    }

    if (priority !== "ALL") {
      where.AND.push({ priority });
    }

    if (impactLevel !== "ALL") {
      where.AND.push({ impactLevel });
    }

    if (issueCategory !== "ALL") {
      where.AND.push({ issueCategory });
    }

    if (assignedToId) {
      where.AND.push({ assignedToId });
    }

    if (ownerId) {
      where.AND.push({ ownerId });
    }

    if (q) {
      where.AND.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { problemSummary: { contains: q, mode: "insensitive" } },
          { department: { contains: q, mode: "insensitive" } },
          { problemType: { contains: q, mode: "insensitive" } },
          { rootCause: { contains: q, mode: "insensitive" } },
          { actionPlan: { contains: q, mode: "insensitive" } },
          { targetResult: { contains: q, mode: "insensitive" } },
          { owner: { name: { contains: q, mode: "insensitive" } } },
          { assignedTo: { name: { contains: q, mode: "insensitive" } } },
          { createdBy: { name: { contains: q, mode: "insensitive" } } },
        ],
      });
    }

    const [items, total] = await Promise.all([
      this.prisma.pdcaCase.findMany({
        where,
        include: this.pdcaIncludeList(),
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.pdcaCase.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getCase(user: ReqUser, id: string) {
    this.ensureAuth(user);
    return this.getAccessibleCaseOrThrow(user, id);
  }

  async createCase(user: ReqUser, dto: CreatePdcaCaseDto) {
    this.ensureAuth(user);

    if (!this.canCreate(user)) {
      throw new ForbiddenException("No access to create PDCA case");
    }

    const title = this.cleanStr(dto.title);
    const problemSummary = this.cleanStr(dto.problemSummary);

    if (!title) {
      throw new BadRequestException("title is required");
    }

    if (!problemSummary) {
      throw new BadRequestException("problemSummary is required");
    }

    await this.validateUserId(dto.ownerId || null, "ownerId");
    await this.validateUserId(dto.assignedToId || null, "assignedToId");

    const dueAt = this.parseDateOrNull(dto.dueAt);

    const item = await this.prisma.pdcaCase.create({
      data: {
        title,
        problemSummary,
        department: this.cleanStr(dto.department),
        issueCategory: dto.issueCategory || null,
        problemType: this.cleanStr(dto.problemType),
        impactLevel: dto.impactLevel || null,
        priority: dto.priority || "MEDIUM",
        phase: dto.phase || "PLAN",
        status: dto.status || "OPEN",
        ownerId: this.cleanStr(dto.ownerId),
        assignedToId: this.cleanStr(dto.assignedToId),
        createdById: user.id,
        rootCause: this.cleanStr(dto.rootCause),
        targetResult: this.cleanStr(dto.targetResult),
        actionPlan: this.cleanStr(dto.actionPlan),
        doNotes: this.cleanStr(dto.doNotes),
        checkResult: this.cleanStr(dto.checkResult),
        correctiveAction: this.cleanStr(dto.correctiveAction),
        preventiveAction: this.cleanStr(dto.preventiveAction),
        finalDecision: this.cleanStr(dto.finalDecision),
        dueAt,
      },
      include: this.pdcaIncludeDetail(),
    });

    await this.audit.log(user, "PDCA_CASE_CREATE", "PdcaCase", item.id, {
      title: item.title,
      phase: item.phase,
      status: item.status,
      ownerId: item.ownerId,
      assignedToId: item.assignedToId,
    });

    await this.prisma.pdcaLog.create({
      data: {
        pdcaCaseId: item.id,
        createdById: user.id,
        phase: item.phase,
        note: `Case created in ${item.phase} phase`,
      },
    });

    return item;
  }

  async updateCase(user: ReqUser, id: string, dto: UpdatePdcaCaseDto) {
    const existing = await this.getAccessibleCaseOrThrow(user, id);

    const canEdit =
      this.canManageAll(user) ||
      existing.createdById === user.id ||
      existing.assignedToId === user.id ||
      existing.ownerId === user.id;

    if (!canEdit) {
      throw new ForbiddenException("No access");
    }

    const data: any = {};

    if (dto.title !== undefined) {
      const title = this.cleanStr(dto.title);
      if (!title) {
        throw new BadRequestException("title is required");
      }
      data.title = title;
    }

    if (dto.problemSummary !== undefined) {
      const problemSummary = this.cleanStr(dto.problemSummary);
      if (!problemSummary) {
        throw new BadRequestException("problemSummary is required");
      }
      data.problemSummary = problemSummary;
    }

    if (dto.department !== undefined) data.department = this.cleanStr(dto.department);
    if (dto.problemType !== undefined) data.problemType = this.cleanStr(dto.problemType);
    if (dto.rootCause !== undefined) data.rootCause = this.cleanStr(dto.rootCause);
    if (dto.targetResult !== undefined) data.targetResult = this.cleanStr(dto.targetResult);
    if (dto.actionPlan !== undefined) data.actionPlan = this.cleanStr(dto.actionPlan);
    if (dto.doNotes !== undefined) data.doNotes = this.cleanStr(dto.doNotes);
    if (dto.checkResult !== undefined) data.checkResult = this.cleanStr(dto.checkResult);
    if (dto.correctiveAction !== undefined) data.correctiveAction = this.cleanStr(dto.correctiveAction);
    if (dto.preventiveAction !== undefined) data.preventiveAction = this.cleanStr(dto.preventiveAction);
    if (dto.finalDecision !== undefined) data.finalDecision = this.cleanStr(dto.finalDecision);

    if (dto.issueCategory !== undefined) data.issueCategory = dto.issueCategory || null;
    if (dto.impactLevel !== undefined) data.impactLevel = dto.impactLevel || null;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.phase !== undefined) data.phase = dto.phase;
    if (dto.status !== undefined) data.status = dto.status;

    if (dto.ownerId !== undefined) {
      await this.validateUserId(dto.ownerId || null, "ownerId");
      data.ownerId = dto.ownerId || null;
    }

    if (dto.assignedToId !== undefined) {
      await this.validateUserId(dto.assignedToId || null, "assignedToId");
      data.assignedToId = dto.assignedToId || null;
    }

    if (dto.dueAt !== undefined) {
      data.dueAt = this.parseDateOrNull(dto.dueAt);
    }

    if (dto.closedAt !== undefined) {
      data.closedAt = this.parseDateOrNull(dto.closedAt);
    }

    if (dto.status === "DONE" && dto.closedAt === undefined) {
      data.closedAt = new Date();
    }

    if (dto.status && dto.status !== "DONE" && dto.closedAt === undefined && existing.closedAt) {
      data.closedAt = null;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("No valid fields to update");
    }

    const updated = await this.prisma.pdcaCase.update({
      where: { id },
      data,
      include: this.pdcaIncludeDetail(),
    });

    await this.audit.log(user, "PDCA_CASE_UPDATE", "PdcaCase", id, {
      phase: updated.phase,
      status: updated.status,
      ownerId: updated.ownerId,
      assignedToId: updated.assignedToId,
    });

    if (dto.phase !== undefined || dto.status !== undefined) {
      await this.prisma.pdcaLog.create({
        data: {
          pdcaCaseId: id,
          createdById: user.id,
          phase: updated.phase,
          note: `Case updated: phase=${updated.phase}, status=${updated.status}`,
        },
      });
    }

    return updated;
  }

  async addLog(user: ReqUser, id: string, dto: CreatePdcaLogDto) {
    const item = await this.getAccessibleCaseOrThrow(user, id);

    const note = this.cleanStr(dto.note);
    if (!note) {
      throw new BadRequestException("note is required");
    }

    const canAddLog =
      this.canManageAll(user) ||
      item.createdById === user.id ||
      item.assignedToId === user.id ||
      item.ownerId === user.id;

    if (!canAddLog) {
      throw new ForbiddenException("No access");
    }

    const log = await this.prisma.pdcaLog.create({
      data: {
        pdcaCaseId: id,
        createdById: user.id,
        phase: dto.phase || null,
        note,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.audit.log(user, "PDCA_LOG_CREATE", "PdcaCase", id, {
      phase: dto.phase || null,
      note,
    });

    return log;
  }

  async updatePhase(user: ReqUser, id: string, phase: PdcaPhase) {
    const item = await this.getAccessibleCaseOrThrow(user, id);

    const canChange =
      this.canManageAll(user) ||
      item.createdById === user.id ||
      item.assignedToId === user.id ||
      item.ownerId === user.id;

    if (!canChange) {
      throw new ForbiddenException("No access");
    }

    const updated = await this.prisma.pdcaCase.update({
      where: { id },
      data: {
        phase,
        status: item.status === "OPEN" ? "IN_PROGRESS" : item.status,
      },
      include: this.pdcaIncludeDetail(),
    });

    await this.prisma.pdcaLog.create({
      data: {
        pdcaCaseId: id,
        createdById: user.id,
        phase,
        note: `Phase moved to ${phase}`,
      },
    });

    await this.audit.log(user, "PDCA_PHASE_UPDATE", "PdcaCase", id, {
      from: item.phase,
      to: phase,
    });

    return updated;
  }

  async closeCase(user: ReqUser, id: string) {
    const item = await this.getAccessibleCaseOrThrow(user, id);

    const canClose =
      this.canManageAll(user) ||
      item.createdById === user.id ||
      item.ownerId === user.id;

    if (!canClose) {
      throw new ForbiddenException("No access");
    }

    const updated = await this.prisma.pdcaCase.update({
      where: { id },
      data: {
        status: "DONE",
        closedAt: new Date(),
      },
      include: this.pdcaIncludeDetail(),
    });

    await this.prisma.pdcaLog.create({
      data: {
        pdcaCaseId: id,
        createdById: user.id,
        phase: updated.phase,
        note: "Case closed",
      },
    });

    await this.audit.log(user, "PDCA_CASE_CLOSE", "PdcaCase", id, {});

    return updated;
  }

  async cancelCase(user: ReqUser, id: string) {
    const item = await this.getAccessibleCaseOrThrow(user, id);

    if (!this.canManageAll(user)) {
      throw new ForbiddenException("Only manager or admin can cancel PDCA case");
    }

    const updated = await this.prisma.pdcaCase.update({
      where: { id },
      data: {
        status: "CANCELLED",
      },
      include: this.pdcaIncludeDetail(),
    });

    await this.prisma.pdcaLog.create({
      data: {
        pdcaCaseId: id,
        createdById: user.id,
        phase: updated.phase,
        note: "Case cancelled",
      },
    });

    await this.audit.log(user, "PDCA_CASE_CANCEL", "PdcaCase", id, {
      previousStatus: item.status,
    });

    return updated;
  }
}