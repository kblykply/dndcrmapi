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

const EMAIL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const EMAIL_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const EMAIL_ATTACHMENT_EXTENSIONS = new Set([
  "pdf",
  "txt",
  "csv",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
]);

const unitNumberCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});
const DND_COMPANY_CUSTOMER_ID = "dnd-company-owner";
const DND_COMPANY_CUSTOMER_CODE = "DND_COMPANY_OWNER";

const UNIT_CHANGE_META = {
  deliveryStatus: { section: "UNIT_INFORMATION" },
  companyStatus: { section: "UNIT_INFORMATION" },
  unitInfo: { section: "UNIT_INFORMATION" },
  unitComplaint: { section: "UNIT_INFORMATION" },
  isCanceled: { section: "ADMIN" },
  cancelReason: { section: "ADMIN" },
  customerId: { section: "ADMIN" },
  previousCustomerId: { section: "ADMIN" },
  kdvStatus: { section: "ACCOUNTING" },
  trafoStatus: { section: "ACCOUNTING" },
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

  private async ensureDndCompanyCustomer(client: any = this.prisma) {
    return client.customer.upsert({
      where: { oldCustomerCode: DND_COMPANY_CUSTOMER_CODE },
      update: {
        fullName: "DND Cyprus",
        companyName: "DND Cyprus",
        type: "EXISTING",
        notesSummary: "System customer used as the owner of canceled units.",
      },
      create: {
        id: DND_COMPANY_CUSTOMER_ID,
        fullName: "DND Cyprus",
        companyName: "DND Cyprus",
        source: "SYSTEM",
        type: "EXISTING",
        notesSummary: "System customer used as the owner of canceled units.",
        oldCustomerCode: DND_COMPANY_CUSTOMER_CODE,
      },
      select: {
        id: true,
        fullName: true,
        companyName: true,
      },
    });
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

  private normalizeEmailAttachment(file?: Express.Multer.File) {
    if (!file) return null;

    if (!file.buffer?.length) {
      throw new BadRequestException("Attachment file is empty");
    }

    if (file.size > EMAIL_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException("Attachment must be 10MB or smaller");
    }

    const filename =
      this.cleanStr(file.originalname)?.replace(/[\\/]/g, "-") || "attachment";
    const extension = filename.includes(".")
      ? filename.split(".").pop()?.toLowerCase()
      : null;
    const contentType = this.cleanStr(file.mimetype) || "application/octet-stream";

    if (
      !EMAIL_ATTACHMENT_MIME_TYPES.has(contentType) &&
      (!extension || !EMAIL_ATTACHMENT_EXTENSIONS.has(extension))
    ) {
      throw new BadRequestException("Unsupported attachment file type");
    }

    return {
      filename,
      content: file.buffer,
      contentType,
    };
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
      previousCustomer: {
        select: {
          id: true,
          fullName: true,
          companyName: true,
          phone: true,
          email: true,
          oldCustomerCode: true,
          oldCariCodes: true,
        },
      },
    };
  }

  private unitDetailInclude(logVisibility: "all" | "communication" | "none" = "all"): any {
    const include: any = {
      ...this.unitInclude(),
      canceledBy: {
        select: { id: true, name: true, email: true, role: true },
      },
    };

    if (logVisibility !== "none") {
      include.logs = {
        ...(logVisibility === "communication"
          ? { where: { section: "COMMUNICATION" } }
          : {}),
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

  private unitLogVisibility(user: ReqUser): "all" | "communication" {
    return this.isAdmin(user) ? "all" : "communication";
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

  private async notifyUnitCanceled(actor: ReqUser, unit: any) {
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
      recipients.map((user) => user.id).filter((id) => id !== actor.id),
      {
        type: "SYSTEM",
        title: "Unit canceled",
        message: `${unit.unitNumber} has been marked as canceled.`,
        entityType: "UNIT",
        entityId: unit.id,
        link: `/units/${unit.id}`,
        metaJson: {
          actorId: actor.id,
          project: unit.project,
          unitNumber: unit.unitNumber,
          customerId: unit.customerId,
          cancelReason: unit.cancelReason,
        },
      },
    );
  }

  private normalizeReportDate(value?: string | null) {
    const date = this.cleanStr(value);
    if (!date) return null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("Report date must be YYYY-MM-DD");
    }

    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("Invalid report date");
    }

    return date;
  }

  private buildReportRange(range?: {
    date?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
  }) {
    const today = new Date().toISOString().slice(0, 10);
    const legacyDate = this.normalizeReportDate(range?.date);
    const dateFrom =
      this.normalizeReportDate(range?.dateFrom) || legacyDate || today;
    const dateTo = this.normalizeReportDate(range?.dateTo) || legacyDate || dateFrom;

    if (dateFrom > dateTo) {
      throw new BadRequestException("Report start date cannot be after end date");
    }

    const start = new Date(`${dateFrom}T00:00:00.000Z`);
    const end = new Date(`${dateTo}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);

    return { dateFrom, dateTo, start, end };
  }

  private buildListWhere(user: ReqUser, query: UnitListQuery) {
    const where: any = {};
    const project = this.normalizeProject(query.project);
    const deliveryStatus = this.normalizeDeliveryStatus(query.deliveryStatus);
    const companyStatus = this.normalizeCompanyStatus(query.companyStatus);
    const q = this.cleanStr(query.q);
    const accessWhere = this.customerAccessWhere(user);

    where.AND = [{ customer: { is: { type: "EXISTING" } } }];

    if (project) where.project = project;
    if (deliveryStatus) where.deliveryStatus = deliveryStatus;
    if (companyStatus) where.companyStatus = companyStatus;

    if (q) {
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
      include: this.unitDetailInclude(this.unitLogVisibility(user)),
    });

    if (!unit) throw new NotFoundException("Unit not found");

    if (!this.canAccessUnit(user, unit)) {
      throw new ForbiddenException("No access to unit");
    }

    return unit;
  }

  async deleteUnit(user: ReqUser, id: string) {
    if (!this.isAdmin(user)) {
      throw new ForbiddenException("Only admin can delete units");
    }

    const unit = await this.prisma.customerUnitSelection.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!unit) throw new NotFoundException("Unit not found");

    await this.prisma.customerUnitSelection.delete({
      where: { id },
    });

    return { ok: true, id };
  }

  async endOfDayReport(
    user: ReqUser,
    range?: { date?: string | null; dateFrom?: string | null; dateTo?: string | null },
  ) {
    if (!this.isAdmin(user) && !this.isManager(user) && !this.isAftersales(user)) {
      throw new ForbiddenException("No access to unit reports");
    }

    const { dateFrom, dateTo, start, end } = this.buildReportRange(range);

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
      take: 5000,
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
      date: dateFrom,
      dateFrom,
      dateTo,
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
    file?: Express.Multer.File,
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

    const attachment = this.normalizeEmailAttachment(file);

    await this.email.sendMail({
      to,
      subject,
      text: message,
      replyTo: user.email,
      attachments: attachment ? [attachment] : undefined,
    });

    await this.prisma.customerUnitSelectionLog.create({
      data: {
        unitSelectionId: id,
        section: "COMMUNICATION",
        field: "EMAIL",
        oldValue: null,
        newValue: `Subject: ${subject}${
          attachment ? `\nAttachment: ${attachment.filename}` : ""
        }\n\n${message}`,
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
      if (nextCanceled) {
        const dndCustomer = await this.ensureDndCompanyCustomer();

        if (unit.customerId !== dndCustomer.id) {
          const existingDndUnit =
            await this.prisma.customerUnitSelection.findFirst({
              where: {
                id: { not: id },
                customerId: dndCustomer.id,
                project: unit.project,
                unitNumber: unit.unitNumber,
              },
              select: { id: true },
            });

          if (existingDndUnit) {
            throw new BadRequestException(
              "DND already owns this project and unit number",
            );
          }

          data.previousCustomerId = unit.previousCustomerId || unit.customerId;
          data.customerId = dndCustomer.id;
        }
      } else if (unit.previousCustomerId) {
        const existingPreviousOwnerUnit =
          await this.prisma.customerUnitSelection.findFirst({
            where: {
              id: { not: id },
              customerId: unit.previousCustomerId,
              project: unit.project,
              unitNumber: unit.unitNumber,
            },
            select: { id: true },
          });

        if (existingPreviousOwnerUnit) {
          throw new BadRequestException(
            "Previous owner already has this project and unit number",
          );
        }

        data.customerId = unit.previousCustomerId;
        data.previousCustomerId = null;
      }
    }

    if (dto.kdvStatus !== undefined) {
      data.kdvStatus = this.normalizePaymentStatus(dto.kdvStatus);
    }

    if (dto.trafoStatus !== undefined) {
      data.trafoStatus = this.normalizePaymentStatus(dto.trafoStatus);
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
    const shouldNotifyCancellation =
      unit.isCanceled !== true && data.isCanceled === true;

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
        include: this.unitDetailInclude(this.unitLogVisibility(user)),
      });
    });

    if (shouldNotifyDelivery && updated) {
      await this.notifyUnitDelivered(user, updated);
    }

    if (shouldNotifyCancellation && updated) {
      await this.notifyUnitCanceled(user, updated);
    }

    return updated;
  }
}
