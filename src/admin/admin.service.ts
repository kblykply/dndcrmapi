import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function keyOfDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const last7Start = startOfDay(addDays(now, -6));
    const last30Start = startOfDay(addDays(now, -29));
    const next7End = endOfDay(addDays(now, 7));

    const [
      totalLeads,
      leadsToday,
      leadsLast7,
      leadsLast30,
      wonLeads,
      lostLeads,
      workingLeads,
      managerReviewLeads,
      assignedLeads,
      overdueFollowups,
      todayFollowups,
      upcomingFollowups,
      totalCalls,
      callsToday,
      callsLast7,
      callsLast30,
      sentToManagerActivities,
      assignedToSalesActivities,
      activeUsers,
      allRecentLeads,
      allRecentCalls,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: { archivedAt: null },
      }),
      this.prisma.lead.count({
        where: {
          archivedAt: null,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      this.prisma.lead.count({
        where: {
          archivedAt: null,
          createdAt: { gte: last7Start },
        },
      }),
      this.prisma.lead.count({
        where: {
          archivedAt: null,
          createdAt: { gte: last30Start },
        },
      }),
      this.prisma.lead.count({
        where: { archivedAt: null, status: "WON" as any },
      }),
      this.prisma.lead.count({
        where: { archivedAt: null, status: "LOST" as any },
      }),
      this.prisma.lead.count({
        where: { archivedAt: null, status: "WORKING" as any },
      }),
      this.prisma.lead.count({
        where: { archivedAt: null, status: "MANAGER_REVIEW" as any },
      }),
      this.prisma.lead.count({
        where: { archivedAt: null, status: "ASSIGNED" as any },
      }),
      this.prisma.lead.count({
        where: {
          archivedAt: null,
          nextFollowUpAt: { lt: now },
          status: {
            in: [
              "NEW",
              "WORKING",
              "SALES_READY",
              "MANAGER_REVIEW",
              "ASSIGNED",
            ] as any,
          },
        },
      }),
      this.prisma.lead.count({
        where: {
          archivedAt: null,
          nextFollowUpAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      this.prisma.lead.count({
        where: {
          archivedAt: null,
          nextFollowUpAt: { gt: todayEnd, lte: next7End },
        },
      }),
      this.prisma.leadActivity.count({
        where: { type: "CALL" as any },
      }),
      this.prisma.leadActivity.count({
        where: {
          type: "CALL" as any,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      this.prisma.leadActivity.count({
        where: {
          type: "CALL" as any,
          createdAt: { gte: last7Start },
        },
      }),
      this.prisma.leadActivity.count({
        where: {
          type: "CALL" as any,
          createdAt: { gte: last30Start },
        },
      }),
      this.prisma.leadActivity.count({
        where: {
          type: "ASSIGNMENT" as any,
          summary: { contains: "Sent to Manager", mode: "insensitive" },
        },
      }),
      this.prisma.leadActivity.count({
        where: {
          type: "ASSIGNMENT" as any,
          summary: { in: ["Assigned to Sales", "Reassigned to Sales"] as any },
        },
      }),
      this.prisma.user.findMany({
        where: { isActive: true },
        select: { role: true },
      }),
      this.prisma.lead.findMany({
        where: {
          archivedAt: null,
          createdAt: { gte: last30Start },
        },
        select: { createdAt: true, status: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.leadActivity.findMany({
        where: {
          type: "CALL" as any,
          createdAt: { gte: last30Start },
        },
        select: { createdAt: true, callOutcome: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const leadsByStatusRaw = await this.prisma.lead.groupBy({
      by: ["status"],
      where: { archivedAt: null },
      _count: { _all: true },
    });

    const leadsByStatus = leadsByStatusRaw.map((x) => ({
      status: x.status,
      count: x._count._all,
    }));

    const usersByRoleMap: Record<string, number> = {};
    for (const u of activeUsers) {
      usersByRoleMap[u.role] = (usersByRoleMap[u.role] || 0) + 1;
    }

    const usersByRole = [
      { role: "ADMIN", count: usersByRoleMap.ADMIN || 0 },
      { role: "CALLCENTER", count: usersByRoleMap.CALLCENTER || 0 },
      { role: "MANAGER", count: usersByRoleMap.MANAGER || 0 },
      { role: "SALES", count: usersByRoleMap.SALES || 0 },
    ];

    const leadDays: Record<string, number> = {};
    const callDays: Record<string, number> = {};

    for (let i = 13; i >= 0; i--) {
      const d = startOfDay(addDays(now, -i));
      const key = keyOfDate(d);
      leadDays[key] = 0;
      callDays[key] = 0;
    }

    for (const l of allRecentLeads) {
      const key = keyOfDate(l.createdAt);
      if (key in leadDays) leadDays[key] += 1;
    }

    for (const c of allRecentCalls) {
      const key = keyOfDate(c.createdAt);
      if (key in callDays) callDays[key] += 1;
    }

    const leadsChart = Object.entries(leadDays).map(([date, count]) => ({
      date,
      count,
    }));

    const callsChart = Object.entries(callDays).map(([date, count]) => ({
      date,
      count,
    }));

    const answeredCalls = allRecentCalls.filter(
      (x) =>
        x.callOutcome === "OPENED" ||
        x.callOutcome === "INTERESTED" ||
        x.callOutcome === "QUALIFIED",
    ).length;

    const noAnswerCalls = allRecentCalls.filter(
      (x) =>
        x.callOutcome === "NO_ANSWER" ||
        x.callOutcome === "BUSY" ||
        x.callOutcome === "UNREACHABLE",
    ).length;

    return {
      kpis: {
        totalLeads,
        leadsToday,
        leadsLast7,
        leadsLast30,
        totalCalls,
        callsToday,
        callsLast7,
        callsLast30,
      },
      pipeline: {
        wonLeads,
        lostLeads,
        workingLeads,
        managerReviewLeads,
        assignedLeads,
        sentToManagerActivities,
        assignedToSalesActivities,
      },
      followups: {
        overdue: overdueFollowups,
        today: todayFollowups,
        upcoming7Days: upcomingFollowups,
      },
      users: {
        activeTotal: activeUsers.length,
        byRole: usersByRole,
      },
      callOutcomes: {
        answeredCalls,
        noAnswerCalls,
      },
      leadsByStatus,
      charts: {
        leads14Days: leadsChart,
        calls14Days: callsChart,
      },
    };
  }
}