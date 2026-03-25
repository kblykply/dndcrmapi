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

    if (!customer) throw new NotFoundException("Customer not found");
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
          presentations: {
            some: { assignedSalesId: user.id },
          },
        },
        include: {
          agency: true,
          _count: { select: { presentations: true } },
        },
      });
    }

    throw new ForbiddenException("No access");
  }

  async createCustomer(user: ReqUser, dto: any) {
    if (!this.isManager(user) && !this.isAdmin(user)) {
      throw new ForbiddenException("Only manager can create customer");
    }

    if (!dto.fullName) {
      throw new BadRequestException("Customer name required");
    }

    return this.prisma.customer.create({
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email,
        city: dto.city,
        country: dto.country,
        agencyId: dto.agencyId || null,
        ownerId: user.id,
      },
    });
  }

  async createPresentation(user: ReqUser, customerId: string, dto: any) {
    const customer = await this.getCustomerOrThrow(customerId);

    if (!dto.title) throw new BadRequestException("Title required");
    if (!dto.presentationAt) throw new BadRequestException("Date required");

    let assignedSalesId = dto.assignedSalesId;

    if (this.isSales(user)) {
      // sales can only assign themselves
      assignedSalesId = user.id;
    }

    if (!assignedSalesId) {
      throw new BadRequestException("Sales must be assigned");
    }

    return this.prisma.presentation.create({
      data: {
        customerId,
        title: dto.title,
        projectName: dto.projectName,
        presentationAt: new Date(dto.presentationAt),
        location: dto.location,
        notesSummary: dto.notesSummary,
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
    return this.prisma.customer.findUnique({
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
            },
          },
        },
      },
    });
  }

  async addPresentationNote(user: ReqUser, presentationId: string, dto: any) {
    if (!dto.note) throw new BadRequestException("Note required");

    return this.prisma.presentationNote.create({
      data: {
        presentationId,
        createdById: user.id,
        note: dto.note,
      },
    });
  }

  async updatePresentation(user: ReqUser, id: string, dto: any) {
    const presentation = await this.prisma.presentation.findUnique({
      where: { id },
    });

    if (!presentation) throw new NotFoundException("Presentation not found");

    const canEdit =
      this.isAdmin(user) ||
      this.isManager(user) ||
      presentation.assignedSalesId === user.id;

    if (!canEdit) throw new ForbiddenException("No access");

    return this.prisma.presentation.update({
      where: { id },
      data: {
        title: dto.title,
        projectName: dto.projectName,
        presentationAt: dto.presentationAt
          ? new Date(dto.presentationAt)
          : undefined,
        status: dto.status,
        outcome: dto.outcome,
        notesSummary: dto.notesSummary,
      },
    });
  }
}