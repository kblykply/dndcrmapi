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

type AgencyStatus = "ACTIVE" | "PASSIVE" | "PROSPECT" | "DEALING" | "CLOSED";

type CreateAgencyDto = {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  website?: string | null;
  source?: string | null;
  notesSummary?: string | null;
  assignedSalesId?: string | null;
  status?: AgencyStatus;
};

type UpdateAgencyDto = Partial<CreateAgencyDto>;

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
    return user.role === "MANAGER";
  }

  private isSales(user: ReqUser) {
    return user.role === "SALES";
  }

  private cleanStr(v?: string | null) {
    const x = (v ?? "").trim();
    return x || undefined;
  }

  private async validateAssignableUser(id?: string | null) {
    if (!id) return null;

    const found = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });

    if (
      !found ||
      !found.isActive ||
      (found.role !== "SALES" && found.role !== "MANAGER")
    ) {
      throw new BadRequestException(
        "Selected user must be an active SALES or MANAGER",
      );
    }

    return found;
  }

  private async validateSalesUser(id?: string | null) {
    if (!id) return null;

    const found = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });

    if (!found || !found.isActive || found.role !== "SALES") {
      throw new BadRequestException("Selected user is not an active SALES rep");
    }

    return found;
  }

  private resolveAssignedSalesId(user: ReqUser, value?: string | null) {
    if (this.isSales(user)) return user.id;
    if (this.isManager(user) && !value) return user.id;
    return this.cleanStr(value) ?? null;
  }

  private ownsAgency(user: ReqUser, agency: { assignedSalesId?: string | null }) {
    return agency.assignedSalesId === user.id;
  }

  private canSeeAgency(user: ReqUser, agency: { assignedSalesId?: string | null }) {
    return this.isAdmin(user) || this.ownsAgency(user, agency);
  }

  private canEditAgency(user: ReqUser, agency: { assignedSalesId?: string | null }) {
    return this.isAdmin(user) || this.ownsAgency(user, agency);
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

  private withAccessFlags(agency: any, canEdit = true) {
    return {
      ...agency,
      canSeeContactDetails: true,
      canEdit,
    };
  }

  private agencyIncludeForDetail() {
    return {
      assignedSales: {
        select: { id: true, name: true, email: true, role: true },
      },
      notes: {
        orderBy: { createdAt: "desc" as const },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      },
      meetings: {
        orderBy: { meetingAt: "asc" as const },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          assignedSales: { select: { id: true, name: true, email: true, role: true } },
          customer: { select: { id: true, fullName: true, companyName: true } },
        },
      },
      tasks: {
        orderBy: [{ status: "asc" as const }, { dueAt: "asc" as const }],
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
        },
      },
    };
  }

  private async getAccessibleAgencyOrThrow(user: ReqUser, agencyId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        assignedSales: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    if (!agency) throw new NotFoundException("Agency not found");

    if (this.canSeeAgency(user, agency)) return agency;

    throw new ForbiddenException("No access to this agency");
  }

  private async assertCanManageAgency(user: ReqUser, agencyId: string) {
    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    if (!this.isAdmin(user) && !this.ownsAgency(user, agency)) {
      throw new ForbiddenException("Only assigned user or admin can manage this agency");
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

    if (!this.isAdmin(user)) {
      where.assignedSalesId = user.id;
    }

    if (this.isAdmin(user) && assignedSalesId) {
      where.assignedSalesId = assignedSalesId;
    }

    if (status && status !== "ALL") {
      where.status = status;
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
          assignedSales: {
            select: { id: true, name: true, email: true, role: true },
          },
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
      const canEdit = this.canEditAgency(user, agency);

      if (this.isSales(user)) {
        return this.maskAgencyForSales(
          agency,
          this.ownsAgency(user, agency),
          canEdit,
        );
      }

      return this.withAccessFlags(agency, canEdit);
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
      include: this.agencyIncludeForDetail(),
    });

    if (!agency) throw new NotFoundException("Agency not found");

    if (!this.canSeeAgency(user, agency)) {
      throw new ForbiddenException("No access to this agency");
    }

    const canEdit = this.canEditAgency(user, agency);

    if (this.isSales(user)) {
      return this.maskAgencyForSales(
        agency,
        this.ownsAgency(user, agency),
        canEdit,
      );
    }

    return this.withAccessFlags(agency, canEdit);
  }

  async createAgency(user: ReqUser, dto: CreateAgencyDto) {
    if (!this.isAdmin(user) && !this.isManager(user) && !this.isSales(user)) {
      throw new ForbiddenException("No access to create agencies");
    }

    const name = this.cleanStr(dto.name);
    if (!name) throw new BadRequestException("Agency name is required");

    const assignedSalesId = this.resolveAssignedSalesId(
      user,
      dto.assignedSalesId,
    );

    await this.validateAssignableUser(assignedSalesId);

    const allowedStatuses = [
      "ACTIVE",
      "PASSIVE",
      "PROSPECT",
      "DEALING",
      "CLOSED",
    ] as const;

    const status =
      dto.status && allowedStatuses.includes(dto.status) ? dto.status : "ACTIVE";

    return this.prisma.agency.create({
      data: {
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
        status,
      },
      include: {
        assignedSales: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  async updateAgency(user: ReqUser, agencyId: string, dto: UpdateAgencyDto) {
    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    if (!this.canEditAgency(user, agency)) {
      throw new ForbiddenException("No access to update this agency");
    }

    const data: any = {};

    if (dto.name !== undefined) {
      const name = this.cleanStr(dto.name);
      if (!name) throw new BadRequestException("Agency name is required");
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

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    if (dto.assignedSalesId !== undefined) {
      if (!this.isAdmin(user) && !this.ownsAgency(user, agency)) {
        throw new ForbiddenException("Only assigned user or admin can reassign agency");
      }

      const assignedSalesId = this.cleanStr(dto.assignedSalesId) ?? null;
      await this.validateAssignableUser(assignedSalesId);
      data.assignedSalesId = assignedSalesId;
    }

    return this.prisma.agency.update({
      where: { id: agencyId },
      data,
      include: {
        assignedSales: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  async deleteAgency(user: ReqUser, agencyId: string) {
    if (!this.isAdmin(user) && !this.isManager(user)) {
      throw new ForbiddenException("No access to delete agency");
    }

    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    if (!this.isAdmin(user) && !this.ownsAgency(user, agency)) {
      throw new ForbiddenException("Only assigned manager or admin can delete agency");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.agencyTask.deleteMany({ where: { agencyId } });
      await tx.agencyMeeting.deleteMany({ where: { agencyId } });
      await tx.agencyNote.deleteMany({ where: { agencyId } });

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
    const agency = await this.assertCanManageAgency(user, agencyId);

    const salesId = this.cleanStr(dto.salesId) ?? null;
    await this.validateAssignableUser(salesId);

    return this.prisma.agency.update({
      where: { id: agency.id },
      data: {
        assignedSalesId: salesId,
      },
      include: {
        assignedSales: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  async addNote(user: ReqUser, agencyId: string, dto: CreateAgencyNoteDto) {
    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    if (!this.canEditAgency(user, agency)) {
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

    if (!this.canEditAgency(user, agency)) {
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
        assignedSalesId: agency.assignedSalesId ?? null,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedSales: { select: { id: true, name: true, email: true, role: true } },
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
    if (!meeting.agency) throw new NotFoundException("Agency not found");

    if (!this.canEditAgency(user, meeting.agency)) {
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
        assignedSales: { select: { id: true, name: true, email: true, role: true } },
      },
    });
  }

  async createTask(user: ReqUser, agencyId: string, dto: CreateAgencyTaskDto) {
    const agency = await this.getAccessibleAgencyOrThrow(user, agencyId);

    if (!this.canEditAgency(user, agency)) {
      throw new ForbiddenException("No access to create this task");
    }

    const title = this.cleanStr(dto.title);
    if (!title) throw new BadRequestException("Task title is required");

    let assignedToId: string | null = dto.assignedToId || null;

    if (this.isSales(user)) {
      assignedToId = user.id;
    }

    if (assignedToId) {
      await this.validateSalesUser(assignedToId);
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

    const ownerCanEdit =
      this.isAdmin(user) ||
      (task.agency?.assignedSalesId === user.id && user.role === "MANAGER");

    const salesCanEditOwn = this.isSales(user) && task.assignedToId === user.id;

    if (!ownerCanEdit && !salesCanEditOwn) {
      throw new ForbiddenException("No access to update this task");
    }

    const data: any = {};

    if (dto.status !== undefined) {
      data.status = dto.status;
      data.completedAt = dto.status === "DONE" ? new Date() : null;
    }

    if (ownerCanEdit) {
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
          await this.validateSalesUser(dto.assignedToId);
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