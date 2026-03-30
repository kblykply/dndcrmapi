import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type CalendarEventType =
  | "LEAD_FOLLOWUP"
  | "LEAD_CALL"
  | "AGENCY_MEETING"
  | "AGENCY_TASK"
  | "PRESENTATION";

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  private canSeeAll(user: ReqUser) {
    return user.role === "ADMIN" || user.role === "MANAGER";
  }

  private startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private endOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  private addDays(d: Date, days: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  }

  private safeDate(v?: string) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private preview(text?: string | null, max = 80) {
    const value = (text || "").trim();
    if (!value) return null;
    if (value.length <= max) return value;
    return `${value.slice(0, max).trim()}…`;
  }

  async getFeed(
    user: ReqUser,
    query?: {
      from?: string;
      to?: string;
      type?: string;
      assignedUserId?: string;
    },
  ) {
    const now = new Date();

    const parsedFrom = this.safeDate(query?.from);
    const parsedTo = this.safeDate(query?.to);

    const from = parsedFrom || this.startOfDay(now);
    const to =
      parsedTo || this.endOfDay(this.addDays(from, 6)); // default 1 week

    if (to < from) {
      throw new ForbiddenException("Invalid date range");
    }

    const onlyType = (query?.type || "").trim();
    const assignedUserId = (query?.assignedUserId || "").trim();

    const events: Array<{
      id: string;
      type: CalendarEventType;
      title: string;
      start: string;
      end?: string | null;
      allDay?: boolean;
      status?: string | null;
      entityId: string;
      entityType: "lead" | "agency" | "customer";
      entityLabel: string;
      subtitle?: string | null;
      notesPreview?: string | null;
      assignedUser?: string | null;
      href?: string;
      meta?: Record<string, any>;
    }> = [];

    // ---------------- LEAD FOLLOWUPS ----------------
    if (!onlyType || onlyType === "LEAD_FOLLOWUP") {
      const leadWhere: any = {
        archivedAt: null,
        nextFollowUpAt: {
          gte: from,
          lte: to,
        },
      };

      if (!this.canSeeAll(user)) {
        if (user.role === "CALLCENTER") {
          leadWhere.ownerCallCenterId = user.id;
        } else if (user.role === "SALES") {
          leadWhere.assignedSalesId = user.id;
        } else {
          throw new ForbiddenException("No access");
        }
      }

      const leads = await this.prisma.lead.findMany({
        where: leadWhere,
        select: {
          id: true,
          fullName: true,
          phone: true,
          source: true,
          status: true,
          nextFollowUpAt: true,
          ownerCallCenterId: true,
          assignedManagerId: true,
          assignedSalesId: true,
          ownerCallCenter: { select: { id: true, name: true, email: true } },
          assignedManager: { select: { id: true, name: true, email: true } },
          assignedSales: { select: { id: true, name: true, email: true } },
        },
        orderBy: { nextFollowUpAt: "asc" },
      });

      for (const l of leads) {
        if (!l.nextFollowUpAt) continue;

        if (assignedUserId) {
          const belongs =
            l.ownerCallCenterId === assignedUserId ||
            l.assignedManagerId === assignedUserId ||
            l.assignedSalesId === assignedUserId;
          if (!belongs) continue;
        }

        events.push({
          id: `lead-followup-${l.id}`,
          type: "LEAD_FOLLOWUP",
          title: l.fullName,
          start: l.nextFollowUpAt.toISOString(),
          end: l.nextFollowUpAt.toISOString(),
          allDay: false,
          status: l.status,
          entityId: l.id,
          entityType: "lead",
          entityLabel: l.fullName,
          subtitle: [l.phone, l.source].filter(Boolean).join(" • ") || null,
          notesPreview: null,
          assignedUser:
            l.assignedSales?.name ||
            l.assignedManager?.name ||
            l.ownerCallCenter?.name ||
            null,
          href: `/leads/${l.id}`,
          meta: {
            phone: l.phone,
            source: l.source,
          },
        });
      }
    }

    // ---------------- LEAD CALLS ----------------
    if (!onlyType || onlyType === "LEAD_CALL") {
      const callWhere: any = {
        type: "CALL" as any,
        createdAt: { gte: from, lte: to },
      };

      if (!this.canSeeAll(user)) {
        if (user.role === "CALLCENTER" || user.role === "SALES") {
          callWhere.createdById = user.id;
        } else {
          throw new ForbiddenException("No access");
        }
      }

      const calls = await this.prisma.leadActivity.findMany({
        where: callWhere,
        select: {
          id: true,
          leadId: true,
          summary: true,
          details: true,
          callOutcome: true,
          createdAt: true,
          createdById: true,
          lead: {
            select: {
              id: true,
              fullName: true,
            },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      for (const c of calls) {
        if (assignedUserId && c.createdById !== assignedUserId) continue;

        events.push({
          id: `lead-call-${c.id}`,
          type: "LEAD_CALL",
          title: `Call • ${c.lead?.fullName || "Lead"}`,
          start: c.createdAt.toISOString(),
          end: c.createdAt.toISOString(),
          allDay: false,
          status: (c.callOutcome as string) || null,
          entityId: c.leadId,
          entityType: "lead",
          entityLabel: c.lead?.fullName || "-",
          subtitle: c.summary || null,
          notesPreview: this.preview(c.details),
          assignedUser: c.createdBy?.name || null,
          href: c.leadId ? `/leads/${c.leadId}` : undefined,
          meta: {
            activityId: c.id,
          },
        });
      }
    }

    // ---------------- AGENCY MEETINGS ----------------
    if (!onlyType || onlyType === "AGENCY_MEETING") {
      const meetings = await this.prisma.agencyMeeting.findMany({
        where: {
          meetingAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          agencyId: true,
          createdById: true,
          title: true,
          notes: true,
          meetingAt: true,
          agency: {
            select: {
              id: true,
              name: true,
              managerId: true,
              assignedSalesId: true,
              assignedSales: { select: { id: true, name: true, email: true } },
              manager: { select: { id: true, name: true, email: true } },
            },
          },
          createdBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { meetingAt: "asc" },
      });

      for (const m of meetings) {
        const canSee =
          this.canSeeAll(user) ||
          m.createdById === user.id ||
          m.agency?.assignedSalesId === user.id;

        if (!canSee) continue;

        if (assignedUserId) {
          const belongs =
            m.createdById === assignedUserId ||
            m.agency?.assignedSalesId === assignedUserId ||
            m.agency?.managerId === assignedUserId;
          if (!belongs) continue;
        }

        events.push({
          id: `agency-meeting-${m.id}`,
          type: "AGENCY_MEETING",
          title: m.title,
          start: m.meetingAt.toISOString(),
          end: m.meetingAt.toISOString(),
          allDay: false,
          status: null,
          entityId: m.agencyId,
          entityType: "agency",
          entityLabel: m.agency?.name || "-",
          subtitle: "Agency meeting",
          notesPreview: this.preview(m.notes),
          assignedUser: m.agency?.assignedSales?.name || m.createdBy?.name || null,
          href: `/agencies/${m.agencyId}`,
          meta: {
            meetingId: m.id,
          },
        });
      }
    }

    // ---------------- AGENCY TASKS ----------------
    if (!onlyType || onlyType === "AGENCY_TASK") {
      const tasks = await this.prisma.agencyTask.findMany({
        where: {
          dueAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          agencyId: true,
          createdById: true,
          assignedToId: true,
          title: true,
          description: true,
          priority: true,
          status: true,
          dueAt: true,
          agency: {
            select: {
              id: true,
              name: true,
              managerId: true,
            },
          },
          assignedTo: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { dueAt: "asc" },
      });

      for (const t of tasks) {
        if (!t.dueAt) continue;

        const canSee =
          this.canSeeAll(user) ||
          t.assignedToId === user.id ||
          t.createdById === user.id;

        if (!canSee) continue;

        if (assignedUserId) {
          const belongs =
            t.assignedToId === assignedUserId ||
            t.createdById === assignedUserId ||
            t.agency?.managerId === assignedUserId;
          if (!belongs) continue;
        }

        events.push({
          id: `agency-task-${t.id}`,
          type: "AGENCY_TASK",
          title: t.title,
          start: t.dueAt.toISOString(),
          end: t.dueAt.toISOString(),
          allDay: false,
          status: t.status,
          entityId: t.agencyId,
          entityType: "agency",
          entityLabel: t.agency?.name || "-",
          subtitle: t.priority || null,
          notesPreview: this.preview(t.description),
          assignedUser: t.assignedTo?.name || t.createdBy?.name || null,
          href: `/agencies/${t.agencyId}`,
          meta: {
            taskId: t.id,
          },
        });
      }
    }

    // ---------------- PRESENTATIONS ----------------
    if (!onlyType || onlyType === "PRESENTATION") {
      const presentations = await this.prisma.presentation.findMany({
        where: {
          presentationAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          customerId: true,
          createdById: true,
          assignedSalesId: true,
          title: true,
          projectName: true,
          location: true,
          notesSummary: true,
          presentationAt: true,
          status: true,
          outcome: true,
          customer: {
            select: {
              id: true,
              fullName: true,
              ownerId: true,
              agency: {
                select: { id: true, name: true },
              },
            },
          },
          assignedSales: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { presentationAt: "asc" },
      });

      for (const p of presentations) {
        const canSee =
          this.canSeeAll(user) ||
          p.assignedSalesId === user.id ||
          p.createdById === user.id ||
          p.customer?.ownerId === user.id;

        if (!canSee) continue;

        if (assignedUserId) {
          const belongs =
            p.assignedSalesId === assignedUserId ||
            p.createdById === assignedUserId ||
            p.customer?.ownerId === assignedUserId;
          if (!belongs) continue;
        }

        events.push({
          id: `presentation-${p.id}`,
          type: "PRESENTATION",
          title: p.title,
          start: p.presentationAt.toISOString(),
          end: p.presentationAt.toISOString(),
          allDay: false,
          status: (p.status as string) || (p.outcome as string) || null,
          entityId: p.customerId,
          entityType: "customer",
          entityLabel: p.customer?.fullName || "-",
          subtitle: p.projectName || p.location || p.customer?.agency?.name || null,
          notesPreview: this.preview(p.notesSummary),
          assignedUser: p.assignedSales?.name || p.createdBy?.name || null,
          href: `/customers/${p.customerId}`,
          meta: {
            presentationId: p.id,
          },
        });
      }
    }

    events.sort((a, b) => {
      const ad = new Date(a.start).getTime();
      const bd = new Date(b.start).getTime();
      return ad - bd;
    });

    return {
      items: events,
      total: events.length,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  async getTodaySummary(user: ReqUser) {
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const todayEnd = this.endOfDay(now);
    const futureEnd = this.endOfDay(this.addDays(now, 14));

    const [today, upcoming] = await Promise.all([
      this.getFeed(user, {
        from: todayStart.toISOString(),
        to: todayEnd.toISOString(),
      }),
      this.getFeed(user, {
        from: new Date(todayEnd.getTime() + 1).toISOString(),
        to: futureEnd.toISOString(),
      }),
    ]);

    return {
      today: today.items,
      upcoming: upcoming.items,
    };
  }
}