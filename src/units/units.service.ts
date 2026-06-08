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

type ProjectType =
  | "LA_JOYA"
  | "LA_JOYA_PERLA"
  | "LA_JOYA_PERLA_II"
  | "LAGOON_VERDE";

type UnitDeliveryStatus = "NOT_READY" | "READY_TO_DELIVER" | "DELIVERED";
type UnitCompanyStatus = "UNKNOWN" | "DND" | "OTHER";

type UnitListQuery = {
  project?: string | null;
  deliveryStatus?: string | null;
  companyStatus?: string | null;
  q?: string | null;
};

@Injectable()
export class UnitsService {
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

  private isCallcenter(user: ReqUser) {
    return user.role === "CALLCENTER";
  }

  private isAftersales(user: ReqUser) {
    return user.role === "AFTERSALES";
  }

  private cleanStr(v?: string | null) {
    const x = (v ?? "").trim();
    return x || null;
  }

  private normalizeProject(v?: string | null): ProjectType | null {
    if (!v) return null;
    const value = String(v).trim().toUpperCase();
    const allowed: ProjectType[] = [
      "LA_JOYA",
      "LA_JOYA_PERLA",
      "LA_JOYA_PERLA_II",
      "LAGOON_VERDE",
    ];

    if (!allowed.includes(value as ProjectType)) {
      throw new BadRequestException("Invalid project");
    }

    return value as ProjectType;
  }

  private normalizeDeliveryStatus(v?: string | null): UnitDeliveryStatus | null {
    if (!v) return null;
    const value = String(v).trim().toUpperCase();

    if (
      value !== "NOT_READY" &&
      value !== "READY_TO_DELIVER" &&
      value !== "DELIVERED"
    ) {
      throw new BadRequestException("Invalid delivery status");
    }

    return value as UnitDeliveryStatus;
  }

  private normalizeCompanyStatus(v?: string | null): UnitCompanyStatus | null {
    if (!v) return null;
    const value = String(v).trim().toUpperCase();

    if (value !== "UNKNOWN" && value !== "DND" && value !== "OTHER") {
      throw new BadRequestException("Invalid company status");
    }

    return value as UnitCompanyStatus;
  }

  private canAccessUnit(
    user: ReqUser,
    unit: {
      customer?: {
        ownerId?: string | null;
        presentations?: Array<{ assignedSalesId?: string | null }>;
      } | null;
    },
  ) {
    if (this.isAdmin(user) || this.isManager(user) || this.isAftersales(user)) {
      return true;
    }

    if (this.isSales(user) || this.isCallcenter(user)) {
      const customer = unit.customer;
      return (
        customer?.ownerId === user.id ||
        (customer?.presentations || []).some(
          (presentation) => presentation.assignedSalesId === user.id,
        )
      );
    }

    return false;
  }

  private customerAccessWhere(user: ReqUser) {
    if (this.isAdmin(user) || this.isManager(user) || this.isAftersales(user)) {
      return null;
    }

    return {
      customer: {
        is: {
          OR: [
            { ownerId: user.id },
            { presentations: { some: { assignedSalesId: user.id } } },
          ],
        },
      },
    };
  }

  private unitInclude() {
    return {
      customer: {
        select: {
          id: true,
          fullName: true,
          companyName: true,
          phone: true,
          email: true,
          city: true,
          country: true,
          nationality: true,
          oldCustomerCode: true,
          oldCariCodes: true,
          ownerId: true,
          agency: {
            select: { id: true, name: true },
          },
          owner: {
            select: { id: true, name: true, email: true, role: true },
          },
          presentations: {
            select: { assignedSalesId: true },
          },
        },
      },
    };
  }

  private buildListWhere(user: ReqUser, query: UnitListQuery) {
    const where: any = {};
    const project = this.normalizeProject(query.project);
    const deliveryStatus = this.normalizeDeliveryStatus(query.deliveryStatus);
    const companyStatus = this.normalizeCompanyStatus(query.companyStatus);
    const q = this.cleanStr(query.q);
    const accessWhere = this.customerAccessWhere(user);

    if (project) where.project = project;
    if (deliveryStatus) where.deliveryStatus = deliveryStatus;
    if (companyStatus) where.companyStatus = companyStatus;

    if (q) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { unitNumber: { contains: q, mode: "insensitive" } },
          { customer: { is: { fullName: { contains: q, mode: "insensitive" } } } },
          { customer: { is: { companyName: { contains: q, mode: "insensitive" } } } },
          { customer: { is: { phone: { contains: q, mode: "insensitive" } } } },
          { customer: { is: { email: { contains: q, mode: "insensitive" } } } },
          {
            customer: {
              is: { oldCustomerCode: { contains: q, mode: "insensitive" } },
            },
          },
          {
            customer: {
              is: { oldCariCodes: { contains: q, mode: "insensitive" } },
            },
          },
        ],
      });
    }

    if (accessWhere) {
      where.AND = where.AND || [];
      where.AND.push(accessWhere);
    }

    return where;
  }

  private buildStats(
    items: Array<{
      project: string;
      deliveryStatus: string;
      companyStatus: string;
    }>,
  ) {
    const byProject = new Map<string, number>();
    const byDeliveryStatus = new Map<string, number>();
    const byCompanyStatus = new Map<string, number>();

    for (const item of items) {
      byProject.set(item.project, (byProject.get(item.project) || 0) + 1);
      byDeliveryStatus.set(
        item.deliveryStatus,
        (byDeliveryStatus.get(item.deliveryStatus) || 0) + 1,
      );
      byCompanyStatus.set(
        item.companyStatus,
        (byCompanyStatus.get(item.companyStatus) || 0) + 1,
      );
    }

    return {
      total: items.length,
      byProject: [...byProject.entries()]
        .map(([project, count]) => ({ project, count }))
        .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project)),
      byDeliveryStatus: [...byDeliveryStatus.entries()]
        .map(([deliveryStatus, count]) => ({ deliveryStatus, count }))
        .sort((a, b) => b.count - a.count || a.deliveryStatus.localeCompare(b.deliveryStatus)),
      byCompanyStatus: [...byCompanyStatus.entries()]
        .map(([companyStatus, count]) => ({ companyStatus, count }))
        .sort((a, b) => b.count - a.count || a.companyStatus.localeCompare(b.companyStatus)),
    };
  }

  async listUnits(user: ReqUser, query: UnitListQuery = {}) {
    const where = this.buildListWhere(user, query);

    const items = await this.prisma.customerUnitSelection.findMany({
      where,
      include: this.unitInclude(),
      orderBy: [{ project: "asc" }, { unitNumber: "asc" }, { createdAt: "asc" }],
      take: 5000,
    });

    return {
      items,
      stats: this.buildStats(items),
    };
  }

  async updateUnit(user: ReqUser, id: string, dto: any) {
    const unit = await this.prisma.customerUnitSelection.findUnique({
      where: { id },
      include: this.unitInclude(),
    });

    if (!unit) throw new NotFoundException("Unit not found");

    if (!this.canAccessUnit(user, unit)) {
      throw new ForbiddenException("No access to update unit");
    }

    const data: any = {};

    if (dto.deliveryStatus !== undefined) {
      data.deliveryStatus =
        this.normalizeDeliveryStatus(dto.deliveryStatus) || "NOT_READY";
    }

    if (dto.companyStatus !== undefined) {
      data.companyStatus =
        this.normalizeCompanyStatus(dto.companyStatus) || "UNKNOWN";
    }

    if (dto.generalInfo !== undefined) data.generalInfo = this.cleanStr(dto.generalInfo);
    if (dto.unitInfo !== undefined) data.unitInfo = this.cleanStr(dto.unitInfo);
    if (dto.customerRequest !== undefined) {
      data.customerRequest = this.cleanStr(dto.customerRequest);
    }
    if (dto.customerComplaint !== undefined) {
      data.customerComplaint = this.cleanStr(dto.customerComplaint);
    }
    if (dto.unitComplaint !== undefined) {
      data.unitComplaint = this.cleanStr(dto.unitComplaint);
    }

    return this.prisma.customerUnitSelection.update({
      where: { id },
      data,
      include: this.unitInclude(),
    });
  }
}
