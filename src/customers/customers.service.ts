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

  private cleanStr(v?: string | null) {
    const x = (v ?? "").trim();
    return x || null;
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

  private salesOwnsCustomer(
    user: ReqUser,
    customer: {
      ownerId?: string | null;
      presentations?: Array<{ assignedSalesId?: string | null }>;
    },
  ) {
    if (!this.isSales(user)) return false;

    return (
      customer.ownerId === user.id ||
      (customer.presentations || []).some(
        (p) => p.assignedSalesId === user.id,
      )
    );
  }

  private canEditCustomer(
    user: ReqUser,
    customer: {
      ownerId?: string | null;
      presentations?: Array<{ assignedSalesId?: string | null }>;
    },
  ) {
    if (this.isAdmin(user) || this.isManager(user)) return true;
    if (this.isSales(user)) return this.salesOwnsCustomer(user, customer);
    return false;
  }

  private maskCustomerForSales(customer: any, canSeeContact: boolean) {
    if (canSeeContact) {
      return {
        ...customer,
        canSeeContactDetails: true,
        canEdit: true,
      };
    }

    return {
      ...customer,
      phone: null,
      email: null,
      address: null,
      notesSummary: null,
      canSeeContactDetails: false,
      canEdit: false,
    };
  }

  async listCustomers(user: ReqUser) {
    const customers = await this.prisma.customer.findMany({
      include: {
        agency: true,
        owner: {
          select: { id: true, name: true, email: true },
        },
        presentations: {
          select: {
            assignedSalesId: true,
          },
        },
        _count: { select: { presentations: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (this.isAdmin(user) || this.isManager(user)) {
      return customers.map((customer) => ({
        ...customer,
        canSeeContactDetails: true,
        canEdit: true,
      }));
    }

    if (this.isSales(user)) {
      return customers.map((customer) => {
        const canSeeContact = this.salesOwnsCustomer(user, customer);
        return this.maskCustomerForSales(customer, canSeeContact);
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

    let ownerId: string;

    if (this.isSales(user)) {
      ownerId = user.id;
    } else {
      ownerId = dto.ownerId || user.id;

      if (dto.ownerId) {
        const ownerUser = await this.prisma.user.findUnique({
          where: { id: dto.ownerId },
          select: { id: true, role: true, isActive: true },
        });

        if (!ownerUser || !ownerUser.isActive) {
          throw new BadRequestException("Selected owner user not found");
        }

        if (ownerUser.role !== "SALES") {
          throw new BadRequestException(
            "Selected owner must be an active SALES user",
          );
        }
      }
    }

    return this.prisma.customer.create({
      data: {
        fullName,
        companyName: this.cleanStr(dto.companyName),
        phone: this.cleanStr(dto.phone),
        email: this.cleanStr(dto.email),
        city: this.cleanStr(dto.city),
        country: this.cleanStr(dto.country),
        address: this.cleanStr(dto.address),
        source: this.cleanStr(dto.source),
        notesSummary: this.cleanStr(dto.notesSummary),
        type: dto.type || "POTENTIAL",
        agencyId,
        ownerId,
      },
      include: {
        agency: true,
        owner: {
          select: { id: true, name: true, email: true },
        },
        _count: { select: { presentations: true } },
      },
    });
  }

  async updateCustomer(user: ReqUser, customerId: string, dto: any) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        presentations: {
          select: {
            assignedSalesId: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    if (!this.canEditCustomer(user, customer)) {
      throw new ForbiddenException("No access to update customer");
    }

    const data: any = {};

    if (dto.fullName !== undefined) {
      const fullName = dto.fullName?.trim();
      if (!fullName) {
        throw new BadRequestException("Customer name required");
      }
      data.fullName = fullName;
    }

    if (dto.companyName !== undefined) {
      data.companyName = this.cleanStr(dto.companyName);
    }

    if (dto.phone !== undefined) {
      data.phone = this.cleanStr(dto.phone);
    }

    if (dto.email !== undefined) {
      data.email = this.cleanStr(dto.email);
    }

    if (dto.city !== undefined) {
      data.city = this.cleanStr(dto.city);
    }

    if (dto.country !== undefined) {
      data.country = this.cleanStr(dto.country);
    }

    if (dto.address !== undefined) {
      data.address = this.cleanStr(dto.address);
    }

    if (dto.source !== undefined) {
      data.source = this.cleanStr(dto.source);
    }

    if (dto.notesSummary !== undefined) {
      data.notesSummary = this.cleanStr(dto.notesSummary);
    }

    if (dto.type !== undefined) {
      data.type = dto.type;
    }

    if (dto.agencyId !== undefined) {
      const agencyId = dto.agencyId || null;

      if (agencyId) {
        const agency = await this.prisma.agency.findUnique({
          where: { id: agencyId },
          select: { id: true },
        });

        if (!agency) {
          throw new BadRequestException("Selected agency not found");
        }
      }

      data.agencyId = agencyId;
    }

    if (dto.ownerId !== undefined) {
      if (!this.isAdmin(user) && !this.isManager(user)) {
        throw new ForbiddenException("Only manager or admin can change owner");
      }

      const ownerId = dto.ownerId || null;

      if (ownerId) {
        const ownerUser = await this.prisma.user.findUnique({
          where: { id: ownerId },
          select: { id: true, role: true, isActive: true },
        });

        if (!ownerUser || !ownerUser.isActive) {
          throw new BadRequestException("Selected owner user not found");
        }

        if (ownerUser.role !== "SALES") {
          throw new BadRequestException(
            "Selected owner must be an active SALES user",
          );
        }
      }

      data.ownerId = ownerId;
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data,
      include: {
        agency: true,
        owner: {
          select: { id: true, name: true, email: true },
        },
        presentations: {
          select: {
            assignedSalesId: true,
          },
        },
        _count: { select: { presentations: true } },
      },
    });

    if (this.isAdmin(user) || this.isManager(user)) {
      return {
        ...updated,
        canSeeContactDetails: true,
        canEdit: true,
      };
    }

    if (this.isSales(user)) {
      const canSeeContact = this.salesOwnsCustomer(user, updated);
      return this.maskCustomerForSales(updated, canSeeContact);
    }

    throw new ForbiddenException("No access");
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
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        presentations: {
          select: {
            assignedSalesId: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    const canEdit =
      this.isAdmin(user) ||
      this.isManager(user) ||
      this.salesOwnsCustomer(user, customer);

    if (!canEdit) {
      throw new ForbiddenException("No access");
    }

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
        projectName: this.cleanStr(dto.projectName),
        presentationAt,
        location: this.cleanStr(dto.location),
        notesSummary: this.cleanStr(dto.notesSummary),
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
        owner: {
          select: { id: true, name: true, email: true },
        },
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
      return {
        ...customer,
        canSeeContactDetails: true,
        canEdit: true,
      };
    }

    if (this.isSales(user)) {
      const canSeeContact = this.salesOwnsCustomer(user, customer);
      return this.maskCustomerForSales(customer, canSeeContact);
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
      data.projectName = this.cleanStr(dto.projectName);
    }

    if (dto.presentationAt !== undefined) {
      const presentationAt = new Date(dto.presentationAt);
      if (Number.isNaN(presentationAt.getTime())) {
        throw new BadRequestException("Invalid presentationAt");
      }
      data.presentationAt = presentationAt;
    }

    if (dto.location !== undefined) {
      data.location = this.cleanStr(dto.location);
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    if (dto.outcome !== undefined) {
      data.outcome = dto.outcome || null;
    }

    if (dto.notesSummary !== undefined) {
      data.notesSummary = this.cleanStr(dto.notesSummary);
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