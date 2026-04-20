import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type CreateAgencyDto = {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  address?: string;
  website?: string;
  source?: string;
  notesSummary?: string;
  assignedSalesId?: string | null;
  status?: "ACTIVE" | "PASSIVE" | "PROSPECT" | "DEALING" | "CLOSED";

};

type UpdateAgencyDto = {
  name?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  address?: string;
  website?: string;
  source?: string;
  notesSummary?: string;
  status?: "ACTIVE" | "PASSIVE" | "PROSPECT" | "DEALING" | "CLOSED";
};

type AssignSalesDto = {
  salesId?: string | null;
};

type CreateAgencyNoteDto = {
  note: string;
};

type CreateAgencyMeetingDto = {
  title: string;
  notes?: string;
  meetingAt: string;
};

type UpdateAgencyMeetingDto = {
  title?: string;
  notes?: string;
  meetingAt?: string;
};

type CreateAgencyTaskDto = {
  title: string;
  description?: string;
  dueAt?: string;
  assignedToId?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH";
};

type UpdateAgencyTaskDto = {
  title?: string;
  description?: string;
  dueAt?: string | null;
  assignedToId?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  status?: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
};

@Injectable()
export class AgenciesService {
  constructor(private prisma: PrismaService) {}

  private isAdmin(user: ReqUser) {
    return user.role === "ADMIN";
  }

  private isManager(user: ReqUser) {
    return user.role === "MANAGER" || user.role === "ADMIN";
  }

  private isSales(user: ReqUser) {
    return user.role === "SALES";
  }

  private cleanStr(v?: string | null) {
    const x = (v ?? "").trim();
    return x || undefined;
  }

  private salesOwnsAgency(
    user: ReqUser,
    agency: {
      assignedSalesId?: string | null;
    },
  ) {
    return this.isSales(user) && agency.assignedSalesId === user.id;
  }

  private canEditAgency(
    user: ReqUser,
    agency: {
      assignedSalesId?: string | null;
    },
  ) {
    return this.isAdmin(user) || this.isManager(user) || this.salesOwnsAgency(user, agency);
  }

  private maskAgencyForSales(agency: any, canSeeContact: boolean, canEdit: boolean) {
    if (canSeeContact) {
      return {
        ...agency,
        canSeeContactDetails: true,
        canEdit,
      };
    }

    return {
      ...agency,
      contactName: null,
      phone: null,
      email: null,
      address: null,
      website: null,
      source: null,
      notesSummary: null,
      canSeeContactDetails: false,
      canEdit,
    };
  }

  private withManagerAccessFlags(agency: any, canEdit = true) {
    return {
      ...agency,
      canSeeContactDetails: true,
      canEdit,
    };
  }

  private async getAccessibleAgencyOrThrow(user: ReqUser, agencyId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        manager: {
          select: { id: true, name: true, email: true, role: true },
        },
        assignedSales: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    if (!agency) throw new NotFoundException("Agency not found");

    if (this.isAdmin(user) || this.isManager(user) || this.isSales(user)) {
      return agency;
    }

    throw new ForbiddenException("No access to this agency");
  }

  private async assertManagerCanManageAgency(user: ReqUser, agencyId: string) {
    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    if (!this.isManager(user)) {
      throw new ForbiddenException("Only manager or admin can manage agencies");
    }

    return agency;
  }

  async listAgencies(
    user: ReqUser,
    query?: {
      q?: string;
      status?: string;
      assignedSalesId?: string;
      page?: string | number;
      pageSize?: string | number;
    },
  ) {
    const where: any = {};

    const q = this.cleanStr(query?.q);
    const status = this.cleanStr(query?.status);
    const assignedSalesId = this.cleanStr(query?.assignedSalesId);

    const page = Math.max(1, Number(query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize || 20)));
    const skip = (page - 1) * pageSize;

    if (!this.isAdmin(user) && !this.isManager(user) && !this.isSales(user)) {
      throw new ForbiddenException("No access");
    }

    if (status && status !== "ALL") {
      where.status = status;
    }

    if (assignedSalesId) {
      where.assignedSalesId = assignedSalesId;
    }

    if (q) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { contactName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
          { country: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const [items, total] = await Promise.all([
      this.prisma.agency.findMany({
        where,
        include: {
          manager: { select: { id: true, name: true, email: true } },
          assignedSales: { select: { id: true, name: true, email: true } },
          _count: {
            select: {
              notes: true,
              meetings: true,
              tasks: true,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.agency.count({ where }),
    ]);

    const normalizedItems = items.map((agency) => {
      if (this.isSales(user)) {
        const canSeeContact = this.salesOwnsAgency(user, agency);
        const canEdit = this.canEditAgency(user, agency);
        return this.maskAgencyForSales(agency, canSeeContact, canEdit);
      }

      return this.withManagerAccessFlags(agency, true);
    });

    return {
      items: normalizedItems,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getAgency(user: ReqUser, agencyId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        manager: { select: { id: true, name: true, email: true } },
        assignedSales: { select: { id: true, name: true, email: true } },
        notes: {
          orderBy: { createdAt: "desc" },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        },
        meetings: {
          orderBy: { meetingAt: "asc" },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        },
        tasks: {
          orderBy: [{ status: "asc" }, { dueAt: "asc" }],
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
            assignedTo: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!agency) {
      throw new NotFoundException("Agency not found");
    }

    if (this.isAdmin(user) || this.isManager(user)) {
      return this.withManagerAccessFlags(agency, true);
    }

    if (this.isSales(user)) {
      const canSeeContact = this.salesOwnsAgency(user, agency);
      const canEdit = this.canEditAgency(user, agency);
      return this.maskAgencyForSales(agency, canSeeContact, canEdit);
    }

    throw new ForbiddenException("No access");
  }

 async createAgency(user: ReqUser, dto: CreateAgencyDto) {
  if (!this.isAdmin(user) && !this.isManager(user) && !this.isSales(user)) {
    throw new ForbiddenException("No access to create agencies");
  }

  const name = this.cleanStr(dto.name);
  if (!name) throw new BadRequestException("Agency name is required");

  let assignedSalesId: string | null = dto.assignedSalesId || null;

  if (this.isSales(user)) {
    assignedSalesId = user.id;
  }

  if (assignedSalesId) {
    const sales = await this.prisma.user.findUnique({
      where: { id: assignedSalesId },
      select: { id: true, role: true, isActive: true },
    });

    if (!sales || !sales.isActive || sales.role !== "SALES") {
      throw new BadRequestException("Assigned sales user is invalid");
    }
  }

  const data: any = {
    name,
    contactName: this.cleanStr(dto.contactName) ?? null,
    phone: this.cleanStr(dto.phone) ?? null,
    email: this.cleanStr(dto.email) ?? null,
    city: this.cleanStr(dto.city) ?? null,
    country: this.cleanStr(dto.country) ?? null,
    address: this.cleanStr(dto.address) ?? null,
    website: this.cleanStr(dto.website) ?? null,
    source: this.cleanStr(dto.source) ?? null,
    notesSummary: this.cleanStr(dto.notesSummary) ?? null,
    assignedSalesId,
    status: dto.status || "ACTIVE",
  };

  return this.prisma.agency.create({
    data,
    include: {
      manager: { select: { id: true, name: true, email: true } },
      assignedSales: { select: { id: true, name: true, email: true } },
    },
  });
}

  async updateAgency(user: ReqUser, agencyId: string, dto: UpdateAgencyDto) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: {
        id: true,
        assignedSalesId: true,
      },
    });

    if (!agency) {
      throw new NotFoundException("Agency not found");
    }

    const managerCanEdit = this.isAdmin(user) || this.isManager(user);
    const salesCanEditOwn = this.isSales(user) && agency.assignedSalesId === user.id;

    if (!managerCanEdit && !salesCanEditOwn) {
      throw new ForbiddenException("No access to update this agency");
    }

    const data: any = {};

    if (dto.name !== undefined) {
      const name = this.cleanStr(dto.name);
      if (!name) {
        throw new BadRequestException("Agency name is required");
      }
      data.name = name;
    }

    if (dto.contactName !== undefined) data.contactName = this.cleanStr(dto.contactName) ?? null;
    if (dto.phone !== undefined) data.phone = this.cleanStr(dto.phone) ?? null;
    if (dto.email !== undefined) data.email = this.cleanStr(dto.email) ?? null;
    if (dto.city !== undefined) data.city = this.cleanStr(dto.city) ?? null;
    if (dto.country !== undefined) data.country = this.cleanStr(dto.country) ?? null;
    if (dto.address !== undefined) data.address = this.cleanStr(dto.address) ?? null;
    if (dto.website !== undefined) data.website = this.cleanStr(dto.website) ?? null;
    if (dto.source !== undefined) data.source = this.cleanStr(dto.source) ?? null;
    if (dto.notesSummary !== undefined) data.notesSummary = this.cleanStr(dto.notesSummary) ?? null;

    if ((managerCanEdit || salesCanEditOwn) && dto.status !== undefined) {
  data.status = dto.status;
}

    return this.prisma.agency.update({
      where: { id: agencyId },
      data,
      include: {
        manager: { select: { id: true, name: true, email: true } },
        assignedSales: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async deleteAgency(user: ReqUser, agencyId: string) {
    if (!this.isAdmin(user) && !this.isManager(user)) {
      throw new ForbiddenException("No access to delete agency");
    }

    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: { id: true },
    });

    if (!agency) {
      throw new NotFoundException("Agency not found");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.agencyTask.deleteMany({
        where: { agencyId },
      });

      await tx.agencyMeeting.deleteMany({
        where: { agencyId },
      });

      await tx.agencyNote.deleteMany({
        where: { agencyId },
      });

      await tx.customer.updateMany({
        where: { agencyId },
        data: { agencyId: null },
      });

      await tx.agency.delete({
        where: { id: agencyId },
      });
    });

    return { success: true };
  }

  async assignSales(user: ReqUser, agencyId: string, dto: AssignSalesDto) {
    await this.assertManagerCanManageAgency(user, agencyId);

    const salesId = dto.salesId || null;

    if (salesId) {
      const sales = await this.prisma.user.findUnique({
        where: { id: salesId },
        select: { id: true, role: true, isActive: true },
      });

      if (!sales || !sales.isActive || sales.role !== "SALES") {
        throw new BadRequestException("Selected user is not an active SALES rep");
      }
    }

    return this.prisma.agency.update({
      where: { id: agencyId },
      data: {
        assignedSalesId: salesId,
      },
      include: {
        manager: { select: { id: true, name: true, email: true } },
        assignedSales: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async addNote(user: ReqUser, agencyId: string, dto: CreateAgencyNoteDto) {
    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    const canEdit =
      this.isAdmin(user) ||
      this.isManager(user) ||
      this.salesOwnsAgency(user, agency);

    if (!canEdit) {
      throw new ForbiddenException("No access");
    }

    const note = this.cleanStr(dto.note);
    if (!note) throw new BadRequestException("Note is required");

    return this.prisma.agencyNote.create({
      data: {
        agencyId,
        createdById: user.id,
        note,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async createMeeting(user: ReqUser, agencyId: string, dto: CreateAgencyMeetingDto) {
    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    const canEdit =
      this.isAdmin(user) ||
      this.isManager(user) ||
      this.salesOwnsAgency(user, agency);

    if (!canEdit) {
      throw new ForbiddenException("No access");
    }

    const title = this.cleanStr(dto.title);
    if (!title) throw new BadRequestException("Meeting title is required");
    if (!dto.meetingAt) throw new BadRequestException("Meeting time is required");

    const meetingAt = new Date(dto.meetingAt);
    if (Number.isNaN(meetingAt.getTime())) {
      throw new BadRequestException("Invalid meetingAt");
    }

    return this.prisma.agencyMeeting.create({
      data: {
        agencyId,
        createdById: user.id,
        title,
        notes: this.cleanStr(dto.notes),
        meetingAt,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async updateMeeting(user: ReqUser, meetingId: string, dto: UpdateAgencyMeetingDto) {
    const meeting = await this.prisma.agencyMeeting.findUnique({
      where: { id: meetingId },
      include: {
        agency: true,
      },
    });

    if (!meeting) throw new NotFoundException("Meeting not found");

    const canEdit =
      this.isAdmin(user) ||
      this.isManager(user) ||
      meeting.agency.assignedSalesId === user.id;

    if (!canEdit) {
      throw new ForbiddenException("No access");
    }

    const data: any = {};

    if (dto.title !== undefined) {
      const title = this.cleanStr(dto.title);
      if (!title) throw new BadRequestException("Meeting title is required");
      data.title = title;
    }

    if (dto.notes !== undefined) {
      data.notes = this.cleanStr(dto.notes) ?? null;
    }

    if (dto.meetingAt !== undefined) {
      const meetingAt = new Date(dto.meetingAt);
      if (Number.isNaN(meetingAt.getTime())) {
        throw new BadRequestException("Invalid meetingAt");
      }
      data.meetingAt = meetingAt;
    }

    return this.prisma.agencyMeeting.update({
      where: { id: meetingId },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async createTask(user: ReqUser, agencyId: string, dto: CreateAgencyTaskDto) {
    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    const managerCanCreate = this.isAdmin(user) || this.isManager(user);
    const salesCanCreate =
      this.isSales(user) && agency.assignedSalesId === user.id;

    if (!managerCanCreate && !salesCanCreate) {
      throw new ForbiddenException("No access to create this task");
    }

    const title = this.cleanStr(dto.title);
    if (!title) throw new BadRequestException("Task title is required");

    let assignedToId: string | null = dto.assignedToId || null;

    if (this.isSales(user)) {
      assignedToId = user.id;
    }

    if (assignedToId) {
      const sales = await this.prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true, role: true, isActive: true },
      });

      if (!sales || !sales.isActive || sales.role !== "SALES") {
        throw new BadRequestException("Assigned user must be an active SALES rep");
      }
    }

    let dueAt: Date | undefined;
    if (dto.dueAt) {
      dueAt = new Date(dto.dueAt);
      if (Number.isNaN(dueAt.getTime())) {
        throw new BadRequestException("Invalid dueAt");
      }
    }

    return this.prisma.agencyTask.create({
      data: {
        agencyId: agency.id,
        createdById: user.id,
        assignedToId,
        title,
        description: this.cleanStr(dto.description),
        dueAt,
        priority: dto.priority || "MEDIUM",
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async updateTask(user: ReqUser, taskId: string, dto: UpdateAgencyTaskDto) {
    const task = await this.prisma.agencyTask.findUnique({
      where: { id: taskId },
      include: {
        agency: true,
      },
    });

    if (!task) throw new NotFoundException("Task not found");

    const managerCanEdit = this.isAdmin(user) || this.isManager(user);
    const salesCanEditOwn =
      this.isSales(user) && task.assignedToId === user.id;

    if (!managerCanEdit && !salesCanEditOwn) {
      throw new ForbiddenException("No access to update this task");
    }

    const data: any = {};

    if (dto.status !== undefined) {
      data.status = dto.status;
      data.completedAt = dto.status === "DONE" ? new Date() : null;
    }

    if (managerCanEdit) {
      if (dto.title !== undefined) {
        const title = this.cleanStr(dto.title);
        if (!title) throw new BadRequestException("Task title is required");
        data.title = title;
      }

      if (dto.description !== undefined) {
        data.description = this.cleanStr(dto.description) ?? null;
      }

      if (dto.priority !== undefined) {
        data.priority = dto.priority;
      }

      if (dto.assignedToId !== undefined) {
        if (!dto.assignedToId) {
          data.assignedToId = null;
        } else {
          const sales = await this.prisma.user.findUnique({
            where: { id: dto.assignedToId },
            select: { id: true, role: true, isActive: true },
          });

          if (!sales || !sales.isActive || sales.role !== "SALES") {
            throw new BadRequestException("Assigned user must be an active SALES rep");
          }

          data.assignedToId = dto.assignedToId;
        }
      }

      if (dto.dueAt !== undefined) {
        if (!dto.dueAt) {
          data.dueAt = null;
        } else {
          const dueAt = new Date(dto.dueAt);
          if (Number.isNaN(dueAt.getTime())) {
            throw new BadRequestException("Invalid dueAt");
          }
          data.dueAt = dueAt;
        }
      }
    }

    return this.prisma.agencyTask.update({
      where: { id: taskId },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });
  }
}