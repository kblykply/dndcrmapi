import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UserActivityService {
  constructor(private prisma: PrismaService) {}

  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async getUserActivity(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    include: {
      crmTasksAssigned: {
        include: {
          lead: { select: { id: true, fullName: true } },
          agency: { select: { id: true, name: true } },
          customer: { select: { id: true, fullName: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      crmTasksCreated: {
        include: {
          lead: { select: { id: true, fullName: true } },
          agency: { select: { id: true, name: true } },
          customer: { select: { id: true, fullName: true } },
          assignedTo: { select: { id: true, name: true } },
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
      agencyTasksCreated: {
        include: {
          agency: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      agencyMeetingsAuthored: {
        include: {
          agency: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      agencyNotesAuthored: {
        include: {
          agency: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      activities: {
        include: {
          lead: { select: { id: true, fullName: true, phone: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      presentationsCreated: {
        include: {
          customer: { select: { id: true, fullName: true } },
          assignedSales: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      presentationsAssigned: {
        include: {
          customer: { select: { id: true, fullName: true } },
          createdBy: { select: { id: true, name: true } },
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