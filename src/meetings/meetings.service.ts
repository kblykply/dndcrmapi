import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type MeetingKind = "AGENCY" | "PRESENTATION";

type ListMeetingsQuery = {
  q?: string;
  kind?: "ALL" | MeetingKind;
  from?: string;
  to?: string;
  page?: string | number;
  pageSize?: string | number;
};

type CreateMeetingDto = {
  kind: MeetingKind;

  // shared
  title: string;
  notes?: string;
  meetingAt: string;

  // agency
  agencyId?: string;

  // presentation
  customerId?: string;
  assignedSalesId?: string;
  projectName?: string;
  location?: string;
};

type AgencyMeetingRow = Prisma.AgencyMeetingGetPayload<{
  include: {
    agency: {
      select: {
        id: true;
        name: true;
        assignedSalesId: true;
        managerId: true;
      };
    };
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
      };
    };
  };
}>;

type PresentationRow = Prisma.PresentationGetPayload<{
  include: {
    customer: {
      select: {
        id: true;
        fullName: true;
        ownerId: true;
      };
    };
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
      };
    };
    assignedSales: {
      select: {
        id: true;
        name: true;
        email: true;
      };
    };
  };
}>;

@Injectable()
export class MeetingsService {
  constructor(private prisma: PrismaService) {}

  private cleanStr(v?: string | null) {
    const x = String(v || "").trim();
    return x || undefined;
  }

  private toPositiveNumber(value: string | number | undefined, fallback: number) {
    if (value === undefined || value === null || value === "") return fallback;

    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      throw new BadRequestException("Invalid numeric parameter");
    }

    return Math.floor(num);
  }

  private parseDateOrThrow(value?: string) {
    if (!value) return undefined;

    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
      throw new BadRequestException("Invalid date");
    }

    return dt;
  }

  private canSeeAgencyMeeting(user: ReqUser, row: AgencyMeetingRow) {
    if (user.role === "ADMIN" || user.role === "MANAGER") return true;
    if (user.role === "SALES" && row.agency.assignedSalesId === user.id) return true;
    return false;
  }

  private canSeePresentation(user: ReqUser, row: PresentationRow) {
    if (user.role === "ADMIN" || user.role === "MANAGER") return true;
    if (user.role === "SALES" && row.assignedSalesId === user.id) return true;
    return false;
  }

  private canCreateAgencyMeeting(user: ReqUser, agency: { assignedSalesId: string | null }) {
    if (user.role === "ADMIN" || user.role === "MANAGER") return true;
    if (user.role === "SALES" && agency.assignedSalesId === user.id) return true;
    return false;
  }

  private canCreatePresentation(
    user: ReqUser,
    assignedSalesId?: string | null,
  ) {
    if (user.role === "ADMIN" || user.role === "MANAGER") return true;
    if (user.role === "SALES" && assignedSalesId === user.id) return true;
    return false;
  }

  async listMeetings(user: ReqUser, query?: ListMeetingsQuery) {
    if (
      user.role !== "ADMIN" &&
      user.role !== "MANAGER" &&
      user.role !== "SALES"
    ) {
      throw new ForbiddenException("No access");
    }

    const q = this.cleanStr(query?.q);
    const kind = query?.kind || "ALL";
    const from = this.parseDateOrThrow(query?.from);
    const to = this.parseDateOrThrow(query?.to);

    const page = this.toPositiveNumber(query?.page, 1);
    const pageSize = Math.min(100, this.toPositiveNumber(query?.pageSize, 20));

    const agencyWhere: Prisma.AgencyMeetingWhereInput = {};
    const presentationWhere: Prisma.PresentationWhereInput = {};

    if (user.role === "SALES") {
      agencyWhere.agency = {
        assignedSalesId: user.id,
      };

      presentationWhere.assignedSalesId = user.id;
    }

 if (q) {
  agencyWhere.AND = [
    {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
        { agency: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
  ];

  presentationWhere.AND = [
    {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { projectName: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
        { notesSummary: { contains: q, mode: "insensitive" } },
        { customer: { fullName: { contains: q, mode: "insensitive" } } },
      ],
    },
  ];
}
    if (from || to) {
      agencyWhere.meetingAt = {};
      presentationWhere.presentationAt = {};

      if (from) {
        agencyWhere.meetingAt.gte = from;
        presentationWhere.presentationAt.gte = from;
      }

      if (to) {
        agencyWhere.meetingAt.lte = to;
        presentationWhere.presentationAt.lte = to;
      }
    }

    const [agencyMeetings, presentations] = await Promise.all([
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
        : Promise.resolve([] as AgencyMeetingRow[]),

      kind === "ALL" || kind === "PRESENTATION"
        ? this.prisma.presentation.findMany({
            where: presentationWhere,
            include: {
              customer: {
                select: {
                  id: true,
                  fullName: true,
                  ownerId: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              assignedSales: {
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
        : Promise.resolve([] as PresentationRow[]),
    ]);

    const agencyItems = agencyMeetings
      .filter((row) => this.canSeeAgencyMeeting(user, row))
      .map((row) => ({
        id: row.id,
        kind: "AGENCY" as const,
        title: row.title,
        notes: row.notes,
        meetingAt: row.meetingAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        status: null,
        projectName: null,
        location: null,
        agency: {
          id: row.agency.id,
          name: row.agency.name,
        },
        customer: null,
        createdBy: row.createdBy,
        assignedSales: null,
      }));

    const presentationItems = presentations
      .filter((row) => this.canSeePresentation(user, row))
      .map((row) => ({
        id: row.id,
        kind: "PRESENTATION" as const,
        title: row.title,
        notes: row.notesSummary,
        meetingAt: row.presentationAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        status: row.status,
        projectName: row.projectName,
        location: row.location,
        agency: null,
        customer: {
          id: row.customer.id,
          fullName: row.customer.fullName,
        },
        createdBy: row.createdBy,
        assignedSales: row.assignedSales,
      }));

    const merged = [...agencyItems, ...presentationItems].sort((a, b) => {
      return new Date(b.meetingAt).getTime() - new Date(a.meetingAt).getTime();
    });

    const total = merged.length;
    const start = (page - 1) * pageSize;
    const items = merged.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getMeeting(user: ReqUser, kind: MeetingKind, id: string) {
    if (!id) {
      throw new BadRequestException("Meeting id is required");
    }

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
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!row) {
        throw new NotFoundException("Meeting not found");
      }

      if (!this.canSeeAgencyMeeting(user, row)) {
        throw new ForbiddenException("No access");
      }

      return {
        id: row.id,
        kind: "AGENCY" as const,
        title: row.title,
        notes: row.notes,
        meetingAt: row.meetingAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        agency: row.agency,
        createdBy: row.createdBy,
      };
    }

    const row = await this.prisma.presentation.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            ownerId: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assignedSales: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException("Meeting not found");
    }

    if (!this.canSeePresentation(user, row)) {
      throw new ForbiddenException("No access");
    }

    return {
      id: row.id,
      kind: "PRESENTATION" as const,
      title: row.title,
      notes: row.notesSummary,
      meetingAt: row.presentationAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      status: row.status,
      projectName: row.projectName,
      location: row.location,
      customer: row.customer,
      createdBy: row.createdBy,
      assignedSales: row.assignedSales,
    };
  }

  async createMeeting(user: ReqUser, dto: CreateMeetingDto) {
    const kind = dto.kind;
    const title = this.cleanStr(dto.title);
    const notes = this.cleanStr(dto.notes);
    const meetingAt = this.parseDateOrThrow(dto.meetingAt);

    if (!kind) {
      throw new BadRequestException("kind is required");
    }

    if (!title) {
      throw new BadRequestException("title is required");
    }

    if (!meetingAt) {
      throw new BadRequestException("meetingAt is required");
    }

    if (kind === "AGENCY") {
      const agencyId = this.cleanStr(dto.agencyId);
      if (!agencyId) {
        throw new BadRequestException("agencyId is required");
      }

      const agency = await this.prisma.agency.findUnique({
        where: { id: agencyId },
        select: {
          id: true,
          name: true,
          assignedSalesId: true,
        },
      });

      if (!agency) {
        throw new NotFoundException("Agency not found");
      }

      if (!this.canCreateAgencyMeeting(user, agency)) {
        throw new ForbiddenException("No access to create agency meeting");
      }

      return this.prisma.agencyMeeting.create({
        data: {
          agencyId: agency.id,
          createdById: user.id,
          title,
          notes,
          meetingAt,
        },
        include: {
          agency: {
            select: {
              id: true,
              name: true,
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
    }

    const customerId = this.cleanStr(dto.customerId);
    const assignedSalesId = this.cleanStr(dto.assignedSalesId);
    const projectName = this.cleanStr(dto.projectName);
    const location = this.cleanStr(dto.location);

    if (!customerId) {
      throw new BadRequestException("customerId is required");
    }

    if (!assignedSalesId) {
      throw new BadRequestException("assignedSalesId is required");
    }

    const [customer, sales] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          fullName: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: assignedSalesId },
        select: {
          id: true,
          role: true,
          isActive: true,
        },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    if (!sales || !sales.isActive || sales.role !== "SALES") {
      throw new BadRequestException("Assigned sales is invalid");
    }

    if (!this.canCreatePresentation(user, assignedSalesId)) {
      throw new ForbiddenException("No access to create presentation");
    }

    return this.prisma.presentation.create({
      data: {
        customerId,
        createdById: user.id,
        assignedSalesId,
        title,
        projectName,
        presentationAt: meetingAt,
        location,
        notesSummary: notes,
      },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assignedSales: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }
}