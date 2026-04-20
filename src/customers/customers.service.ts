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

type Gender = "MALE" | "FEMALE" | "OTHER";
type ProjectType =
  | "LA_JOYA"
  | "LA_JOYA_PERLA"
  | "LA_JOYA_PERLA_II"
  | "LAGOON_VERDE";

type CustomerDocumentType = "ID" | "PASSPORT" | "OTHER";

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

  private parseDateOrNull(v?: string | null) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException("Invalid date");
    }
    return d;
  }

  private normalizeGender(v?: string | null): Gender | null {
    if (!v) return null;
    const value = String(v).trim().toUpperCase();
    if (value !== "MALE" && value !== "FEMALE" && value !== "OTHER") {
      throw new BadRequestException("Invalid gender");
    }
    return value as Gender;
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

  private normalizeDocumentType(v?: string | null): CustomerDocumentType {
    if (!v) return "OTHER";
    const value = String(v).trim().toUpperCase();
    if (value !== "ID" && value !== "PASSPORT" && value !== "OTHER") {
      throw new BadRequestException("Invalid document type");
    }
    return value as CustomerDocumentType;
  }

  private normalizeUnitSelections(input: any): Array<{
    project: ProjectType;
    unitNumber: string;
  }> {
    if (!Array.isArray(input)) return [];

    const normalized = input
      .map((row) => ({
        project: this.normalizeProject(row?.project),
        unitNumber: this.cleanStr(row?.unitNumber),
      }))
      .filter((row) => row.project && row.unitNumber) as Array<{
      project: ProjectType;
      unitNumber: string;
    }>;

    const seen = new Set<string>();
    const deduped: Array<{ project: ProjectType; unitNumber: string }> = [];

    for (const row of normalized) {
      const key = `${row.project}__${row.unitNumber.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }

    return deduped;
  }



async uploadCustomerDocument(
  user: ReqUser,
  customerId: string,
  file: Express.Multer.File,
  body: { type?: "ID" | "PASSPORT" | "OTHER" },
) {
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
    throw new ForbiddenException("No access to upload customer document");
  }

  if (!file?.buffer) {
    throw new BadRequestException("Uploaded file buffer is missing");
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!bucket) {
    throw new BadRequestException("SUPABASE_STORAGE_BUCKET is not configured");
  }

  const ext =
    file.originalname.includes(".")
      ? file.originalname.substring(file.originalname.lastIndexOf("."))
      : "";

  const safeBaseName = file.originalname
    .replace(ext, "")
    .replace(/[^a-zA-Z0-9-_]/g, "_");

  const storagePath = `customers/${customerId}/${Date.now()}-${safeBaseName}${ext}`;

const { supabaseAdmin } = await import("../lib/supabase-admin.js");

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) {
    throw new BadRequestException(error.message);
  }

  return this.prisma.customerDocument.create({
    data: {
      customerId,
type: this.normalizeDocumentType(body?.type),
      fileName: file.originalname,
      storagePath,
      mimeType: file.mimetype || null,
    },
  });
}






  private async getCustomerOrThrow(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
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
        unitSelections: {
          orderBy: [{ project: "asc" }, { unitNumber: "asc" }],
        },
        documents: {
          orderBy: { createdAt: "desc" },
        },
      },
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
      (customer.presentations || []).some((p) => p.assignedSalesId === user.id)
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
      birthday: null,
      nationality: null,
      language: null,
      job: null,
      idDocumentUrl: null,
      idDocumentName: null,
      documents: [],
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
        unitSelections: {
          orderBy: [{ project: "asc" }, { unitNumber: "asc" }],
        },
        documents: {
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: {
            presentations: true,
            documents: true,
            unitSelections: true,
          },
        },
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

    const fullName = this.cleanStr(dto.fullName);
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

    const birthday = this.parseDateOrNull(dto.birthday);
    const gender = this.normalizeGender(dto.gender);
    const project = this.normalizeProject(dto.project);
    const unitSelections = this.normalizeUnitSelections(dto.unitSelections);

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

        language: this.cleanStr(dto.language),
        nationality: this.cleanStr(dto.nationality),
        gender,
        birthday,
        job: this.cleanStr(dto.job),
        project,
        idDocumentUrl: this.cleanStr(dto.idDocumentUrl),
        idDocumentName: this.cleanStr(dto.idDocumentName),

        unitSelections:
          unitSelections.length > 0
            ? {
                create: unitSelections.map((row) => ({
                  project: row.project,
                  unitNumber: row.unitNumber,
                })),
              }
            : undefined,
      },
      include: {
        agency: true,
        owner: {
          select: { id: true, name: true, email: true },
        },
        unitSelections: {
          orderBy: [{ project: "asc" }, { unitNumber: "asc" }],
        },
        documents: {
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: {
            presentations: true,
            documents: true,
            unitSelections: true,
          },
        },
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
      const fullName = this.cleanStr(dto.fullName);
      if (!fullName) {
        throw new BadRequestException("Customer name required");
      }
      data.fullName = fullName;
    }

    if (dto.companyName !== undefined) data.companyName = this.cleanStr(dto.companyName);
    if (dto.phone !== undefined) data.phone = this.cleanStr(dto.phone);
    if (dto.email !== undefined) data.email = this.cleanStr(dto.email);
    if (dto.city !== undefined) data.city = this.cleanStr(dto.city);
    if (dto.country !== undefined) data.country = this.cleanStr(dto.country);
    if (dto.address !== undefined) data.address = this.cleanStr(dto.address);
    if (dto.source !== undefined) data.source = this.cleanStr(dto.source);
    if (dto.notesSummary !== undefined) data.notesSummary = this.cleanStr(dto.notesSummary);
    if (dto.type !== undefined) data.type = dto.type;

    if (dto.language !== undefined) data.language = this.cleanStr(dto.language);
    if (dto.nationality !== undefined) data.nationality = this.cleanStr(dto.nationality);
    if (dto.gender !== undefined) data.gender = this.normalizeGender(dto.gender);
    if (dto.birthday !== undefined) data.birthday = this.parseDateOrNull(dto.birthday);
    if (dto.job !== undefined) data.job = this.cleanStr(dto.job);
    if (dto.project !== undefined) data.project = this.normalizeProject(dto.project);
    if (dto.idDocumentUrl !== undefined) data.idDocumentUrl = this.cleanStr(dto.idDocumentUrl);
    if (dto.idDocumentName !== undefined) data.idDocumentName = this.cleanStr(dto.idDocumentName);

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

    const nextUnitSelections =
      dto.unitSelections !== undefined
        ? this.normalizeUnitSelections(dto.unitSelections)
        : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data,
      });

      if (nextUnitSelections !== null) {
        await tx.customerUnitSelection.deleteMany({
          where: { customerId },
        });

        if (nextUnitSelections.length > 0) {
          await tx.customerUnitSelection.createMany({
            data: nextUnitSelections.map((row) => ({
              customerId,
              project: row.project,
              unitNumber: row.unitNumber,
            })),
          });
        }
      }
    });

    const updated = await this.getCustomerOrThrow(customerId);

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

      await tx.customerDocument.deleteMany({
        where: { customerId },
      });

      await tx.customerUnitSelection.deleteMany({
        where: { customerId },
      });

      await tx.customer.delete({
        where: { id: customerId },
      });
    });

    return { success: true };
  }

 async addCustomerDocument(
  user: ReqUser,
  customerId: string,
  body: {
    type?: CustomerDocumentType;
    fileName: string;
    storagePath: string;
    mimeType?: string | null;
  },
) {
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
    throw new ForbiddenException("No access");
  }

  const fileName = this.cleanStr(body.fileName);
  const storagePath = this.cleanStr(body.storagePath);

  if (!fileName) {
    throw new BadRequestException("fileName is required");
  }

  if (!storagePath) {
    throw new BadRequestException("storagePath is required");
  }

  const type = this.normalizeDocumentType(body.type);

  const doc = await this.prisma.customerDocument.create({
    data: {
      customerId,
      type,
      fileName,
      storagePath,
      mimeType: this.cleanStr(body.mimeType),
    },
  });

  return doc;
}


async deleteCustomerDocument(
  user: ReqUser,
  customerId: string,
  documentId: string,
) {
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
    throw new ForbiddenException("No access");
  }

  const doc = await this.prisma.customerDocument.findFirst({
    where: {
      id: documentId,
      customerId,
    },
  });

  if (!doc) {
    throw new NotFoundException("Document not found");
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!bucket) {
    throw new BadRequestException("SUPABASE_STORAGE_BUCKET is not configured");
  }

  if (doc.storagePath) {
const { supabaseAdmin } = await import("../lib/supabase-admin.js");

    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .remove([doc.storagePath]);

    if (error) {
      throw new BadRequestException(error.message);
    }
  }

  await this.prisma.customerDocument.delete({
    where: { id: documentId },
  });

  if (doc.type === "ID") {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        idDocumentUrl: null,
        idDocumentName: null,
      },
    });
  }

  return { success: true };
}


async getCustomerDocumentUrl(
  user: ReqUser,
  customerId: string,
  documentId: string,
) {
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

  const canAccess =
    this.isAdmin(user) ||
    this.isManager(user) ||
    this.salesOwnsCustomer(user, customer);

  if (!canAccess) {
    throw new ForbiddenException("No access");
  }

  const doc = await this.prisma.customerDocument.findFirst({
    where: {
      id: documentId,
      customerId,
    },
  });

  if (!doc) {
    throw new NotFoundException("Document not found");
  }

  if (!doc.storagePath) {
    throw new BadRequestException("Document storagePath is missing");
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!bucket) {
    throw new BadRequestException("SUPABASE_STORAGE_BUCKET is not configured");
  }

const { supabaseAdmin } = await import("../lib/supabase-admin.js");

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(doc.storagePath, 60 * 10);

  if (error || !data?.signedUrl) {
    throw new BadRequestException(
      error?.message || "Could not create signed URL",
    );
  }

  return { url: data.signedUrl };
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
        unitSelections: {
          orderBy: [{ project: "asc" }, { unitNumber: "asc" }],
        },
        documents: {
          orderBy: { createdAt: "desc" },
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