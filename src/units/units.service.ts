import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailService } from "../email/email.service";
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
type PaymentStatus = "UNPAID" | "PAID";
type ElectricityProvider = "UNKNOWN" | "TIPTEK" | "DND";
type WaterAccessStatus = "UNKNOWN" | "ON" | "OFF";
type RentalPackage = "FULL_FURNISHED" | "NOT_INTERESTED" | "CUSTOM";
type RentalStatus = "SHORT_TERM" | "LONG_TERM" | "DND_UNITS" | "NOT_INTERESTED";
type CommunicationType = "EMAIL" | "WHATSAPP";

const unitNumberCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

const UNIT_CHANGE_META = {
  deliveryStatus: { section: "UNIT_INFORMATION" },
  companyStatus: { section: "UNIT_INFORMATION" },
  unitInfo: { section: "UNIT_INFORMATION" },
  unitComplaint: { section: "UNIT_INFORMATION" },
  isCanceled: { section: "ADMIN" },
  cancelReason: { section: "ADMIN" },
  kdvStatus: { section: "ACCOUNTING" },
  trafoStatus: { section: "ACCOUNTING" },
  installments: { section: "ACCOUNTING" },
  electricityProvider: { section: "UTILITY" },
  waterAccessStatus: { section: "UTILITY" },
  rentalPackage: { section: "RENTAL" },
  customFurniture: { section: "RENTAL" },
  rentalStatus: { section: "RENTAL" },
  generalInfo: { section: "CUSTOMER_RECORDS" },
  customerRequest: { section: "CUSTOMER_RECORDS" },
  customerComplaint: { section: "CUSTOMER_RECORDS" },
} as const;

type UnitChangeField = keyof typeof UNIT_CHANGE_META;

type UnitListQuery = {
  project?: string | null;
  deliveryStatus?: string | null;
  companyStatus?: string | null;
  q?: string | null;
};

@Injectable()
export class UnitsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private email: EmailService,
  ) {}

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

  private normalizePaymentStatus(v?: string | null): PaymentStatus {
    const value = String(v || "UNPAID").trim().toUpperCase();
    if (value !== "PAID" && value !== "UNPAID") {
      throw new BadRequestException("Invalid payment status");
    }
    return value as PaymentStatus;
  }

  private normalizeElectricityProvider(v?: string | null): ElectricityProvider {
    const value = String(v || "UNKNOWN").trim().toUpperCase();
    if (value !== "UNKNOWN" && value !== "TIPTEK" && value !== "DND") {
      throw new BadRequestException("Invalid electricity provider");
    }
    return value as ElectricityProvider;
  }

  private normalizeWaterAccessStatus(v?: string | null): WaterAccessStatus {
    const value = String(v || "UNKNOWN").trim().toUpperCase();
    if (value !== "UNKNOWN" && value !== "ON" && value !== "OFF") {
      throw new BadRequestException("Invalid water access status");
    }
    return value as WaterAccessStatus;
  }

  private normalizeRentalPackage(v?: string | null): RentalPackage {
    const value = String(v || "NOT_INTERESTED").trim().toUpperCase();
    if (
      value !== "FULL_FURNISHED" &&
      value !== "NOT_INTERESTED" &&
      value !== "CUSTOM"
    ) {
      throw new BadRequestException("Invalid rental package");
    }
    return value as RentalPackage;
  }

  private normalizeRentalStatus(v?: string | null): RentalStatus {
    const value = String(v || "NOT_INTERESTED").trim().toUpperCase();
    if (
      value !== "SHORT_TERM" &&
      value !== "LONG_TERM" &&
      value !== "DND_UNITS" &&
      value !== "NOT_INTERESTED"
    ) {
      throw new BadRequestException("Invalid rental status");
    }
    return value as RentalStatus;
  }

  private normalizeInstallments(value: any) {
    if (value === null) return null;
    if (!Array.isArray(value)) {
      throw new BadRequestException("Installments must be a list");
    }

    return value.slice(0, 200).map((row, index) => {
      const type = String(row?.type || "INSTALLMENT").trim().toUpperCase();
      const normalizedType =
        type === "DEPOSIT" || type === "AIDAT" ? type : "INSTALLMENT";
      const amount =
        row?.amount === null || row?.amount === undefined || row?.amount === ""
          ? null
          : Number(row.amount);

      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        throw new BadRequestException("Invalid installment amount");
      }

      return {
        id: this.cleanStr(row?.id) || `installment-${Date.now()}-${index}`,
        type: normalizedType,
        title:
          this.cleanStr(row?.title) ||
          (normalizedType === "DEPOSIT"
            ? "Deposit"
            : normalizedType === "AIDAT"
              ? "Aidat"
              : `Installment ${index + 1}`),
        amount,
        dueDate: this.cleanStr(row?.dueDate),
        status: this.normalizePaymentStatus(row?.status),
        paidAt: this.cleanStr(row?.paidAt),
        note: this.cleanStr(row?.note),
      };
    });
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

  private unitDetailInclude(includeLogs = true): any {
    const include: any = {
      ...this.unitInclude(),
      canceledBy: {
        select: { id: true, name: true, email: true, role: true },
      },
    };

    if (includeLogs) {
      include.logs = {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        orderBy: { createdAt: "desc" },
      };
    }

    return include;
  }

  private logValue(value: unknown) {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  private async notifyUnitDelivered(actor: ReqUser, unit: any) {
    const recipients = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: "MANAGER" },
          { role: "AFTERSALES" },
          ...(unit.customer?.ownerId ? [{ id: unit.customer.ownerId }] : []),
        ],
      },
      select: { id: true },
    });

    await this.notifications.createManyForUsers(
      recipients.map((user) => user.id),
      {
        type: "SYSTEM",
        title: "Unit delivered",
        message: `${unit.unitNumber} has been delivered to the owner.`,
        entityType: "UNIT",
        entityId: unit.id,
        link: `/units/${unit.id}`,
        metaJson: {
          actorId: actor.id,
          project: unit.project,
          unitNumber: unit.unitNumber,
          customerId: unit.customerId,
        },
      },
    );
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

    items.sort(
      (a, b) =>
        a.project.localeCompare(b.project) ||
        unitNumberCollator.compare(a.unitNumber, b.unitNumber) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );

    return {
      items,
      stats: this.buildStats(items),
    };
  }

  async getUnit(user: ReqUser, id: string) {
    const unit = await this.prisma.customerUnitSelection.findUnique({
      where: { id },
      include: this.unitDetailInclude(this.isAdmin(user)),
    });

    if (!unit) throw new NotFoundException("Unit not found");

    if (!this.canAccessUnit(user, unit)) {
      throw new ForbiddenException("No access to unit");
    }

    return unit;
  }

  async endOfDayReport(user: ReqUser, date?: string | null) {
    if (!this.isAdmin(user) && !this.isManager(user) && !this.isAftersales(user)) {
      throw new ForbiddenException("No access to unit reports");
    }

    const day = this.cleanStr(date) || new Date().toISOString().slice(0, 10);
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const logs = await this.prisma.customerUnitSelectionLog.findMany({
      where: {
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        unitSelection: {
          include: {
            customer: {
              select: { id: true, fullName: true, phone: true, email: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const byUser = new Map<string, { user: any; count: number }>();

    for (const log of logs) {
      const userId = log.createdBy?.id || "system";
      const current = byUser.get(userId) || {
        user: log.createdBy || null,
        count: 0,
      };
      current.count += 1;
      byUser.set(userId, current);
    }

    return {
      date: day,
      total: logs.length,
      byUser: [...byUser.values()].sort((a, b) => b.count - a.count),
      items: logs.map((log) => ({
        id: log.id,
        section: log.section,
        field: log.field,
        oldValue: log.oldValue,
        newValue: log.newValue,
        createdAt: log.createdAt,
        createdBy: log.createdBy,
        unit: {
          id: log.unitSelection.id,
          project: log.unitSelection.project,
          unitNumber: log.unitSelection.unitNumber,
          customer: log.unitSelection.customer,
        },
      })),
    };
  }

  async recordCommunication(
    user: ReqUser,
    id: string,
    dto: { type?: string | null; message?: string | null },
  ) {
    const unit = await this.prisma.customerUnitSelection.findUnique({
      where: { id },
      include: this.unitInclude(),
    });

    if (!unit) throw new NotFoundException("Unit not found");

    if (!this.canAccessUnit(user, unit)) {
      throw new ForbiddenException("No access to unit");
    }

    const type = String(dto.type || "").trim().toUpperCase();
    if (type !== "EMAIL" && type !== "WHATSAPP") {
      throw new BadRequestException("Invalid communication type");
    }

    const message = this.cleanStr(dto.message);
    if (!message) {
      throw new BadRequestException("Message is required");
    }

    await this.prisma.customerUnitSelectionLog.create({
      data: {
        unitSelectionId: id,
        section: "COMMUNICATION",
        field: type as CommunicationType,
        oldValue: null,
        newValue: message,
        createdById: user.id,
      },
    });

    return this.getUnit(user, id);
  }

  async sendUnitEmail(
    user: ReqUser,
    id: string,
    dto: { subject?: string | null; message?: string | null },
  ) {
    const unit = await this.prisma.customerUnitSelection.findUnique({
      where: { id },
      include: this.unitInclude(),
    });

    if (!unit) throw new NotFoundException("Unit not found");

    if (!this.canAccessUnit(user, unit)) {
      throw new ForbiddenException("No access to unit");
    }

    const to = this.cleanStr(unit.customer?.email);
    const message = this.cleanStr(dto.message);
    const subject =
      this.cleanStr(dto.subject) || `${unit.unitNumber} - ${unit.customer.fullName}`;

    if (!to) {
      throw new BadRequestException("Customer email is missing");
    }

    if (!message) {
      throw new BadRequestException("Message is required");
    }

    await this.email.sendMail({
      to,
      subject,
      text: message,
      replyTo: user.email,
    });

    await this.prisma.customerUnitSelectionLog.create({
      data: {
        unitSelectionId: id,
        section: "COMMUNICATION",
        field: "EMAIL",
        oldValue: null,
        newValue: `Subject: ${subject}\n\n${message}`,
        createdById: user.id,
      },
    });

    return this.getUnit(user, id);
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

    if (
      dto.isCanceled !== undefined ||
      dto.cancelReason !== undefined
    ) {
      if (!this.isAdmin(user)) {
        throw new ForbiddenException("Only admin can cancel units");
      }

      const nextCanceled =
        dto.isCanceled !== undefined ? Boolean(dto.isCanceled) : unit.isCanceled;
      data.isCanceled = nextCanceled;
      data.cancelReason = this.cleanStr(dto.cancelReason);
      data.canceledAt = nextCanceled ? unit.canceledAt || new Date() : null;
      data.canceledById = nextCanceled ? user.id : null;
    }

    if (dto.kdvStatus !== undefined) {
      data.kdvStatus = this.normalizePaymentStatus(dto.kdvStatus);
    }

    if (dto.trafoStatus !== undefined) {
      data.trafoStatus = this.normalizePaymentStatus(dto.trafoStatus);
    }

    if (dto.installments !== undefined) {
      data.installments = this.normalizeInstallments(dto.installments);
    }

    if (dto.electricityProvider !== undefined) {
      data.electricityProvider = this.normalizeElectricityProvider(
        dto.electricityProvider,
      );
    }

    if (dto.waterAccessStatus !== undefined) {
      data.waterAccessStatus = this.normalizeWaterAccessStatus(
        dto.waterAccessStatus,
      );
    }

    if (dto.rentalPackage !== undefined) {
      data.rentalPackage = this.normalizeRentalPackage(dto.rentalPackage);
    }

    if (dto.customFurniture !== undefined) {
      data.customFurniture = this.cleanStr(dto.customFurniture);
    }

    if (dto.rentalStatus !== undefined) {
      data.rentalStatus = this.normalizeRentalStatus(dto.rentalStatus);
    }

    const changes = (Object.keys(UNIT_CHANGE_META) as UnitChangeField[])
      .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
      .map((field) => ({
        field,
        section: UNIT_CHANGE_META[field].section,
        oldValue: this.logValue(unit[field]),
        newValue: this.logValue(data[field]),
      }))
      .filter((change) => change.oldValue !== change.newValue);

    if (changes.length === 0) {
      return this.getUnit(user, id);
    }

    const shouldNotifyDelivery =
      unit.deliveryStatus !== "DELIVERED" && data.deliveryStatus === "DELIVERED";

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customerUnitSelection.update({
        where: { id },
        data,
      });

      if (changes.length > 0) {
        await tx.customerUnitSelectionLog.createMany({
          data: changes.map((change) => ({
            unitSelectionId: id,
            section: change.section,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            createdById: user.id,
          })),
        });
      }

      return tx.customerUnitSelection.findUnique({
        where: { id },
        include: this.unitDetailInclude(this.isAdmin(user)),
      });
    });

    if (shouldNotifyDelivery && updated) {
      await this.notifyUnitDelivered(user, updated);
    }

    return updated;
  }
}
