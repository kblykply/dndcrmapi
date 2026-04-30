import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UserActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            crmTasksAssigned: true,
            agencyTasksAssigned: true,
            agencyMeetingsAssigned: true,
            presentationsAssigned: true,
            otherMeetingsAssigned: true,
            activities: true,
            ownedCustomers: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return users.map((user) => {
      const tasks =
        user._count.crmTasksAssigned + user._count.agencyTasksAssigned;

      const meetings =
        user._count.agencyMeetingsAssigned +
        user._count.presentationsAssigned +
        user._count.otherMeetingsAssigned;

      const leads = user._count.activities;
      const customers = user._count.ownedCustomers;

      const { _count, ...cleanUser } = user;

      return {
        ...cleanUser,
        stats: {
          total: tasks + meetings + leads + customers,
          tasks,
          meetings,
          leads,
          customers,
        },
      };
    });
  }

  async getUserActivity(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        crmTasksAssigned: {
          include: {
            lead: { select: { id: true, fullName: true, phone: true } },
            agency: { select: { id: true, name: true } },
            customer: { select: { id: true, fullName: true, companyName: true } },
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },

        agencyTasksAssigned: {
          include: {
            agency: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },

        agencyMeetingsAssigned: {
          include: {
            agency: { select: { id: true, name: true } },
            customer: {
              select: { id: true, fullName: true, companyName: true },
            },
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { meetingAt: "desc" },
        },

        presentationsAssigned: {
          include: {
            customer: {
              select: { id: true, fullName: true, companyName: true },
            },
            agency: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { presentationAt: "desc" },
        },

        otherMeetingsAssigned: {
          include: {
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { meetingAt: "desc" },
        },

        activities: {
          include: {
            lead: { select: { id: true, fullName: true, phone: true } },
          },
          orderBy: { createdAt: "desc" },
        },

        ownedCustomers: {
          include: {
            agency: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }
}