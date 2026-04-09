import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { Prisma } from "@prisma/client";
import type { ActivityType, LeadStatus, Role } from "../common/types";
import { canEditCoreFields, canTransition } from "./lead.rules";

type ReqUser = { id: string; role: Role; email: string };

type LeadRow = Prisma.LeadGetPayload<{}>;

type LeadListRow = Prisma.LeadGetPayload<{
  include: {
    ownerCallCenter: {
      select: { id: true; name: true; email: true };
    };
    assignedManager: {
      select: { id: true; name: true; email: true };
    };
    assignedSales: {
      select: { id: true; name: true; email: true };
    };
  };
}>;

type LeadDetailRow = Prisma.LeadGetPayload<{
  include: {
    activities: true;
    stageHistory: true;
    ownerCallCenter: {
      select: { id: true; name: true; email: true };
    };
    assignedManager: {
      select: { id: true; name: true; email: true };
    };
    assignedSales: {
      select: { id: true; name: true; email: true };
    };
  };
}>;

type ManagerLite = {
  id: string;
  role: Role;
  isActive: boolean;
};

type SalesLite = {
  id: string;
  role: Role;
  isActive: boolean;
};

type BulkLeadLite = {
  id: string;
  fullName: string;
};

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryablePrismaError(error: any) {
    const code = error?.code;
    const message = String(error?.message || "");
    const causeMessage = String(error?.cause?.message || "");
    const originalMessage = String(error?.cause?.originalMessage || "");

    const text = `${message} ${causeMessage} ${originalMessage}`;

    return (
      code === "P2028" ||
      text.includes("Unable to start a transaction in the given time") ||
      text.includes("Transaction API error") ||
      text.includes("MaxClientsInSessionMode") ||
      text.includes("max clients reached") ||
      text.includes(
        "Timed out fetching a new connection from the connection pool",
      )
    );
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    retries = 2,
    waitMs = 150,
  ): Promise<T> {
    let lastError: any;

    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        if (!this.isRetryablePrismaError(error) || i === retries) {
          throw error;
        }

        await this.sleep(waitMs * (i + 1));
      }
    }

    throw lastError;
  }

  private async getAccessibleLeadOrThrow(
    user: ReqUser,
    leadId: string,
  ): Promise<LeadRow> {
    const lead = await this.withRetry<LeadRow | null>(() =>
      this.prisma.lead.findUnique({
        where: { id: leadId },
      }),
    );

    if (!lead) {
      throw new NotFoundException("Lead not found");
    }

    if (user.role === "ADMIN" || user.role === "MANAGER") {
      return lead;
    }

    if (user.role === "CALLCENTER" && lead.ownerCallCenterId === user.id) {
      return lead;
    }

    if (user.role === "SALES" && lead.assignedSalesId === user.id) {
      return lead;
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

    return this.withRetry<
      Array<{
        id: string;
        fullName: string;
        phone: string;
        email: string | null;
        source: string | null;
        status: string;
        nextFollowUpAt: Date | null;
        lastActivityAt: Date | null;
        assignedManagerId: string | null;
        assignedSalesId: string | null;
        ownerCallCenterId: string | null;
        ownerCallCenter: { id: string; name: string; email: string } | null;
        assignedManager: { id: string; name: string; email: string } | null;
        assignedSales: { id: string; name: string; email: string } | null;
      }>
    >(() =>
      this.prisma.lead.findMany({
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
      }),
    );
  }

  async createLead(
    user: ReqUser,
    data: { fullName: string; phone: string; email?: string; source?: string },
  ) {
    if (user.role !== "CALLCENTER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only callcenter can create leads");
    }

    const fullName = String(data.fullName || "").trim();
    const phone = String(data.phone || "").trim();
    const email = data.email?.trim() || undefined;
    const source = data.source?.trim() || undefined;

    if (!fullName) {
      throw new BadRequestException("fullName is required");
    }

    if (!phone) {
      throw new BadRequestException("phone is required");
    }

    const lead = await this.withRetry<LeadRow>(() =>
      this.prisma.lead.create({
        data: {
          fullName,
          phone,
          email,
          source,
          status: "NEW",
          ownerCallCenterId: user.role === "CALLCENTER" ? user.id : null,
        },
      }),
    );

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
    },
  ) {
    const page = Math.max(1, Number(opts?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(opts?.pageSize || 25)));
    const skip = (page - 1) * pageSize;
    const q = (opts?.q || "").trim();

    const where: any = {
      archivedAt: null,
    };

    if (opts?.status) {
      where.status = opts.status as any;
    }

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
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { source: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const items = await this.withRetry<LeadListRow[]>(() =>
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
    );

    const total = await this.withRetry<number>(() =>
      this.prisma.lead.count({
        where,
      }),
    );

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

    return this.withRetry<LeadDetailRow | null>(() =>
      this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          activities: {
            orderBy: { createdAt: "desc" },
            take: 200,
          },
          stageHistory: {
            orderBy: { changedAt: "desc" },
            take: 200,
          },
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
      }),
    );
  }

  async updateLeadCore(user: ReqUser, leadId: string, patch: any) {
    const lead = await this.getAccessibleLeadOrThrow(user, leadId);

    if (!canEditCoreFields(user.role, lead.status as any)) {
      throw new ForbiddenException("Lead core fields locked");
    }

    const data: any = {};

    if (patch.fullName !== undefined) {
      data.fullName = String(patch.fullName || "").trim();
      if (!data.fullName) {
        throw new BadRequestException("fullName is required");
      }
    }

    if (patch.phone !== undefined) {
      data.phone = String(patch.phone || "").trim();
      if (!data.phone) {
        throw new BadRequestException("phone is required");
      }
    }

    if (patch.email !== undefined) {
      data.email = patch.email ? String(patch.email).trim() : null;
    }

    if (patch.source !== undefined) {
      data.source = patch.source ? String(patch.source).trim() : null;
    }

    if (patch.nextFollowUpAt !== undefined) {
      data.nextFollowUpAt = patch.nextFollowUpAt
        ? new Date(patch.nextFollowUpAt)
        : null;

      if (data.nextFollowUpAt && Number.isNaN(data.nextFollowUpAt.getTime())) {
        throw new BadRequestException("Invalid nextFollowUpAt");
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("No valid fields to update");
    }

    const updated = await this.withRetry<LeadRow>(() =>
      this.prisma.lead.update({
        where: { id: leadId },
        data,
      }),
    );

    await this.audit.log(user, "LEAD_UPDATE_CORE", "Lead", leadId, data);
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
    },
  ) {
    await this.getAccessibleLeadOrThrow(user, leadId);

    const summary = String(input.summary || "").trim();
    if (!summary) {
      throw new BadRequestException("summary is required");
    }

    const lastContactAt = input.lastContactAt
      ? new Date(input.lastContactAt)
      : undefined;
    const nextFollowUpAt = input.nextFollowUpAt
      ? new Date(input.nextFollowUpAt)
      : undefined;

    if (lastContactAt && Number.isNaN(lastContactAt.getTime())) {
      throw new BadRequestException("Invalid lastContactAt");
    }

    if (nextFollowUpAt && Number.isNaN(nextFollowUpAt.getTime())) {
      throw new BadRequestException("Invalid nextFollowUpAt");
    }

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

    let callOutcome: string | undefined;

    if (input.type === "CALL" && input.callOutcome) {
      if (!allowedOutcomes.has(input.callOutcome)) {
        throw new BadRequestException("Invalid callOutcome");
      }
      callOutcome = input.callOutcome;
    }

    const act = await this.withRetry(() =>
      this.prisma.leadActivity.create({
        data: {
          leadId,
          type: input.type as any,
          summary,
          details: input.details,
          callOutcome: callOutcome as any,
          createdById: user.id,
        },
      }),
    );

    await this.withRetry<LeadRow>(() =>
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          lastActivityAt: new Date(),
          ...(lastContactAt ? { lastContactAt } : {}),
          ...(nextFollowUpAt ? { nextFollowUpAt } : {}),
        },
      }),
    );

    await this.audit.log(user, "LEAD_ACTIVITY_ADD", "Lead", leadId, {
      type: input.type,
      summary,
      callOutcome: callOutcome ?? null,
      nextFollowUpAt: nextFollowUpAt ? nextFollowUpAt.toISOString() : null,
    });

    return act;
  }

  async changeStatus(user: ReqUser, leadId: string, to: LeadStatus) {
    const lead = await this.getAccessibleLeadOrThrow(user, leadId);

    if (lead.status === to) {
      return this.withRetry<LeadRow | null>(() =>
        this.prisma.lead.findUnique({
          where: { id: leadId },
        }),
      );
    }

    if (!canTransition(lead.status as any, to)) {
      throw new BadRequestException("Invalid status transition");
    }

    if (
      to === "MANAGER_REVIEW" &&
      user.role !== "CALLCENTER" &&
      user.role !== "ADMIN"
    ) {
      throw new ForbiddenException("Only callcenter can submit to manager");
    }

    if (to === "ASSIGNED" && user.role !== "MANAGER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only manager can assign");
    }

    if (
      (to === "WON" || to === "LOST") &&
      user.role !== "SALES" &&
      user.role !== "MANAGER" &&
      user.role !== "ADMIN"
    ) {
      throw new ForbiddenException("Only sales/manager can close");
    }

    const updated = await this.withRetry<LeadRow>(() =>
      this.prisma.$transaction(async (tx) => {
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
      }),
    );

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

  // 🚀 Allow direct send from early stages
  const allowedStatuses: LeadStatus[] = ["NEW", "WORKING", "SALES_READY"];

  if (!allowedStatuses.includes(lead.status as LeadStatus)) {
    throw new BadRequestException(
      "Lead must be NEW, WORKING or SALES_READY to send to manager",
    );
  }

  const manager = await this.withRetry<ManagerLite | null>(() =>
    this.prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true, role: true, isActive: true },
    }),
  );

  if (!manager || !manager.isActive) {
    throw new BadRequestException("Manager not found or inactive");
  }

  if (manager.role !== "MANAGER" && manager.role !== "ADMIN") {
    throw new BadRequestException("Selected user is not a MANAGER");
  }

  const updated = await this.withRetry<LeadRow>(() =>
    this.prisma.$transaction(async (tx) => {
      // 🔥 Direct jump → MANAGER_REVIEW
      const u = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: "MANAGER_REVIEW" as any,
          assignedManagerId: managerId,
          lastActivityAt: new Date(),
        },
      });

      // 📌 stage history
      await tx.leadStageHistory.create({
        data: {
          leadId,
          fromStatus: lead.status as any,
          toStatus: "MANAGER_REVIEW" as any,
          changedById: user.id,
        },
      });

      // 📌 activity log (clear + readable)
      await tx.leadActivity.create({
        data: {
          leadId,
          type: "ASSIGNMENT" as any,
          summary: "Sent to Manager",
          details: `Auto flow: ${lead.status} → MANAGER_REVIEW | Manager: ${managerId}`,
          createdById: user.id,
        },
      });

      return u;
    }),
  );

  await this.audit.log(user, "LEAD_SEND_MANAGER", "Lead", leadId, {
    managerId,
    fromStatus: lead.status,
    toStatus: "MANAGER_REVIEW",
    autoFlow: true,
  });

  return updated;
}

  async assignToSales(user: ReqUser, leadId: string, salesId: string) {
    const lead = await this.getAccessibleLeadOrThrow(user, leadId);

    if (user.role !== "MANAGER" && user.role !== "ADMIN") {
      throw new ForbiddenException("Only manager can assign");
    }

    const isFromReview = lead.status === "MANAGER_REVIEW";
    const isReassign = lead.status === "ASSIGNED";

    if (!isFromReview && !isReassign) {
      throw new BadRequestException("Lead must be in MANAGER_REVIEW or ASSIGNED");
    }

    const sales = await this.withRetry<SalesLite | null>(() =>
      this.prisma.user.findUnique({
        where: { id: salesId },
        select: { id: true, role: true, isActive: true },
      }),
    );

    if (!sales || !sales.isActive) {
      throw new BadRequestException("Selected sales user not found or inactive");
    }

    if (sales.role !== "SALES") {
      throw new BadRequestException("Selected user is not a SALES rep");
    }

    const updated = await this.withRetry<LeadRow>(() =>
      this.prisma.$transaction(async (tx) => {
        const nextStatus = isFromReview ? ("ASSIGNED" as any) : lead.status;

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
      }),
    );

    await this.audit.log(
      user,
      isReassign ? "LEAD_REASSIGN_SALES" : "LEAD_ASSIGN_SALES",
      "Lead",
      leadId,
      { salesId },
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

    const existing = await this.withRetry<BulkLeadLite[]>(() =>
      this.prisma.lead.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullName: true },
      }),
    );

    if (existing.length === 0) {
      throw new BadRequestException("Seçilen leadler bulunamadı.");
    }

    const existingIds = existing.map((x) => x.id);

    await this.withRetry<void>(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.leadActivity.deleteMany({
          where: {
            leadId: { in: existingIds },
          },
        });

        await tx.leadStageHistory.deleteMany({
          where: {
            leadId: { in: existingIds },
          },
        });

        if ((tx as any).crmTask) {
          await (tx as any).crmTask.deleteMany({
            where: {
              leadId: { in: existingIds },
            },
          });
        }

        if ((tx as any).task) {
          await (tx as any).task.deleteMany({
            where: {
              leadId: { in: existingIds },
            },
          });
        }

        await tx.lead.deleteMany({
          where: {
            id: { in: existingIds },
          },
        });
      }),
    );

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