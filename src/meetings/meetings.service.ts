import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  MeetingOutcome,
  MeetingStatus,
  PresentationOutcome,
  PresentationStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type MeetingKind = "AGENCY" | "PRESENTATION" | "OTHER";

type ListMeetingsQuery = {
  q?: string;
  kind?: "ALL" | MeetingKind;
  agencyId?: string;
  assignedSalesId?: string;
  from?: string;
  to?: string;
  page?: string | number;
  pageSize?: string | number;
};

type CreateMeetingDto = {
  kind: MeetingKind;
  title: string;
  notes?: string;
  meetingAt: string;
  agencyId?: string;
  customerId?: string;
  assignedSalesId?: string;
  projectName?: string;
  location?: string;

  contactName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
};

type UpdateMeetingDto = {
  title?: string;
  notes?: string;
  meetingAt?: string;
  status?: string;
  outcome?: string | null;
  projectName?: string;
  location?: string;
  agencyId?: string | null;
  customerId?: string | null;
  assignedSalesId?: string | null;

  contactName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
};

@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  private cleanStr(value?: string | null) {
    const cleaned = String(value ?? "").trim();
    return cleaned || undefined;
  }

  private parseDate(value?: string) {
    if (!value) return undefined;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("Invalid date");
    }

    return date;
  }

  private positiveNumber(value: string | number | undefined, fallback: number) {
    if (value === undefined || value === null || value === "") return fallback;

    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
      throw new BadRequestException("Invalid numeric parameter");
    }

    return Math.floor(number);
  }

  private ensureCrmUser(user: ReqUser) {
    if (!["ADMIN", "MANAGER", "SALES"].includes(user.role)) {
      throw new ForbiddenException("No access");
    }
  }

  private ensureKind(kind: string): asserts kind is MeetingKind {
    if (kind !== "AGENCY" && kind !== "PRESENTATION" && kind !== "OTHER") {
      throw new BadRequestException("Invalid meeting kind");
    }
  }

  private canModifyMeeting(user: ReqUser, row: { createdById: string }) {
    if (user.role === "ADMIN" || user.role === "MANAGER") return true;
    return row.createdById === user.id;
  }

  private resolveAssignedSalesId(user: ReqUser, value?: string | null) {
    if (user.role === "SALES") return user.id;
    return this.cleanStr(value) ?? null;
  }

  private async validateAgency(id?: string | null) {
    if (!id) return null;

    const agency = await this.prisma.agency.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        managerId: true,
        assignedSalesId: true,
      },
    });

    if (!agency) throw new NotFoundException("Agency not found");

    return agency;
  }

  private async validateCustomer(id?: string | null) {
    if (!id) return null;

    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        ownerId: true,
      },
    });

    if (!customer) throw new NotFoundException("Customer not found");

    return customer;
  }

  private async validateSalesUser(id?: string | null) {
    if (!id) return null;

    const sales = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!sales || !sales.isActive || sales.role !== "SALES") {
      throw new BadRequestException("Assigned sales is invalid");
    }

    return sales;
  }

  private canSeeAgencyMeeting(user: ReqUser, row: any) {
    if (user.role === "ADMIN" || user.role === "MANAGER") return true;

    return (
      user.role === "SALES" &&
      (row.assignedSalesId === user.id ||
        row.createdById === user.id ||
        row.agency?.assignedSalesId === user.id)
    );
  }

  private canSeePresentation(user: ReqUser, row: any) {
    if (user.role === "ADMIN" || user.role === "MANAGER") return true;

    return (
      user.role === "SALES" &&
      (row.assignedSalesId === user.id || row.createdById === user.id)
    );
  }

  private canSeeOtherMeeting(user: ReqUser, row: any) {
    if (user.role === "ADMIN" || user.role === "MANAGER") return true;

    return (
      user.role === "SALES" &&
      (row.assignedSalesId === user.id || row.createdById === user.id)
    );
  }

  private normalizeAgencyMeeting(row: any) {
    return {
      id: row.id,
      kind: "AGENCY" as const,
      title: row.title,
      notes: row.notes,
      meetingAt: row.meetingAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      status: row.status,
      outcome: row.outcome,
      projectName: null,
      location: null,
      contactName: null,
      companyName: null,
      phone: null,
      email: null,
      agency: row.agency
        ? {
            id: row.agency.id,
            name: row.agency.name,
          }
        : null,
      customer: row.customer
        ? {
            id: row.customer.id,
            fullName: row.customer.fullName,
            companyName: row.customer.companyName,
          }
        : null,
      assignedSales: row.assignedSales,
      createdBy: row.createdBy,
    };
  }

  private normalizePresentation(row: any) {
    return {
      id: row.id,
      kind: "PRESENTATION" as const,
      title: row.title,
      notes: row.notesSummary,
      meetingAt: row.presentationAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      status: row.status,
      outcome: row.outcome,
      projectName: row.projectName,
      location: row.location,
      contactName: null,
      companyName: null,
      phone: null,
      email: null,
      agency: row.agency
        ? {
            id: row.agency.id,
            name: row.agency.name,
          }
        : null,
      customer: row.customer
        ? {
            id: row.customer.id,
            fullName: row.customer.fullName,
            companyName: row.customer.companyName,
          }
        : null,
      assignedSales: row.assignedSales,
      createdBy: row.createdBy,
    };
  }

  private normalizeOtherMeeting(row: any) {
    return {
      id: row.id,
      kind: "OTHER" as const,
      title: row.title,
      notes: row.notes,
      meetingAt: row.meetingAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      status: row.status,
      outcome: row.outcome,
      projectName: null,
      location: null,
      contactName: row.contactName,
      companyName: row.companyName,
      phone: row.phone,
      email: row.email,
      agency: null,
      customer: null,
      assignedSales: row.assignedSales,
      createdBy: row.createdBy,
    };
  }

  private applyMeetingStatusAndOutcome(data: any, dto: UpdateMeetingDto) {
    if (dto.status !== undefined) {
      const status = dto.status as MeetingStatus;

      if (!Object.values(MeetingStatus).includes(status)) {
        throw new BadRequestException("Invalid meeting status");
      }

      data.status = status;
    }

    if (dto.outcome !== undefined) {
      if (dto.outcome === null || dto.outcome === "") {
        data.outcome = null;
      } else {
        const outcome = dto.outcome as MeetingOutcome;

        if (!Object.values(MeetingOutcome).includes(outcome)) {
          throw new BadRequestException("Invalid meeting outcome");
        }

        data.outcome = outcome;
      }
    }
  }

  private applyPresentationStatusAndOutcome(
    data: Prisma.PresentationUpdateInput,
    dto: UpdateMeetingDto,
  ) {
    if (dto.status !== undefined) {
      const status = dto.status as PresentationStatus;

      if (!Object.values(PresentationStatus).includes(status)) {
        throw new BadRequestException("Invalid presentation status");
      }

      data.status = status;
    }

    if (dto.outcome !== undefined) {
      if (dto.outcome === null || dto.outcome === "") {
        data.outcome = null;
      } else {
        const outcome = dto.outcome as PresentationOutcome;

        if (!Object.values(PresentationOutcome).includes(outcome)) {
          throw new BadRequestException("Invalid presentation outcome");
        }

        data.outcome = outcome;
      }
    }
  }

  async listMeetings(user: ReqUser, query: ListMeetingsQuery = {}) {
    this.ensureCrmUser(user);

    const kind = query.kind ?? "ALL";
    if (kind !== "ALL") this.ensureKind(kind);

    const q = this.cleanStr(query.q);
    const agencyId = this.cleanStr(query.agencyId);
    const assignedSalesId = this.cleanStr(query.assignedSalesId);
    const from = this.parseDate(query.from);
    const to = this.parseDate(query.to);

    const page = this.positiveNumber(query.page, 1);
    const pageSize = Math.min(100, this.positiveNumber(query.pageSize, 20));

    const agencyWhere: Prisma.AgencyMeetingWhereInput = {};
    const presentationWhere: Prisma.PresentationWhereInput = {};
    const otherWhere: Prisma.OtherMeetingWhereInput = {};

    const agencyAnd: Prisma.AgencyMeetingWhereInput[] = [];
    const presentationAnd: Prisma.PresentationWhereInput[] = [];
    const otherAnd: Prisma.OtherMeetingWhereInput[] = [];

    if (agencyId) {
      agencyWhere.agencyId = agencyId;
      presentationWhere.agencyId = agencyId;
    }

    if (user.role === "SALES") {
      agencyAnd.push({
        OR: [
          { assignedSalesId: user.id },
          { createdById: user.id },
          { agency: { assignedSalesId: user.id } },
        ],
      });

      presentationAnd.push({
        OR: [{ assignedSalesId: user.id }, { createdById: user.id }],
      });

      otherAnd.push({
        OR: [{ assignedSalesId: user.id }, { createdById: user.id }],
      });
    } else if (assignedSalesId) {
      agencyAnd.push({
        OR: [{ assignedSalesId }, { agency: { assignedSalesId } }],
      });

      presentationWhere.assignedSalesId = assignedSalesId;
      otherWhere.assignedSalesId = assignedSalesId;
    }

    if (q) {
      agencyAnd.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
          { agency: { name: { contains: q, mode: "insensitive" } } },
          { customer: { fullName: { contains: q, mode: "insensitive" } } },
          { customer: { companyName: { contains: q, mode: "insensitive" } } },
        ],
      });

      presentationAnd.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { projectName: { contains: q, mode: "insensitive" } },
          { location: { contains: q, mode: "insensitive" } },
          { notesSummary: { contains: q, mode: "insensitive" } },
          { customer: { fullName: { contains: q, mode: "insensitive" } } },
          { customer: { companyName: { contains: q, mode: "insensitive" } } },
          { agency: { name: { contains: q, mode: "insensitive" } } },
        ],
      });

      otherAnd.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
          { contactName: { contains: q, mode: "insensitive" } },
          { companyName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    if (from || to) {
      agencyWhere.meetingAt = {};
      presentationWhere.presentationAt = {};
      otherWhere.meetingAt = {};

      if (from) {
        agencyWhere.meetingAt.gte = from;
        presentationWhere.presentationAt.gte = from;
        otherWhere.meetingAt.gte = from;
      }

      if (to) {
        agencyWhere.meetingAt.lte = to;
        presentationWhere.presentationAt.lte = to;
        otherWhere.meetingAt.lte = to;
      }
    }

    if (agencyAnd.length) agencyWhere.AND = agencyAnd;
    if (presentationAnd.length) presentationWhere.AND = presentationAnd;
    if (otherAnd.length) otherWhere.AND = otherAnd;

    const [agencyMeetings, presentations, otherMeetings] = await Promise.all([
      kind === "ALL" || kind === "AGENCY"
        ? this.prisma.agencyMeeting.findMany({
            where: agencyWhere,
            include: {
              agency: {
                select: {
                  id: true,
                  name: true,
                  assignedSalesId: true,
                  managerId: true,
                },
              },
              customer: {
                select: {
                  id: true,
                  fullName: true,
                  companyName: true,
                },
              },
              assignedSales: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: { meetingAt: "desc" },
            take: 500,
          })
        : Promise.resolve([]),

      kind === "ALL" || kind === "PRESENTATION"
        ? this.prisma.presentation.findMany({
            where: presentationWhere,
            include: {
              agency: {
                select: {
                  id: true,
                  name: true,
                },
              },
              customer: {
                select: {
                  id: true,
                  fullName: true,
                  companyName: true,
                  ownerId: true,
                },
              },
              assignedSales: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: { presentationAt: "desc" },
            take: 500,
          })
        : Promise.resolve([]),

      kind === "ALL" || kind === "OTHER"
        ? this.prisma.otherMeeting.findMany({
            where: otherWhere,
            include: {
              assignedSales: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: { meetingAt: "desc" },
            take: 500,
          })
        : Promise.resolve([]),
    ]);

    const agencyItems = agencyMeetings
      .filter((row) => this.canSeeAgencyMeeting(user, row))
      .map((row) => this.normalizeAgencyMeeting(row));

    const presentationItems = presentations
      .filter((row) => this.canSeePresentation(user, row))
      .map((row) => this.normalizePresentation(row));

    const otherItems = otherMeetings
      .filter((row) => this.canSeeOtherMeeting(user, row))
      .map((row) => this.normalizeOtherMeeting(row));

    const merged = [...agencyItems, ...presentationItems, ...otherItems].sort(
      (a, b) =>
        new Date(b.meetingAt).getTime() - new Date(a.meetingAt).getTime(),
    );

    const total = merged.length;
    const start = (page - 1) * pageSize;

    return {
      items: merged.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getMeeting(user: ReqUser, kind: MeetingKind, id: string) {
    this.ensureCrmUser(user);
    this.ensureKind(kind);

    if (!id) throw new BadRequestException("Meeting id is required");

    if (kind === "AGENCY") {
      const row = await this.prisma.agencyMeeting.findUnique({
        where: { id },
        include: {
          agency: {
            select: {
              id: true,
              name: true,
              assignedSalesId: true,
              managerId: true,
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              companyName: true,
            },
          },
          assignedSales: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!row) throw new NotFoundException("Meeting not found");
      if (!this.canSeeAgencyMeeting(user, row)) throw new ForbiddenException("No access");

      return this.normalizeAgencyMeeting(row);
    }

    if (kind === "PRESENTATION") {
      const row = await this.prisma.presentation.findUnique({
        where: { id },
        include: {
          agency: {
            select: {
              id: true,
              name: true,
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              companyName: true,
              ownerId: true,
            },
          },
          assignedSales: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!row) throw new NotFoundException("Meeting not found");
      if (!this.canSeePresentation(user, row)) throw new ForbiddenException("No access");

      return this.normalizePresentation(row);
    }

    const row = await this.prisma.otherMeeting.findUnique({
      where: { id },
      include: {
        assignedSales: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!row) throw new NotFoundException("Meeting not found");
    if (!this.canSeeOtherMeeting(user, row)) throw new ForbiddenException("No access");

    return this.normalizeOtherMeeting(row);
  }

  async createMeeting(user: ReqUser, dto: CreateMeetingDto) {
    this.ensureCrmUser(user);
    this.ensureKind(dto.kind);

    const title = this.cleanStr(dto.title);
    const notes = this.cleanStr(dto.notes);
    const meetingAt = this.parseDate(dto.meetingAt);

    if (!title) throw new BadRequestException("title is required");
    if (!meetingAt) throw new BadRequestException("meetingAt is required");

    const agencyId = this.cleanStr(dto.agencyId) ?? null;
    const customerId = this.cleanStr(dto.customerId) ?? null;
    const assignedSalesId = this.resolveAssignedSalesId(
      user,
      dto.assignedSalesId,
    );

    await this.validateSalesUser(assignedSalesId);

    if (dto.kind === "AGENCY") {
      await this.validateAgency(agencyId);
      await this.validateCustomer(customerId);

      const row = await this.prisma.agencyMeeting.create({
        data: {
          title,
          notes,
          meetingAt,
          agencyId,
          customerId,
          assignedSalesId,
          createdById: user.id,
        },
        include: {
          agency: {
            select: {
              id: true,
              name: true,
              assignedSalesId: true,
              managerId: true,
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              companyName: true,
            },
          },
          assignedSales: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return this.normalizeAgencyMeeting(row);
    }

    if (dto.kind === "PRESENTATION") {
      await this.validateAgency(agencyId);
      await this.validateCustomer(customerId);

      const row = await this.prisma.presentation.create({
        data: {
          title,
          notesSummary: notes,
          presentationAt: meetingAt,
          projectName: this.cleanStr(dto.projectName),
          location: this.cleanStr(dto.location),
          agencyId,
          customerId,
          assignedSalesId,
          createdById: user.id,
        },
        include: {
          agency: {
            select: {
              id: true,
              name: true,
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              companyName: true,
              ownerId: true,
            },
          },
          assignedSales: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return this.normalizePresentation(row);
    }

    const row = await this.prisma.otherMeeting.create({
      data: {
        title,
        notes,
        meetingAt,
        assignedSalesId,
        createdById: user.id,
        contactName: this.cleanStr(dto.contactName),
        companyName: this.cleanStr(dto.companyName),
        phone: this.cleanStr(dto.phone),
        email: this.cleanStr(dto.email),
      },
      include: {
        assignedSales: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return this.normalizeOtherMeeting(row);
  }

  async updateMeeting(
    user: ReqUser,
    kind: MeetingKind,
    id: string,
    dto: UpdateMeetingDto,
  ) {
    this.ensureCrmUser(user);
    this.ensureKind(kind);

    if (!id) throw new BadRequestException("Meeting id is required");

    if (kind === "AGENCY") {
      const existing = await this.prisma.agencyMeeting.findUnique({
        where: { id },
        select: {
          id: true,
          createdById: true,
        },
      });

      if (!existing) throw new NotFoundException("Meeting not found");

      if (!this.canModifyMeeting(user, existing)) {
        throw new ForbiddenException(
          "Only creator, manager or admin can edit this meeting",
        );
      }

      const data: Prisma.AgencyMeetingUpdateInput = {};

      if (dto.title !== undefined) {
        const title = this.cleanStr(dto.title);
        if (!title) throw new BadRequestException("title is required");
        data.title = title;
      }

      if (dto.notes !== undefined) data.notes = this.cleanStr(dto.notes) ?? null;

      if (dto.meetingAt !== undefined) {
        const meetingAt = this.parseDate(dto.meetingAt);
        if (!meetingAt) throw new BadRequestException("meetingAt is required");
        data.meetingAt = meetingAt;
      }

      this.applyMeetingStatusAndOutcome(data, dto);

      if (dto.agencyId !== undefined) {
        const agencyId = this.cleanStr(dto.agencyId) ?? null;
        await this.validateAgency(agencyId);
        data.agency = agencyId ? { connect: { id: agencyId } } : { disconnect: true };
      }

      if (dto.customerId !== undefined) {
        const customerId = this.cleanStr(dto.customerId) ?? null;
        await this.validateCustomer(customerId);
        data.customer = customerId
          ? { connect: { id: customerId } }
          : { disconnect: true };
      }

      if (dto.assignedSalesId !== undefined) {
        const assignedSalesId = this.resolveAssignedSalesId(
          user,
          dto.assignedSalesId,
        );
        await this.validateSalesUser(assignedSalesId);
        data.assignedSales = assignedSalesId
          ? { connect: { id: assignedSalesId } }
          : { disconnect: true };
      }

      const updated = await this.prisma.agencyMeeting.update({
        where: { id },
        data,
        include: {
          agency: {
            select: {
              id: true,
              name: true,
              assignedSalesId: true,
              managerId: true,
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              companyName: true,
            },
          },
          assignedSales: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return this.normalizeAgencyMeeting(updated);
    }

    if (kind === "PRESENTATION") {
      const existing = await this.prisma.presentation.findUnique({
        where: { id },
        select: {
          id: true,
          createdById: true,
        },
      });

      if (!existing) throw new NotFoundException("Meeting not found");

      if (!this.canModifyMeeting(user, existing)) {
        throw new ForbiddenException(
          "Only creator, manager or admin can edit this meeting",
        );
      }

      const data: Prisma.PresentationUpdateInput = {};

      if (dto.title !== undefined) {
        const title = this.cleanStr(dto.title);
        if (!title) throw new BadRequestException("title is required");
        data.title = title;
      }

      if (dto.notes !== undefined) data.notesSummary = this.cleanStr(dto.notes) ?? null;

      if (dto.meetingAt !== undefined) {
        const meetingAt = this.parseDate(dto.meetingAt);
        if (!meetingAt) throw new BadRequestException("meetingAt is required");
        data.presentationAt = meetingAt;
      }

      if (dto.projectName !== undefined) {
        data.projectName = this.cleanStr(dto.projectName) ?? null;
      }

      if (dto.location !== undefined) {
        data.location = this.cleanStr(dto.location) ?? null;
      }

      this.applyPresentationStatusAndOutcome(data, dto);

      if (dto.agencyId !== undefined) {
        const agencyId = this.cleanStr(dto.agencyId) ?? null;
        await this.validateAgency(agencyId);
        data.agency = agencyId ? { connect: { id: agencyId } } : { disconnect: true };
      }

      if (dto.customerId !== undefined) {
        const customerId = this.cleanStr(dto.customerId) ?? null;
        await this.validateCustomer(customerId);
        data.customer = customerId
          ? { connect: { id: customerId } }
          : { disconnect: true };
      }

      if (dto.assignedSalesId !== undefined) {
        const assignedSalesId = this.resolveAssignedSalesId(
          user,
          dto.assignedSalesId,
        );
        await this.validateSalesUser(assignedSalesId);
        data.assignedSales = assignedSalesId
          ? { connect: { id: assignedSalesId } }
          : { disconnect: true };
      }

      const updated = await this.prisma.presentation.update({
        where: { id },
        data,
        include: {
          agency: {
            select: {
              id: true,
              name: true,
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              companyName: true,
              ownerId: true,
            },
          },
          assignedSales: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return this.normalizePresentation(updated);
    }

    const existing = await this.prisma.otherMeeting.findUnique({
      where: { id },
      select: {
        id: true,
        createdById: true,
      },
    });

    if (!existing) throw new NotFoundException("Meeting not found");

    if (!this.canModifyMeeting(user, existing)) {
      throw new ForbiddenException(
        "Only creator, manager or admin can edit this meeting",
      );
    }

    const data: Prisma.OtherMeetingUpdateInput = {};

    if (dto.title !== undefined) {
      const title = this.cleanStr(dto.title);
      if (!title) throw new BadRequestException("title is required");
      data.title = title;
    }

    if (dto.notes !== undefined) data.notes = this.cleanStr(dto.notes) ?? null;

    if (dto.meetingAt !== undefined) {
      const meetingAt = this.parseDate(dto.meetingAt);
      if (!meetingAt) throw new BadRequestException("meetingAt is required");
      data.meetingAt = meetingAt;
    }

    this.applyMeetingStatusAndOutcome(data, dto);

    if (dto.contactName !== undefined) {
      data.contactName = this.cleanStr(dto.contactName) ?? null;
    }

    if (dto.companyName !== undefined) {
      data.companyName = this.cleanStr(dto.companyName) ?? null;
    }

    if (dto.phone !== undefined) {
      data.phone = this.cleanStr(dto.phone) ?? null;
    }

    if (dto.email !== undefined) {
      data.email = this.cleanStr(dto.email) ?? null;
    }

    if (dto.assignedSalesId !== undefined) {
      const assignedSalesId = this.resolveAssignedSalesId(
        user,
        dto.assignedSalesId,
      );
      await this.validateSalesUser(assignedSalesId);
      data.assignedSales = assignedSalesId
        ? { connect: { id: assignedSalesId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.otherMeeting.update({
      where: { id },
      data,
      include: {
        assignedSales: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return this.normalizeOtherMeeting(updated);
  }

  async deleteMeeting(user: ReqUser, kind: MeetingKind, id: string) {
    this.ensureCrmUser(user);
    this.ensureKind(kind);

    if (!id) throw new BadRequestException("Meeting id is required");

    if (kind === "AGENCY") {
      const row = await this.prisma.agencyMeeting.findUnique({
        where: { id },
        select: {
          id: true,
          createdById: true,
        },
      });

      if (!row) throw new NotFoundException("Meeting not found");

      if (!this.canModifyMeeting(user, row)) {
        throw new ForbiddenException(
          "Only creator, manager or admin can delete this meeting",
        );
      }

      return this.prisma.agencyMeeting.delete({
        where: { id },
      });
    }

    if (kind === "PRESENTATION") {
      const row = await this.prisma.presentation.findUnique({
        where: { id },
        select: {
          id: true,
          createdById: true,
        },
      });

      if (!row) throw new NotFoundException("Meeting not found");

      if (!this.canModifyMeeting(user, row)) {
        throw new ForbiddenException(
          "Only creator, manager or admin can delete this meeting",
        );
      }

      return this.prisma.presentation.delete({
        where: { id },
      });
    }

    const row = await this.prisma.otherMeeting.findUnique({
      where: { id },
      select: {
        id: true,
        createdById: true,
      },
    });

    if (!row) throw new NotFoundException("Meeting not found");

    if (!this.canModifyMeeting(user, row)) {
      throw new ForbiddenException(
        "Only creator, manager or admin can delete this meeting",
      );
    }

    return this.prisma.otherMeeting.delete({
      where: { id },
    });
  }
}