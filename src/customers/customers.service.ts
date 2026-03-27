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

@Injectable()
export class CustomersService {
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

  private async getCustomerOrThrow(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { agency: true },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    return customer;
  }

  async listCustomers(user: ReqUser) {
    if (this.isAdmin(user) || this.isManager(user)) {
      return this.prisma.customer.findMany({
        include: {
          agency: true,
          _count: { select: { presentations: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    if (this.isSales(user)) {
      return this.prisma.customer.findMany({
        where: {
          OR: [
            { ownerId: user.id },
            {
              presentations: {
                some: { assignedSalesId: user.id },
              },
            },
          ],
        },
        include: {
          agency: true,
          _count: { select: { presentations: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    throw new ForbiddenException("No access");
  }

  async createCustomer(user: ReqUser, dto: any) {
    if (
      user.role !== "ADMIN" &&
      user.role !== "MANAGER" &&
      user.role !== "SALES"
    ) {
      throw new ForbiddenException("No access to create customer");
    }

    const fullName = dto.fullName?.trim();
    if (!fullName) {
      throw new BadRequestException("Customer name required");
    }

    let agencyId: string | null = dto.agencyId || null;

    if (agencyId) {
      const agency = await this.prisma.agency.findUnique({
        where: { id: agencyId },
        select: { id: true },
      });

      if (!agency) {
        throw new BadRequestException("Selected agency not found");
      }
    }

    return this.prisma.customer.create({
      data: {
        fullName,
        companyName: dto.companyName?.trim() || null,
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        city: dto.city?.trim() || null,
        country: dto.country?.trim() || null,
        address: dto.address?.trim() || null,
        source: dto.source?.trim() || null,
        notesSummary: dto.notesSummary?.trim() || null,
        type: dto.type || "POTENTIAL",
        agencyId,
        ownerId: dto.ownerId || user.id,
      },
      include: {
        agency: true,
        _count: { select: { presentations: true } },
      },
    });
  }

  async deleteCustomer(user: ReqUser, customerId: string) {
    if (!this.isAdmin(user) && !this.isManager(user)) {
      throw new ForbiddenException("No access to delete customer");
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    await this.prisma.$transaction(async (tx) => {
      const presentations = await tx.presentation.findMany({
        where: { customerId },
        select: { id: true },
      });

      const presentationIds = presentations.map((p) => p.id);

      if (presentationIds.length > 0) {
        await tx.presentationNote.deleteMany({
          where: {
            presentationId: { in: presentationIds },
          },
        });
      }

      await tx.presentation.deleteMany({
        where: { customerId },
      });

      await tx.customer.delete({
        where: { id: customerId },
      });
    });

    return { success: true };
  }

  async createPresentation(user: ReqUser, customerId: string, dto: any) {
    await this.getCustomerOrThrow(customerId);

    const title = dto.title?.trim();
    if (!title) {
      throw new BadRequestException("Title required");
    }

    if (!dto.presentationAt) {
      throw new BadRequestException("Date required");
    }

    const presentationAt = new Date(dto.presentationAt);
    if (Number.isNaN(presentationAt.getTime())) {
      throw new BadRequestException("Invalid presentationAt");
    }

    let assignedSalesId = dto.assignedSalesId;

    if (this.isSales(user)) {
      assignedSalesId = user.id;
    }

    if (!assignedSalesId) {
      throw new BadRequestException("Sales must be assigned");
    }

    const salesUser = await this.prisma.user.findUnique({
      where: { id: assignedSalesId },
      select: { id: true, role: true, isActive: true },
    });

    if (!salesUser || !salesUser.isActive || salesUser.role !== "SALES") {
      throw new BadRequestException("Assigned sales user is invalid");
    }

    return this.prisma.presentation.create({
      data: {
        customerId,
        title,
        projectName: dto.projectName?.trim() || null,
        presentationAt,
        location: dto.location?.trim() || null,
        notesSummary: dto.notesSummary?.trim() || null,
        createdById: user.id,
        assignedSalesId,
      },
      include: {
        assignedSales: true,
        createdBy: true,
      },
    });
  }

  async getCustomerDetail(user: ReqUser, customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        agency: true,
        presentations: {
          orderBy: { presentationAt: "desc" },
          include: {
            assignedSales: true,
            createdBy: true,
            notes: {
              include: { createdBy: true },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    if (this.isAdmin(user) || this.isManager(user)) {
      return customer;
    }

    if (this.isSales(user)) {
      const hasAccess =
        customer.ownerId === user.id ||
        customer.presentations.some((p) => p.assignedSalesId === user.id);

      if (!hasAccess) {
        throw new ForbiddenException("No access");
      }

      return customer;
    }

    throw new ForbiddenException("No access");
  }

  async addPresentationNote(user: ReqUser, presentationId: string, dto: any) {
    const note = dto.note?.trim();
    if (!note) {
      throw new BadRequestException("Note required");
    }

    const presentation = await this.prisma.presentation.findUnique({
      where: { id: presentationId },
      select: {
        id: true,
        assignedSalesId: true,
      },
    });

    if (!presentation) {
      throw new NotFoundException("Presentation not found");
    }

    const canEdit =
      this.isAdmin(user) ||
      this.isManager(user) ||
      presentation.assignedSalesId === user.id;

    if (!canEdit) {
      throw new ForbiddenException("No access");
    }

    return this.prisma.presentationNote.create({
      data: {
        presentationId,
        createdById: user.id,
        note,
      },
      include: {
        createdBy: true,
      },
    });
  }

  async updatePresentation(user: ReqUser, id: string, dto: any) {
    const presentation = await this.prisma.presentation.findUnique({
      where: { id },
    });

    if (!presentation) {
      throw new NotFoundException("Presentation not found");
    }

    const canEdit =
      this.isAdmin(user) ||
      this.isManager(user) ||
      presentation.assignedSalesId === user.id;

    if (!canEdit) {
      throw new ForbiddenException("No access");
    }

    const data: any = {};

    if (dto.title !== undefined) {
      const title = dto.title?.trim();
      if (!title) {
        throw new BadRequestException("Title required");
      }
      data.title = title;
    }

    if (dto.projectName !== undefined) {
      data.projectName = dto.projectName?.trim() || null;
    }

    if (dto.presentationAt !== undefined) {
      const presentationAt = new Date(dto.presentationAt);
      if (Number.isNaN(presentationAt.getTime())) {
        throw new BadRequestException("Invalid presentationAt");
      }
      data.presentationAt = presentationAt;
    }

    if (dto.location !== undefined) {
      data.location = dto.location?.trim() || null;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    if (dto.outcome !== undefined) {
      data.outcome = dto.outcome || null;
    }

    if (dto.notesSummary !== undefined) {
      data.notesSummary = dto.notesSummary?.trim() || null;
    }

    return this.prisma.presentation.update({
      where: { id },
      data,
      include: {
        assignedSales: true,
        createdBy: true,
      },
    });
  }
}