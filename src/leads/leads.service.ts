import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { ActivityType, LeadStatus, Role } from "../common/types";
import { canEditCoreFields, canTransition } from "./lead.rules";

type ReqUser = { id: string; role: Role; email: string };

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async getAccessibleLeadOrThrow(user: ReqUser, leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");

    if (user.role === "ADMIN" || user.role === "MANAGER") {
      return lead;
    }

    if (user.role === "CALLCENTER") {
      if (lead.ownerCallCenterId === user.id) return lead;
    }

    if (user.role === "SALES") {
      if (lead.assignedSalesId === user.id) return lead;
    }

    throw new ForbiddenException("No access");
  }

  async listFollowups(user: ReqUser, range?: string) {
    const now = new Date();
    const where: any = { archivedAt: null };

    if (user.role === "ADMIN" || user.role === "MANAGER") {
      // full access
    } else if (user.role === "CALLCENTER") {
      where.ownerCallCenterId = user.id;
    } else if (user.role === "SALES") {
      where.assignedSalesId = user.id;
    } else {
      throw new ForbiddenException("No access");
    }

    if (range === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      where.nextFollowUpAt = { gte: start, lte: end };
    } else if (range === "overdue") {
      where.nextFollowUpAt = { lt: now };
    } else if (range === "week") {
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      where.nextFollowUpAt = { gte: now, lte: end };
    } else if (range === "missing") {
      where.nextFollowUpAt = null;
      where.status = {
        in: ["NEW", "WORKING", "SALES_READY", "MANAGER_REVIEW", "ASSIGNED"],
      };
    } else {
      where.nextFollowUpAt = { lte: now };
    }

    return this.prisma.lead.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        source: true,
        status: true,
        nextFollowUpAt: true,
        lastActivityAt: true,
        assignedManagerId: true,
        assignedSalesId: true,
        ownerCallCenterId: true,
        ownerCallCenter: {
          select: { id: true, name: true, email: true },
        },
        assignedManager: {
          select: { id: true, name: true, email: true },
        },
        assignedSales: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [
        { nextFollowUpAt: "asc" },
        { lastActivityAt: "desc" },
        { createdAt: "desc" },
      ],
      take: 200,
    });
  }

  async createLead(
    user: ReqUser,
    data: { fullName: string; phone: string; email?: string; source?: string }
  ) {
    if (user.role !== "CALLCENTER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only callcenter can create leads");
    }

    const lead = await this.prisma.lead.create({
      data: {
        fullName: data.fullName,
        phone: data.phone,
        email: data.email,
        source: data.source,
        status: "NEW",
        ownerCallCenterId: user.id,
      },
    });

    await this.audit.log(user, "LEAD_CREATE", "Lead", lead.id, {
      fullName: lead.fullName,
      phone: lead.phone,
    });

    return lead;
  }

  async listLeads(
    user: ReqUser,
    opts?: {
      status?: LeadStatus;
      page?: number;
      pageSize?: number;
      q?: string;
    }
  ) {
    const page = Math.max(1, Number(opts?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(opts?.pageSize || 25)));
    const skip = (page - 1) * pageSize;
    const q = (opts?.q || "").trim();

    const where: any = { archivedAt: null };

    if (opts?.status) where.status = opts.status as any;

    if (user.role === "ADMIN" || user.role === "MANAGER") {
      // full access
    } else if (user.role === "CALLCENTER") {
      where.ownerCallCenterId = user.id;
    } else if (user.role === "SALES") {
      where.assignedSalesId = user.id;
    } else {
      throw new ForbiddenException("No access");
    }

    if (q) {
      const searchBlock = {
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { source: { contains: q, mode: "insensitive" } },
        ],
      };

      if (where.OR) {
        where.AND = [{ OR: where.OR }, searchBlock];
        delete where.OR;
      } else {
        where.OR = searchBlock.OR;
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: {
          ownerCallCenter: {
            select: { id: true, name: true, email: true },
          },
          assignedManager: {
            select: { id: true, name: true, email: true },
          },
          assignedSales: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [
          { nextFollowUpAt: "asc" },
          { lastActivityAt: "desc" },
          { createdAt: "desc" },
        ],
        skip,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getLead(user: ReqUser, leadId: string) {
    await this.getAccessibleLeadOrThrow(user, leadId);

    return this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        activities: { orderBy: { createdAt: "desc" }, take: 200 },
        stageHistory: { orderBy: { changedAt: "desc" }, take: 200 },
        ownerCallCenter: { select: { id: true, name: true, email: true } },
        assignedManager: { select: { id: true, name: true, email: true } },
        assignedSales: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async updateLeadCore(user: ReqUser, leadId: string, patch: any) {
    const lead = await this.getAccessibleLeadOrThrow(user, leadId);
    if (!canEditCoreFields(user.role, lead.status as any)) {
      throw new ForbiddenException("Lead core fields locked");
    }

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: patch,
    });

    await this.audit.log(user, "LEAD_UPDATE_CORE", "Lead", leadId, patch);
    return updated;
  }

  async addActivity(
    user: ReqUser,
    leadId: string,
    input: {
      type: ActivityType;
      summary: string;
      details?: string;
      callOutcome?: string;
      lastContactAt?: string;
      nextFollowUpAt?: string;
    }
  ) {
    await this.getAccessibleLeadOrThrow(user, leadId);

    const lastContactAt = input.lastContactAt ? new Date(input.lastContactAt) : undefined;
    const nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : undefined;

    const allowedOutcomes = new Set([
      "OPENED",
      "NO_ANSWER",
      "BUSY",
      "UNREACHABLE",
      "CALL_AGAIN",
      "INTERESTED",
      "NOT_INTERESTED",
      "QUALIFIED",
      "WON",
      "LOST",
      "WRONG_NUMBER",
    ]);

    let callOutcome: string | undefined = undefined;

    if (input.type === "CALL" && input.callOutcome) {
      if (!allowedOutcomes.has(input.callOutcome)) {
        throw new BadRequestException("Invalid callOutcome");
      }
      callOutcome = input.callOutcome;
    }

    const act = await this.prisma.leadActivity.create({
      data: {
        leadId,
        type: input.type as any,
        summary: input.summary,
        details: input.details,
        callOutcome: callOutcome as any,
        createdById: user.id,
      },
    });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        lastActivityAt: new Date(),
        ...(lastContactAt ? { lastContactAt } : {}),
        ...(nextFollowUpAt ? { nextFollowUpAt } : {}),
      },
    });

    await this.audit.log(user, "LEAD_ACTIVITY_ADD", "Lead", leadId, {
      type: input.type,
      summary: input.summary,
      callOutcome: callOutcome ?? null,
      nextFollowUpAt: nextFollowUpAt ? nextFollowUpAt.toISOString() : null,
    });

    return act;
  }

  async changeStatus(user: ReqUser, leadId: string, to: LeadStatus) {
    const lead = await this.getAccessibleLeadOrThrow(user, leadId);

    if (!canTransition(lead.status as any, to)) {
      throw new BadRequestException("Invalid status transition");
    }

    if (to === "MANAGER_REVIEW" && user.role !== "CALLCENTER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only callcenter can submit to manager");
    }
    if (to === "ASSIGNED" && user.role !== "MANAGER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only manager can assign");
    }
    if ((to === "WON" || to === "LOST") && user.role !== "SALES" && user.role !== "MANAGER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only sales/manager can close");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.lead.update({
        where: { id: leadId },
        data: { status: to as any },
      });

      await tx.leadStageHistory.create({
        data: {
          leadId,
          fromStatus: lead.status as any,
          toStatus: to as any,
          changedById: user.id,
        },
      });

      await tx.leadActivity.create({
        data: {
          leadId,
          type: "STATUS_CHANGE" as any,
          summary: `Status: ${lead.status} → ${to}`,
          createdById: user.id,
        },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: { lastActivityAt: new Date() },
      });

      return u;
    });

    await this.audit.log(user, "LEAD_STATUS_CHANGE", "Lead", leadId, {
      from: lead.status,
      to,
    });

    return updated;
  }

  async sendToManager(user: ReqUser, leadId: string, managerId: string) {
    const lead = await this.getAccessibleLeadOrThrow(user, leadId);

    if (user.role !== "CALLCENTER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only callcenter can send");
    }

    if ((lead.status as any) !== "SALES_READY") {
      throw new BadRequestException("Lead must be SALES_READY first");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.lead.update({
        where: { id: leadId },
        data: { status: "MANAGER_REVIEW" as any, assignedManagerId: managerId },
      });

      await tx.leadStageHistory.create({
        data: {
          leadId,
          fromStatus: lead.status as any,
          toStatus: "MANAGER_REVIEW" as any,
          changedById: user.id,
        },
      });

      await tx.leadActivity.create({
        data: {
          leadId,
          type: "ASSIGNMENT" as any,
          summary: `Sent to Manager`,
          details: managerId,
          createdById: user.id,
        },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: { lastActivityAt: new Date() },
      });

      return u;
    });

    await this.audit.log(user, "LEAD_SEND_MANAGER", "Lead", leadId, { managerId });
    return updated;
  }

  async assignToSales(user: ReqUser, leadId: string, salesId: string) {
    const lead = await this.getAccessibleLeadOrThrow(user, leadId);

    if (user.role !== "MANAGER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only manager can assign");
    }

    const isFromReview = (lead.status as any) === "MANAGER_REVIEW";
    const isReassign = (lead.status as any) === "ASSIGNED";

    if (!isFromReview && !isReassign) {
      throw new BadRequestException("Lead must be in MANAGER_REVIEW or ASSIGNED");
    }

    const sales = await this.prisma.user.findUnique({ where: { id: salesId } });
    if (!sales || (sales.role as any) !== "SALES") {
      throw new BadRequestException("Selected user is not a SALES rep");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextStatus = isFromReview ? ("ASSIGNED" as any) : (lead.status as any);

      const u = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: nextStatus,
          assignedSalesId: salesId,
        },
      });

      if (isFromReview) {
        await tx.leadStageHistory.create({
          data: {
            leadId,
            fromStatus: lead.status as any,
            toStatus: "ASSIGNED" as any,
            changedById: user.id,
          },
        });
      }

      await tx.leadActivity.create({
        data: {
          leadId,
          type: "ASSIGNMENT" as any,
          summary: isReassign ? "Reassigned to Sales" : "Assigned to Sales",
          details: salesId,
          createdById: user.id,
        },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: { lastActivityAt: new Date() },
      });

      return u;
    });

    await this.audit.log(
      user,
      isReassign ? "LEAD_REASSIGN_SALES" : "LEAD_ASSIGN_SALES",
      "Lead",
      leadId,
      { salesId }
    );

    return updated;
  }

  async bulkDelete(user: ReqUser, body: { ids: string[] }) {
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      throw new ForbiddenException("Only admin or manager can bulk delete leads");
    }

    const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];

    if (ids.length === 0) {
      throw new BadRequestException("Silinecek lead seçilmedi.");
    }

    const existing = await this.prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });

    if (existing.length === 0) {
      throw new BadRequestException("Seçilen leadler bulunamadı.");
    }

    const existingIds = existing.map((x) => x.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.task.deleteMany({
        where: {
          leadId: { in: existingIds },
        },
      });

      await tx.lead.deleteMany({
        where: {
          id: { in: existingIds },
        },
      });
    });

    await this.audit.log(user, "LEAD_BULK_DELETE", "Lead", "bulk", {
      count: existingIds.length,
      ids: existingIds,
      names: existing.map((x) => x.fullName),
    });

    return {
      deletedCount: existingIds.length,
      ids: existingIds,
    };
  }
}