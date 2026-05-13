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
  | "PRESENTATION"
  | "OTHER_MEETING";

type CalendarEntityType = "lead" | "agency" | "customer" | "meeting";

type CalendarUserRef = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

type CalendarItem = {
  id: string;
  type: CalendarEventType;
  title: string;
  start: string;
  end?: string | null;
  allDay?: boolean;
  status?: string | null;
  entityId: string;
  entityType: CalendarEntityType;
  entityLabel: string;
  subtitle?: string | null;
  notesPreview?: string | null;

  assignedUser?: string | null;
  assignedUserId?: string | null;
  assignedUserRole?: string | null;

  userIds?: string[];
  userRoles?: string[];
  users?: CalendarUserRef[];

  href?: string;
  meta?: Record<string, any>;
};

type CalendarFilters = {
  types: string[];
  assignedUserIds: string[];
  roles: string[];
  search?: string | null;
};

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

  private cleanStr(v?: string | null) {
    const x = (v ?? "").trim();
    return x || null;
  }

  private csv(v?: string | null) {
    return (v || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  private unique<T>(items: T[]) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  private preview(text?: string | null, max = 80) {
    const value = (text || "").trim();
    if (!value) return null;
    if (value.length <= max) return value;
    return `${value.slice(0, max).trim()}…`;
  }

  private buildUsers(users: Array<CalendarUserRef | null | undefined>) {
    const map = new Map<string, CalendarUserRef>();

    for (const user of users) {
      if (!user?.id) continue;
      map.set(user.id, user);
    }

    return Array.from(map.values());
  }

  private buildUserMeta(users: CalendarUserRef[]) {
    const primary = users[0] || null;

    return {
      assignedUser: primary?.name || null,
      assignedUserId: primary?.id || null,
      assignedUserRole: primary?.role || null,
      userIds: this.unique(users.map((u) => u.id)),
      userRoles: this.unique(users.map((u) => u.role || "")),
      users,
    };
  }

  private matchesEventFilters(event: CalendarItem, filters: CalendarFilters) {
    if (filters.types.length > 0 && !filters.types.includes(event.type)) {
      return false;
    }

    if (filters.assignedUserIds.length > 0) {
      const ids = event.userIds?.length
        ? event.userIds
        : event.assignedUserId
          ? [event.assignedUserId]
          : [];

      const hasMatch = filters.assignedUserIds.some((id) => ids.includes(id));
      if (!hasMatch) return false;
    }

    if (filters.roles.length > 0) {
      const roles = event.userRoles?.length
        ? event.userRoles
        : event.assignedUserRole
          ? [event.assignedUserRole]
          : [];

      const hasMatch = filters.roles.some((role) => roles.includes(role));
      if (!hasMatch) return false;
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();

      const haystack = [
        event.title,
        event.entityLabel,
        event.subtitle,
        event.notesPreview,
        event.assignedUser,
        event.status,
        event.type,
        ...(event.users || []).map((u) => `${u.name || ""} ${u.email || ""} ${u.role || ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(q)) return false;
    }

    return true;
  }

  private pushEvent(events: CalendarItem[], event: CalendarItem, filters: CalendarFilters) {
    if (this.matchesEventFilters(event, filters)) {
      events.push(event);
    }
  }

  async getFeed(
    user: ReqUser,
    query?: {
      from?: string;
      to?: string;
      type?: string;
      assignedUserId?: string;
      types?: string;
      assignedUserIds?: string;
      roles?: string;
      search?: string;
    },
  ) {
    const now = new Date();
    const from = this.safeDate(query?.from) || this.startOfDay(now);
    const to = this.safeDate(query?.to) || this.endOfDay(this.addDays(from, 6));

    if (to < from) {
      throw new ForbiddenException("Invalid date range");
    }

    const filters: CalendarFilters = {
      types: this.unique([...this.csv(query?.types), ...this.csv(query?.type)]),
      assignedUserIds: this.unique([
        ...this.csv(query?.assignedUserIds),
        ...this.csv(query?.assignedUserId),
      ]),
      roles: this.unique(this.csv(query?.roles)),
      search: this.cleanStr(query?.search),
    };

    const events: CalendarItem[] = [];

    if (filters.types.length === 0 || filters.types.includes("LEAD_FOLLOWUP")) {
      const leadWhere: any = {
        archivedAt: null,
        nextFollowUpAt: { gte: from, lte: to },
      };

      if (!this.canSeeAll(user)) {
        if (user.role === "CALLCENTER") leadWhere.ownerCallCenterId = user.id;
        else if (user.role === "SALES") leadWhere.assignedSalesId = user.id;
        else throw new ForbiddenException("No access");
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
          ownerCallCenter: { select: { id: true, name: true, email: true, role: true } },
          assignedManager: { select: { id: true, name: true, email: true, role: true } },
          assignedSales: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { nextFollowUpAt: "asc" },
      });

      for (const l of leads) {
        if (!l.nextFollowUpAt) continue;

        const users = this.buildUsers([
          l.assignedSales,
          l.assignedManager,
          l.ownerCallCenter,
        ]);

        this.pushEvent(
          events,
          {
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
            href: `/leads/${l.id}`,
            meta: {
              phone: l.phone,
              source: l.source,
              ownerCallCenterId: l.ownerCallCenterId,
              assignedManagerId: l.assignedManagerId,
              assignedSalesId: l.assignedSalesId,
            },
            ...this.buildUserMeta(users),
          },
          filters,
        );
      }
    }

    if (filters.types.length === 0 || filters.types.includes("LEAD_CALL")) {
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
          lead: { select: { id: true, fullName: true } },
          createdBy: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      for (const c of calls) {
        const users = this.buildUsers([c.createdBy]);

        this.pushEvent(
          events,
          {
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
            href: c.leadId ? `/leads/${c.leadId}` : undefined,
            meta: {
              activityId: c.id,
              createdById: c.createdById,
            },
            ...this.buildUserMeta(users),
          },
          filters,
        );
      }
    }

    if (
      filters.types.length === 0 ||
      filters.types.includes("AGENCY_MEETING") ||
      filters.types.includes("OTHER_MEETING")
    ) {
      const meetings = await this.prisma.agencyMeeting.findMany({
        where: {
          meetingAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          agencyId: true,
          customerId: true,
          assignedSalesId: true,
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
              assignedSales: { select: { id: true, name: true, email: true, role: true } },
              manager: { select: { id: true, name: true, email: true, role: true } },
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              companyName: true,
              ownerId: true,
              owner: { select: { id: true, name: true, email: true, role: true } },
            },
          },
          assignedSales: { select: { id: true, name: true, email: true, role: true } },
          createdBy: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { meetingAt: "asc" },
      });

      for (const m of meetings) {
        const isAgencyMeeting = !!m.agencyId;
        const eventType: CalendarEventType = isAgencyMeeting
          ? "AGENCY_MEETING"
          : "OTHER_MEETING";

        if (filters.types.length > 0 && !filters.types.includes(eventType)) continue;

        const canSee =
          this.canSeeAll(user) ||
          m.createdById === user.id ||
          m.assignedSalesId === user.id ||
          m.agency?.assignedSalesId === user.id ||
          m.agency?.managerId === user.id ||
          m.customer?.ownerId === user.id;

        if (!canSee) continue;

        const users = this.buildUsers([
          m.assignedSales,
          m.agency?.assignedSales,
          m.agency?.manager,
          m.customer?.owner,
          m.createdBy,
        ]);

        const entityType: CalendarEntityType = m.agencyId
          ? "agency"
          : m.customerId
            ? "customer"
            : "meeting";

        const entityId = m.agencyId || m.customerId || m.id;
        const entityLabel = m.agency?.name || m.customer?.fullName || m.title || "Meeting";

        const href = m.agencyId
          ? `/agencies/${m.agencyId}`
          : m.customerId
            ? `/customers/${m.customerId}`
            : undefined;

        this.pushEvent(
          events,
          {
            id: `${eventType.toLowerCase()}-${m.id}`,
            type: eventType,
            title: m.title,
            start: m.meetingAt.toISOString(),
            end: m.meetingAt.toISOString(),
            allDay: false,
            status: null,
            entityId,
            entityType,
            entityLabel,
            subtitle: isAgencyMeeting ? "Agency meeting" : "Other meeting",
            notesPreview: this.preview(m.notes),
            href,
            meta: {
              meetingId: m.id,
              agencyId: m.agencyId,
              customerId: m.customerId,
              createdById: m.createdById,
              assignedSalesId: m.assignedSalesId,
              agencyManagerId: m.agency?.managerId,
              agencyAssignedSalesId: m.agency?.assignedSalesId,
              customerOwnerId: m.customer?.ownerId,
            },
            ...this.buildUserMeta(users),
          },
          filters,
        );
      }
    }

    if (filters.types.length === 0 || filters.types.includes("AGENCY_TASK")) {
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
              manager: { select: { id: true, name: true, email: true, role: true } },
            },
          },
          assignedTo: { select: { id: true, name: true, email: true, role: true } },
          createdBy: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { dueAt: "asc" },
      });

      for (const t of tasks) {
        if (!t.dueAt) continue;

        const canSee =
          this.canSeeAll(user) ||
          t.assignedToId === user.id ||
          t.createdById === user.id ||
          t.agency?.managerId === user.id;

        if (!canSee) continue;

        const users = this.buildUsers([t.assignedTo, t.createdBy, t.agency?.manager]);

        this.pushEvent(
          events,
          {
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
            href: `/agencies/${t.agencyId}`,
            meta: {
              taskId: t.id,
              assignedToId: t.assignedToId,
              createdById: t.createdById,
              agencyManagerId: t.agency?.managerId,
            },
            ...this.buildUserMeta(users),
          },
          filters,
        );
      }
    }

    if (filters.types.length === 0 || filters.types.includes("PRESENTATION")) {
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
              owner: { select: { id: true, name: true, email: true, role: true } },
              agency: { select: { id: true, name: true } },
            },
          },
          assignedSales: { select: { id: true, name: true, email: true, role: true } },
          createdBy: { select: { id: true, name: true, email: true, role: true } },
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

        const users = this.buildUsers([
          p.assignedSales,
          p.createdBy,
          p.customer?.owner,
        ]);

        this.pushEvent(
          events,
          {
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
            href: `/customers/${p.customerId}`,
            meta: {
              presentationId: p.id,
              assignedSalesId: p.assignedSalesId,
              createdById: p.createdById,
              customerOwnerId: p.customer?.ownerId,
              outcome: p.outcome,
            },
            ...this.buildUserMeta(users),
          },
          filters,
        );
      }
    }

    events.sort((a, b) => {
      return new Date(a.start).getTime() - new Date(b.start).getTime();
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