import { unitEmailSubject } from "./unit-email-subject";
import { normalizeRecipientEmail, queuePolicy } from "./email-delivery-policy";
import { perlaLanguage, perlaTemplate } from "./perla-template";
import { createHash, randomUUID } from "crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { promises as fs } from "fs";
import * as path from "path";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  PROJECT_LABELS,
  PROJECT_TYPES as PROJECTS,
  type ProjectType,
} from "../common/projects";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  email?: string | null;
  role?: Role;
};

type UnitDeliveryStatus = "NOT_READY" | "READY_TO_DELIVER" | "DELIVERED";

type RecipientFilters = {
  project?: string | null;
  deliveryStatus?: string | null;
  ownerId?: string | null;
  language?: string | null;
  nationality?: string | null;
  q?: string | null;
  selectedCustomerIds?: string[] | null;
};

type BulkRecipient = {
  customerId: string;
  fullName: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
  nationality?: string | null;
  owner?: {
    id: string;
    name: string;
    email?: string | null;
    role?: string | null;
  } | null;
  units: Array<{
    id: string;
    project: ProjectType;
    unitNumber: string;
    deliveryStatus: UnitDeliveryStatus;
  }>;
};

type BulkUnitRow = {
  id: string;
  project: ProjectType;
  unitNumber: string;
  deliveryStatus: UnitDeliveryStatus;
  customer: {
    id: string;
    fullName: string;
    companyName?: string | null;
    email?: string | null;
    phone?: string | null;
    language?: string | null;
    nationality?: string | null;
    owner?: {
      id: string;
      name: string;
      email?: string | null;
      role?: string | null;
    } | null;
  };
};

type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

type AttachmentBundle = {
  shared: EmailAttachment[];
  byCustomerId: Map<string, EmailAttachment[]>;
  selectedNames: string[];
};

type AttachmentOption = {
  id: string;
  kind: "PROJECT_DOCUMENT" | "CUSTOMER_DOCUMENT";
  label: string;
  fileName: string;
  source: string;
  project?: ProjectType;
  customerId?: string;
  customerName?: string;
  units?: string[];
  mimeType?: string | null;
  size?: number | null;
  createdAt?: Date | string | null;
};

type CampaignSendOutcome = {
  successes: Array<{
    customerId: string;
    name: string;
    email: string;
    units: string[];
  }>;
  failures: Array<{
    customerId: string;
    name: string;
    email: string;
    units: string[];
    error: string;
  }>;
};

const DELIVERY_STATUSES: UnitDeliveryStatus[] = [
  "NOT_READY",
  "READY_TO_DELIVER",
  "DELIVERED",
];

const EMAIL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const EMAIL_ATTACHMENT_MAX_FILES = 12;
const EMAIL_ATTACHMENT_TOTAL_MAX_BYTES = 25 * 1024 * 1024;
const EMAIL_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);
const PROJECT_DOCUMENT_PREFIX = "project";
const CUSTOMER_DOCUMENT_PREFIX = "customer";
const EMAIL_ATTACHMENT_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "txt",
]);

@Injectable()
export class BulkEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private cleanStr(value?: string | null) {
    const next = String(value || "").trim();
    return next || null;
  }

  private db() {
    return this.prisma as any;
  }

  private normalizeProject(value?: string | null): ProjectType {
    const next = String(value || "")
      .trim()
      .toUpperCase();
    if (!PROJECTS.includes(next as ProjectType)) {
      throw new BadRequestException("Project is required");
    }
    return next as ProjectType;
  }

  private normalizeEmail(value?: string | null) {
    return normalizeRecipientEmail(value);
  }

  private normalizeDeliveryStatus(
    value?: string | null,
  ): UnitDeliveryStatus | null {
    const next = this.cleanStr(value)?.toUpperCase();
    if (!next) return null;
    if (!DELIVERY_STATUSES.includes(next as UnitDeliveryStatus)) {
      throw new BadRequestException("Invalid delivery status");
    }
    return next as UnitDeliveryStatus;
  }

  private normalizeIdList(value?: string | string[] | null) {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.cleanStr(item))
        .filter(Boolean) as string[];
    }

    const raw = this.cleanStr(value);
    if (!raw) return [];
    return raw
      .split(",")
      .map((item) => this.cleanStr(item))
      .filter(Boolean) as string[];
  }

  private attachmentName(filename?: string | null) {
    return this.cleanStr(filename)?.replace(/[\\/]/g, "-") || "attachment";
  }

  private projectDocumentsRoot() {
    return (
      this.cleanStr(process.env.BULK_EMAIL_PROJECT_DOCS_DIR) ||
      path.join(process.cwd(), "project-documents")
    );
  }

  private projectDocumentOptionId(project: ProjectType, fileName: string) {
    return `${PROJECT_DOCUMENT_PREFIX}:${project}:${encodeURIComponent(fileName)}`;
  }

  private customerDocumentOptionId(documentId: string) {
    return `${CUSTOMER_DOCUMENT_PREFIX}:${documentId}`;
  }

  private parseAttachmentIds(values?: string | string[] | null) {
    return this.normalizeIdList(values);
  }

  private projectDocumentPath(project: ProjectType, encodedFileName: string) {
    const fileName = decodeURIComponent(encodedFileName);
    const safeFileName = path.basename(fileName);
    if (
      fileName !== safeFileName ||
      !safeFileName.toLowerCase().endsWith(".pdf")
    ) {
      throw new BadRequestException("Invalid project document");
    }

    const root = path.resolve(this.projectDocumentsRoot(), project);
    const resolved = path.resolve(root, safeFileName);
    if (!resolved.startsWith(root + path.sep)) {
      throw new BadRequestException("Invalid project document");
    }

    return { fileName: safeFileName, fullPath: resolved };
  }

  private async listProjectDocuments(
    project: ProjectType,
  ): Promise<AttachmentOption[]> {
    const folder = path.resolve(this.projectDocumentsRoot(), project);

    try {
      const entries = await fs.readdir(folder, { withFileTypes: true });
      const docs = await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"),
          )
          .map(async (entry) => {
            const stat = await fs.stat(path.join(folder, entry.name));
            return {
              id: this.projectDocumentOptionId(project, entry.name),
              kind: "PROJECT_DOCUMENT" as const,
              label: `${PROJECT_LABELS[project]} - ${entry.name}`,
              fileName: entry.name,
              source: "project",
              project,
              mimeType: "application/pdf",
              size: stat.size,
              createdAt: stat.birthtime,
            };
          }),
      );

      return docs.sort((a, b) => a.fileName.localeCompare(b.fileName));
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  private normalizeAttachment(
    file?: Express.Multer.File,
  ): EmailAttachment | null {
    if (!file) return null;

    if (!file.buffer?.length) {
      throw new BadRequestException("Attachment file is empty");
    }

    if (file.size > EMAIL_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException("Attachment must be 10MB or smaller");
    }

    const filename = this.attachmentName(file.originalname);
    const extension = filename.includes(".")
      ? filename.split(".").pop()?.toLowerCase()
      : null;
    const contentType =
      this.cleanStr(file.mimetype) || "application/octet-stream";

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

  private normalizeUploadedAttachments(files?: Express.Multer.File[]) {
    const attachments = (files || [])
      .map((file) => this.normalizeAttachment(file))
      .filter(Boolean) as EmailAttachment[];

    if (attachments.length > EMAIL_ATTACHMENT_MAX_FILES) {
      throw new BadRequestException(
        `You can attach up to ${EMAIL_ATTACHMENT_MAX_FILES} files`,
      );
    }

    const totalSize = attachments.reduce(
      (sum, attachment) => sum + attachment.content.length,
      0,
    );

    if (totalSize > EMAIL_ATTACHMENT_TOTAL_MAX_BYTES) {
      throw new BadRequestException(
        "Total attachment size must be 25MB or smaller",
      );
    }

    return attachments;
  }

  private validateAttachmentBundleSize(bundle: AttachmentBundle) {
    const sharedSize = bundle.shared.reduce(
      (sum, attachment) => sum + attachment.content.length,
      0,
    );

    if (bundle.shared.length > EMAIL_ATTACHMENT_MAX_FILES) {
      throw new BadRequestException(
        `You can attach up to ${EMAIL_ATTACHMENT_MAX_FILES} files`,
      );
    }

    for (const [
      customerId,
      privateAttachments,
    ] of bundle.byCustomerId.entries()) {
      if (
        bundle.shared.length + privateAttachments.length >
        EMAIL_ATTACHMENT_MAX_FILES
      ) {
        throw new BadRequestException(
          `Attachments for customer ${customerId} exceed the ${EMAIL_ATTACHMENT_MAX_FILES} file limit`,
        );
      }

      const total =
        sharedSize +
        privateAttachments.reduce(
          (sum, attachment) => sum + attachment.content.length,
          0,
        );

      if (total > EMAIL_ATTACHMENT_TOTAL_MAX_BYTES) {
        throw new BadRequestException(
          `Attachments for customer ${customerId} exceed the 25MB email limit`,
        );
      }
    }
  }

  private renderTemplate(
    text: string,
    recipient: BulkRecipient,
    project: ProjectType,
  ) {
    const units = recipient.units.map((unit) => unit.unitNumber).join(", ");
    const customerName =
      this.cleanStr(recipient.fullName) ||
      this.cleanStr(recipient.companyName) ||
      "Customer";
    const companyName =
      this.cleanStr(recipient.companyName) ||
      this.cleanStr(recipient.fullName) ||
      "";
    const salesName = this.cleanStr(recipient.owner?.name) || "DND Cyprus";

    return text
      .replace(/\{customerName\}/g, customerName)
      .replace(/\{project\}/g, PROJECT_LABELS[project])
      .replace(/\{units\}/g, units)
      .replace(/\{salesName\}/g, salesName)
      .replace(/\{companyName\}/g, companyName);
  }

  private toHtml(text: string) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br />");
  }

  private readableMailError(error: any) {
    const message = String(
      error?.message || error || "Email could not be sent",
    );
    const code = String(error?.code || error?.responseCode || "").toUpperCase();
    const response = String(error?.response || "").trim();
    const text = `${code} ${message} ${response}`.toLowerCase();

    let friendly = "Email could not be sent.";

    if (
      text.includes("auth") ||
      text.includes("535") ||
      text.includes("login")
    ) {
      friendly =
        "SMTP login failed. Please check the mail username or password.";
    } else if (
      text.includes("connection") ||
      text.includes("timeout") ||
      text.includes("econn") ||
      text.includes("etimedout")
    ) {
      friendly =
        "SMTP connection failed. Please check the mail server and port.";
    } else if (
      text.includes("recipient") ||
      text.includes("mailbox") ||
      text.includes("550") ||
      text.includes("invalid address")
    ) {
      friendly = "Recipient address was rejected by the mail server.";
    } else if (text.includes("quota") || text.includes("storage")) {
      friendly = "Mailbox quota or storage limit was reached.";
    } else if (
      text.includes("too large") ||
      text.includes("message size") ||
      text.includes("552")
    ) {
      friendly = "Email is too large. Reduce attachment size and try again.";
    } else if (
      text.includes("rate") ||
      text.includes("limit") ||
      text.includes("throttle")
    ) {
      friendly = "Mail server rate limit was reached. Try again later.";
    }

    return response && !message.includes(response)
      ? `${friendly} (${response})`
      : `${friendly} (${message})`;
  }

  private sortUnitNumbers<T extends { unitNumber: string }>(
    rows: readonly T[],
  ) {
    const collator = new Intl.Collator("en", {
      numeric: true,
      sensitivity: "base",
    });
    return [...rows].sort((a, b) =>
      collator.compare(a.unitNumber, b.unitNumber),
    );
  }

  private campaignRecipientData(
    campaignId: string,
    recipient: BulkRecipient,
    status: "SENT" | "FAILED" | "MISSING_EMAIL" | "QUEUED",
    options: { error?: string | null; sentAt?: Date | null } = {},
  ) {
    return {
      campaignId,
      customerId: recipient.customerId,
      customerName:
        this.cleanStr(recipient.fullName) ||
        this.cleanStr(recipient.companyName) ||
        "Customer",
      companyName: this.cleanStr(recipient.companyName),
      email: this.cleanStr(recipient.email),
      phone: this.cleanStr(recipient.phone),
      ownerName: this.cleanStr(recipient.owner?.name),
      ownerEmail: this.cleanStr(recipient.owner?.email),
      ownerRole: this.cleanStr(recipient.owner?.role),
      unitNumbers: recipient.units.map((unit) => unit.unitNumber).join(", "),
      unitSnapshot: recipient.units.map((unit) => ({
        id: unit.id,
        project: unit.project,
        unitNumber: unit.unitNumber,
        deliveryStatus: unit.deliveryStatus,
      })),
      status,
      error: this.cleanStr(options.error),
      sentAt: options.sentAt || null,
    };
  }

  private recipientMatchesSearch(recipient: BulkRecipient, q?: string | null) {
    const needle = this.cleanStr(q)?.toLowerCase();
    if (!needle) return true;

    const haystack = [
      recipient.fullName,
      recipient.companyName,
      recipient.email,
      recipient.phone,
      recipient.language,
      recipient.nationality,
      recipient.owner?.name,
      ...recipient.units.map((unit) => unit.unitNumber),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(needle);
  }

  private async buildRecipientPreview(filters: RecipientFilters) {
    const project = this.normalizeProject(filters.project);
    const deliveryStatus = this.normalizeDeliveryStatus(filters.deliveryStatus);
    const ownerId = this.cleanStr(filters.ownerId);
    const language = this.cleanStr(filters.language);
    const nationality = this.cleanStr(filters.nationality);
    const selectedCustomerIds = filters.selectedCustomerIds || [];

    const customerWhere: any = {
      type: "EXISTING",
    };

    if (ownerId) customerWhere.ownerId = ownerId;
    if (language)
      customerWhere.language = { equals: language, mode: "insensitive" };
    if (nationality) {
      customerWhere.nationality = { equals: nationality, mode: "insensitive" };
    }
    if (selectedCustomerIds.length > 0) {
      customerWhere.id = { in: selectedCustomerIds };
    }

    const where: any = {
      project,
      isCanceled: false,
      customer: customerWhere,
    };

    if (deliveryStatus) {
      where.deliveryStatus = deliveryStatus;
    }

    const units = (await this.prisma.customerUnitSelection.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            companyName: true,
            email: true,
            phone: true,
            language: true,
            nationality: true,
            owner: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: [{ unitNumber: "asc" }, { createdAt: "asc" }],
    })) as BulkUnitRow[];

    const byCustomer = new Map<string, BulkRecipient>();

    for (const unit of this.sortUnitNumbers(units)) {
      const customer = unit.customer;
      const current = byCustomer.get(customer.id);
      const unitRow = {
        id: unit.id,
        project: unit.project as ProjectType,
        unitNumber: unit.unitNumber,
        deliveryStatus: unit.deliveryStatus,
      };

      if (current) {
        current.units.push(unitRow);
        continue;
      }

      byCustomer.set(customer.id, {
        customerId: customer.id,
        fullName: customer.fullName,
        companyName: customer.companyName,
        email: this.normalizeEmail(customer.email),
        phone: customer.phone,
        language: customer.language,
        nationality: customer.nationality,
        owner: customer.owner,
        units: [unitRow],
      });
    }

    const recipients = Array.from(byCustomer.values())
      .map((recipient) => ({
        ...recipient,
        units: this.sortUnitNumbers(recipient.units),
      }))
      .filter((recipient) => this.recipientMatchesSearch(recipient, filters.q));
    const emailCounts = new Map<string, number>();
    recipients.forEach((r) => {
      if (r.email)
        emailCounts.set(r.email, (emailCounts.get(r.email) || 0) + 1);
    });
    const suppressionRows = await this.db().bulkEmailSuppression.findMany({
      where: { email: { in: [...emailCounts.keys()] } },
      select: { email: true },
    });
    const suppressed = new Set(suppressionRows.map((r: any) => r.email));
    // Shared addresses can belong to distinct people with private attachments: require review instead of merging.
    const blockedRecipients = recipients.filter(
      (r) =>
        r.email &&
        ((emailCounts.get(r.email) || 0) > 1 || suppressed.has(r.email)),
    );
    const withEmail = recipients.filter(
      (r) => r.email && !blockedRecipients.includes(r),
    );
    const missingEmail = recipients.filter((recipient) => !recipient.email);
    const languages = Array.from(
      new Set(
        recipients
          .map((recipient) => this.cleanStr(recipient.language))
          .filter(Boolean),
      ),
    ).sort((a, b) => String(a).localeCompare(String(b)));
    const nationalities = Array.from(
      new Set(
        recipients
          .map((recipient) => this.cleanStr(recipient.nationality))
          .filter(Boolean),
      ),
    ).sort((a, b) => String(a).localeCompare(String(b)));

    return {
      project,
      projectLabel: PROJECT_LABELS[project],
      blockedRecipients: blockedRecipients.map((r) => ({
        ...r,
        reason: suppressed.has(r.email) ? "SUPPRESSED" : "SHARED_EMAIL",
      })),
      languageReview: withEmail
        .map((r) => ({
          customerId: r.customerId,
          ...perlaLanguage(r.language, r.nationality),
        }))
        .filter((r) => r.fallback),
      filters: {
        deliveryStatus,
        ownerId,
        language,
        nationality,
        q: this.cleanStr(filters.q),
        selectedCustomerIds,
      },
      totalUnits: recipients.reduce(
        (sum, recipient) => sum + recipient.units.length,
        0,
      ),
      uniqueCustomers: recipients.length,
      withEmailCount: withEmail.length,
      missingEmailCount: missingEmail.length,
      recipients: withEmail,
      missingEmail,
      facets: {
        languages,
        nationalities,
      },
    };
  }

  async previewRecipients(_user: ReqUser, filters: RecipientFilters) {
    return this.buildRecipientPreview(filters);
  }

  async attachmentOptions(_user: ReqUser, filters: RecipientFilters) {
    const preview = await this.buildRecipientPreview(filters);
    const recipients = preview.recipients;
    const customerIds = Array.from(
      new Set(recipients.map((recipient) => recipient.customerId)),
    );
    const unitsByCustomerId = new Map(
      recipients.map((recipient) => [
        recipient.customerId,
        recipient.units.map((unit) => unit.unitNumber),
      ]),
    );
    const projectDocuments = await this.listProjectDocuments(preview.project);

    const customerDocuments =
      customerIds.length > 0
        ? await this.prisma.customerDocument.findMany({
            where: { customerId: { in: customerIds } },
            include: {
              customer: {
                select: {
                  id: true,
                  fullName: true,
                  companyName: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 500,
          })
        : [];

    return {
      project: preview.project,
      projectLabel: preview.projectLabel,
      projectDocuments,
      customerDocuments: customerDocuments.map((doc) => {
        const customerName =
          this.cleanStr(doc.customer.fullName) ||
          this.cleanStr(doc.customer.companyName) ||
          "Customer";

        return {
          id: this.customerDocumentOptionId(doc.id),
          kind: "CUSTOMER_DOCUMENT" as const,
          label: `${customerName} - ${doc.fileName}`,
          fileName: doc.fileName,
          source: "customer",
          customerId: doc.customerId,
          customerName,
          units: unitsByCustomerId.get(doc.customerId) || [],
          mimeType: doc.mimeType,
          createdAt: doc.createdAt,
        };
      }),
    };
  }

  private async downloadCustomerDocument(doc: {
    id: string;
    storagePath: string;
    fileName: string;
    mimeType?: string | null;
  }): Promise<EmailAttachment> {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!bucket) {
      throw new BadRequestException(
        "SUPABASE_STORAGE_BUCKET is not configured",
      );
    }

    if (!this.cleanStr(doc.storagePath)) {
      throw new BadRequestException(
        `Document ${doc.fileName} has no storage path`,
      );
    }

    const { supabaseAdmin } = await import("../lib/supabase-admin.js");
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .download(doc.storagePath);

    if (error || !data) {
      throw new BadRequestException(
        error?.message || `Could not download document ${doc.fileName}`,
      );
    }

    const content = Buffer.from(await data.arrayBuffer());
    if (content.length > EMAIL_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(
        `Document ${doc.fileName} must be 10MB or smaller`,
      );
    }

    return {
      filename: this.attachmentName(doc.fileName),
      content,
      contentType: this.cleanStr(doc.mimeType) || "application/octet-stream",
    };
  }

  private async buildAttachmentBundle(
    project: ProjectType,
    recipients: BulkRecipient[],
    uploadedFiles?: Express.Multer.File[],
    selectedAttachmentIds?: string | string[] | null,
  ): Promise<AttachmentBundle> {
    const shared = this.normalizeUploadedAttachments(uploadedFiles);
    const byCustomerId = new Map<string, EmailAttachment[]>();
    const selectedNames = shared.map((attachment) => attachment.filename);
    const selectedIds = this.parseAttachmentIds(selectedAttachmentIds);

    const customerDocumentIds: string[] = [];

    for (const id of selectedIds) {
      const [kind, first, second] = id.split(":");

      if (kind === PROJECT_DOCUMENT_PREFIX) {
        if (first !== project || !second) {
          throw new BadRequestException("Invalid project document selection");
        }

        const { fileName, fullPath } = this.projectDocumentPath(
          project,
          second,
        );
        const content = await fs.readFile(fullPath);
        if (content.length > EMAIL_ATTACHMENT_MAX_BYTES) {
          throw new BadRequestException(
            `Project document ${fileName} must be 10MB or smaller`,
          );
        }

        shared.push({
          filename: fileName,
          content,
          contentType: "application/pdf",
        });
        selectedNames.push(fileName);
        continue;
      }

      if (kind === CUSTOMER_DOCUMENT_PREFIX && first) {
        customerDocumentIds.push(first);
        continue;
      }

      throw new BadRequestException("Invalid attachment selection");
    }

    if (customerDocumentIds.length > 0) {
      const allowedCustomerIds = new Set(
        recipients.map((recipient) => recipient.customerId),
      );
      const uniqueDocumentIds = Array.from(new Set(customerDocumentIds));
      const docs = await this.prisma.customerDocument.findMany({
        where: {
          id: { in: uniqueDocumentIds },
          customerId: { in: Array.from(allowedCustomerIds) },
        },
        include: {
          customer: {
            select: {
              fullName: true,
              companyName: true,
            },
          },
        },
      });

      if (docs.length !== uniqueDocumentIds.length) {
        throw new BadRequestException(
          "Some selected customer documents are not available for the current recipients",
        );
      }

      for (const doc of docs) {
        const attachment = await this.downloadCustomerDocument(doc);
        const existing = byCustomerId.get(doc.customerId) || [];
        existing.push(attachment);
        byCustomerId.set(doc.customerId, existing);

        const customerName =
          this.cleanStr(doc.customer.fullName) ||
          this.cleanStr(doc.customer.companyName) ||
          "Customer";
        selectedNames.push(`${customerName}: ${attachment.filename}`);
      }
    }

    const bundle = { shared, byCustomerId, selectedNames };
    this.validateAttachmentBundleSize(bundle);
    return bundle;
  }

  private async sendRecipientsForCampaign(
    user: ReqUser,
    campaignId: string,
    project: ProjectType,
    subjectTemplate: string,
    messageTemplate: string,
    recipients: BulkRecipient[],
    attachmentBundle: AttachmentBundle,
    brandedTemplate = false,
    transaction?: any,
  ): Promise<CampaignSendOutcome> {
    const payloadBytes = recipients.reduce(
      (total, r) =>
        total +
        attachmentBundle.shared.reduce((n, a) => n + a.content.length, 0) +
        (attachmentBundle.byCustomerId.get(r.customerId) || []).reduce(
          (n, a) => n + a.content.length,
          0,
        ) +
        (brandedTemplate ? 100000 : 0),
      0,
    );
    if (payloadBytes > 75 * 1024 * 1024)
      throw new BadRequestException(
        "Campaign attachments too large; reduce attachments or recipient count",
      );
    const languageOrder = ["tr", "fa", "ru", "en"];
    const collator = new Intl.Collator("tr", {
      numeric: true,
      sensitivity: "base",
    });
    const orderedRecipients = brandedTemplate
      ? [...recipients].sort(
          (a, b) =>
            languageOrder.indexOf(
              perlaLanguage(a.language, a.nationality).language,
            ) -
              languageOrder.indexOf(
                perlaLanguage(b.language, b.nationality).language,
              ) ||
            collator.compare(
              a.units[0]?.unitNumber || "",
              b.units[0]?.unitNumber || "",
            ),
        )
      : recipients;
    const jobs = await Promise.all(
      orderedRecipients.map(async (recipient) => {
        const branded = brandedTemplate
          ? await perlaTemplate(
              perlaLanguage(recipient.language, recipient.nationality).language,
            )
          : null;
        const subject =
          brandedTemplate ? unitEmailSubject(project, recipient.units.map(unit => unit.unitNumber)) :
          this.renderTemplate(subjectTemplate, recipient, project);
        const text =
          branded?.text ||
          this.renderTemplate(messageTemplate, recipient, project);
        const attachments = [
          ...(branded?.attachments || []),
          ...attachmentBundle.shared,
          ...(attachmentBundle.byCustomerId.get(recipient.customerId) || []),
        ];
        return {
          recipient,
          payload: {
            to: recipient.email,
            subject,
            text,
            html: branded?.html || this.toHtml(text),
            replyTo: process.env.SMTP_USER,
            actorId: user.id,
            deliveryLanguage: perlaLanguage(
              recipient.language,
              recipient.nationality,
            ).language,
            unitIds: recipient.units.map((unit) => unit.id),
            attachments: attachments.map((a) => ({
              ...a,
              content: a.content.toString("base64"),
            })),
          },
        };
      }),
    );
    const save = async (tx: any) => {
      const enqueuedAt = Date.now();
      const rows = jobs.map(({ recipient, payload }, index) => ({
        createdAt: new Date(enqueuedAt + index),
        id: randomUUID(),
        recipient,
        payload,
      }));
      await tx.bulkEmailRecipient.createMany({
        data: rows.map((row) => ({
          id: row.id,
          ...this.campaignRecipientData(campaignId, row.recipient, "QUEUED"),
          subject: row.payload.subject,
          deliveryLanguage: row.payload.deliveryLanguage,
        })),
      });
      await tx.bulkEmailJob.createMany({
        data: rows.map((row) => ({
          id: randomUUID(),
          campaignId,
          recipientId: row.id,
          payload: row.payload,
          createdAt: row.createdAt,
        })),
      });
    };
    if (transaction) await save(transaction);
    else await this.prisma.$transaction(save, { timeout: 60000 });
    return { successes: [], failures: [] };
  }

  private queuedResult(campaign: any, missingEmail: any[]) {
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      project: campaign.project,
      projectLabel: PROJECT_LABELS[campaign.project as ProjectType],
      subject: campaign.subject,
      sentAt: campaign.createdAt.toISOString(),
      attempted: campaign.attemptedCount,
      successCount: campaign.successCount,
      failedCount: campaign.failedCount,
      skippedMissingEmailCount: missingEmail.length,
      successes: [],
      failures: [],
      missingEmail,
      queued: true,
      delivery: this.deliverySettings(),
    };
  }

  deliverySettings() {
    const policy = queuePolicy();
    return {
      queueEnabled: policy.enabled,
      hourlyLimit: Number.isFinite(policy.hourly) ? policy.hourly : null,
      dailyLimit: Number.isFinite(policy.daily) ? policy.daily : null,
      intervalSeconds: policy.interval,
      pausedReason: policy.enabled
        ? null
        : "Provider quota must be confirmed and queue enabled in backend settings.",
    };
  }

  async pauseCampaign(id: string) {
    await this.getCampaign(id);
    return this.db().bulkEmailCampaign.update({ where: { id }, data: { pausedAt: new Date(), pauseReason: "Kullanıcı tarafından duraklatıldı" } });
  }

  async resumeCampaign(id: string) {
    if (!queuePolicy().enabled) throw new BadRequestException("Backend gönderim ayarları etkin değil; kampanya duraklatılmış kalacak");
    const campaign = await this.getCampaign(id);
    if (campaign.status !== "SENDING") throw new BadRequestException("Tamamlanmış kampanya yeniden başlatılamaz");
    return this.db().bulkEmailCampaign.update({ where: { id }, data: { pausedAt: null, pauseReason: null } });
  }

  async listCampaigns(project?: string | null) {
    const where: any = {};
    if (this.cleanStr(project)) {
      where.project = this.normalizeProject(project);
    }

    return this.db().bulkEmailCampaign.findMany({
      where,
      orderBy: { sentAt: "desc" },
      take: 100,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  private parseDateRange(input: {
    dateFrom?: string | null;
    dateTo?: string | null;
  }) {
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setHours(0, 0, 0, 0);
    const defaultTo = new Date(now);
    defaultTo.setHours(23, 59, 59, 999);
    const from = this.cleanStr(input.dateFrom)
      ? new Date(String(input.dateFrom))
      : defaultFrom;
    const to = this.cleanStr(input.dateTo)
      ? new Date(String(input.dateTo))
      : defaultTo;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("Invalid report date range");
    }

    if (String(input.dateFrom || "").length <= 10) from.setHours(0, 0, 0, 0);
    if (String(input.dateTo || "").length <= 10) to.setHours(23, 59, 59, 999);

    if (from > to) {
      throw new BadRequestException(
        "Report start date must be before end date",
      );
    }

    return { from, to };
  }

  async report(
    _user: ReqUser,
    input: {
      dateFrom?: string | null;
      dateTo?: string | null;
      project?: string | null;
    },
  ) {
    const { from, to } = this.parseDateRange(input);
    const where: any = {
      sentAt: {
        gte: from,
        lte: to,
      },
    };

    if (this.cleanStr(input.project)) {
      where.project = this.normalizeProject(input.project);
    }

    const campaigns = await this.db().bulkEmailCampaign.findMany({
      where,
      orderBy: { sentAt: "desc" },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        recipients: true,
      },
    });

    const totals = campaigns.reduce(
      (acc: any, campaign: any) => {
        acc.campaigns += 1;
        acc.attempted += campaign.attemptedCount || 0;
        acc.sent += campaign.successCount || 0;
        acc.failed += campaign.failedCount || 0;
        acc.missingEmail += campaign.missingEmailCount || 0;
        acc.units += campaign.totalUnits || 0;
        return acc;
      },
      {
        campaigns: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        missingEmail: 0,
        units: 0,
      },
    );

    const byProject = PROJECTS.map((project) => {
      const rows = campaigns.filter(
        (campaign: any) => campaign.project === project,
      );
      return {
        project,
        projectLabel: PROJECT_LABELS[project],
        campaigns: rows.length,
        attempted: rows.reduce(
          (sum: number, row: any) => sum + row.attemptedCount,
          0,
        ),
        sent: rows.reduce((sum: number, row: any) => sum + row.successCount, 0),
        failed: rows.reduce(
          (sum: number, row: any) => sum + row.failedCount,
          0,
        ),
        missingEmail: rows.reduce(
          (sum: number, row: any) => sum + row.missingEmailCount,
          0,
        ),
      };
    }).filter((row) => row.campaigns > 0);

    const byStatus = ["COMPLETED", "PARTIAL", "FAILED", "SENDING"].map(
      (status) => ({
        status,
        count: campaigns.filter((campaign: any) => campaign.status === status)
          .length,
      }),
    );

    const failedRecipients = campaigns
      .flatMap((campaign: any) =>
        (campaign.recipients || [])
          .filter((recipient: any) => recipient.status === "FAILED")
          .map((recipient: any) => ({
            campaignId: campaign.id,
            campaignName: campaign.name,
            project: campaign.project,
            projectLabel: PROJECT_LABELS[campaign.project as ProjectType],
            sentAt: campaign.sentAt,
            customerId: recipient.customerId,
            customerName: recipient.customerName,
            email: recipient.email,
            unitNumbers: recipient.unitNumbers,
            error: recipient.error,
          })),
      )
      .slice(0, 100);

    return {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      project: where.project || null,
      totals,
      byProject,
      byStatus,
      campaigns: campaigns.map((campaign: any) => ({
        id: campaign.id,
        name: campaign.name,
        project: campaign.project,
        projectLabel: PROJECT_LABELS[campaign.project as ProjectType],
        subject: campaign.subject,
        status: campaign.status,
        attemptedCount: campaign.attemptedCount,
        successCount: campaign.successCount,
        failedCount: campaign.failedCount,
        missingEmailCount: campaign.missingEmailCount,
        totalUnits: campaign.totalUnits,
        attachmentFileName: campaign.attachmentFileName,
        sentAt: campaign.sentAt,
        createdBy: campaign.createdBy,
      })),
      failedRecipients,
    };
  }

  async getCampaign(id?: string | null) {
    const campaignId = this.cleanStr(id);
    if (!campaignId) {
      throw new BadRequestException("Campaign id is required");
    }

    const campaign = await this.db().bulkEmailCampaign.findUnique({
      where: { id: campaignId },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        recipients: {
          orderBy: [{ status: "asc" }, { customerName: "asc" }],
          include: {
            customer: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }

    return campaign;
  }

  async getCampaignPreview(id: string, language: string) {
    if (!["tr", "fa", "ru", "en"].includes(language)) {
      throw new BadRequestException("Unsupported language");
    }
    const campaign = await this.getCampaign(id);
    const recipients = campaign.recipients.filter(
      (recipient: any) => recipient.deliveryLanguage === language,
    );
    const pending = recipients.filter((r: any) => ["QUEUED", "SENDING"].includes(r.status));
    const job = pending.length ? await this.db().bulkEmailJob.findFirst({
      where: { campaignId: campaign.id, recipientId: { in: pending.map((r: any) => r.id) }, status: { in: ["QUEUED", "SENDING"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { recipientId: true, payload: true },
    }) : null;
    const payload = job?.payload as any;
    if (payload && (payload.html || payload.text)) {
      let html = String(payload.html || this.toHtml(String(payload.text)));
      for (const asset of payload.attachments || []) {
        if (asset.cid && /^image\/(png|jpeg|gif|webp)$/.test(asset.contentType || "") && typeof asset.content === "string") {
          html = html.replaceAll(`cid:${asset.cid}`, `data:${asset.contentType};base64,${asset.content}`);
        }
      }
      const recipient = recipients.find((r: any) => r.id === job.recipientId);
      return { subject: payload.subject, html, text: payload.text || "", source: "queued", customerName: recipient?.customerName, unitNumbers: recipient?.unitNumbers };
    }
    // Sent jobs discard their payload; use the immutable unit communication log.
    for (const recipient of recipients.filter((r: any) => r.status === "SENT")) {
      const unitIds = Array.isArray(recipient.unitSnapshot) ? recipient.unitSnapshot.map((unit: any) => unit.id).filter(Boolean) : [];
      if (!unitIds.length || !recipient.email) continue;
      const subject = recipient.subject || campaign.subject;
      const prefix = `Bulk email\nSubject: ${subject}\nRecipient: ${recipient.email}\n\n`;
      const log = await this.db().customerUnitSelectionLog.findFirst({
        where: { unitSelectionId: { in: unitIds }, section: "COMMUNICATION", field: "EMAIL", newValue: { startsWith: prefix }, createdAt: { gte: campaign.createdAt, ...(recipient.sentAt ? { lte: new Date(new Date(recipient.sentAt).getTime() + 60000) } : {}) } },
        orderBy: { createdAt: "asc" }, select: { newValue: true },
      });
      if (log?.newValue) {
        const text = log.newValue.slice(prefix.length);
        return { subject, text, html: this.toHtml(text), source: "sent-record", customerName: recipient.customerName, unitNumbers: recipient.unitNumbers };
      }
    }
    throw new NotFoundException("No saved email content available for this language");
  }

  async retryFailedRecipients(user: ReqUser, id?: string | null) {
    const originalCampaign = await this.getCampaign(id);
    const persistedJobs = await this.db().bulkEmailJob.count({
      where: { campaignId: originalCampaign.id },
    });
    if (persistedJobs) {
      const failedJobs = await this.db().bulkEmailJob.findMany({
        where: { campaignId: originalCampaign.id, status: "FAILED" },
      });
      const eligible = failedJobs.filter(
        (j: any) => j.payload && Object.keys(j.payload).length,
      );
      if (!eligible.length)
        throw new BadRequestException(
          "No confirmed failed deliveries available to retry",
        );
      await this.prisma.$transaction(async (tx: any) => {
        let requeued = 0;
        for (const job of eligible) {
          const suppressed = await tx.bulkEmailSuppression.findUnique({
            where: { email: job.payload.to },
          });
          if (suppressed) continue;
          const changed = await tx.bulkEmailJob.updateMany({
            where: { id: job.id, status: "FAILED" },
            data: { status: "QUEUED", attempts: 0, availableAt: new Date() },
          });
          if (changed.count) {
            requeued++;
            await tx.bulkEmailRecipient.update({
              where: { id: job.recipientId },
              data: { status: "QUEUED", error: null },
            });
          }
        }
        if (!requeued)
          throw new BadRequestException(
            "Recipients are suppressed or already queued",
          );
        await tx.bulkEmailCampaign.update({
          where: { id: originalCampaign.id },
          data: { status: "SENDING" },
        });
      });
      return this.queuedResult({ ...originalCampaign, status: "SENDING" }, []);
    }
    const failedRecipients = (originalCampaign.recipients || []).filter(
      (recipient: any) => recipient.status === "FAILED" && recipient.customerId,
    );

    if (failedRecipients.length === 0) {
      throw new BadRequestException(
        "No failed recipients found for this campaign",
      );
    }

    const selectedCustomerIds = Array.from(
      new Set(
        failedRecipients
          .map((recipient: any) => this.cleanStr(recipient.customerId))
          .filter(Boolean),
      ),
    ) as string[];
    const preview = await this.buildRecipientPreview({
      project: originalCampaign.project,
      selectedCustomerIds,
    });
    const failedCustomerIds = new Set(selectedCustomerIds);
    const recipients = preview.recipients.filter((recipient) =>
      failedCustomerIds.has(recipient.customerId),
    );

    if (recipients.length === 0) {
      throw new BadRequestException(
        "Failed recipients no longer have valid email addresses",
      );
    }

    const campaign = await this.db().bulkEmailCampaign.create({
      data: {
        name: `${originalCampaign.name} - Retry`,
        project: originalCampaign.project,
        subject: originalCampaign.subject,
        message: originalCampaign.message,
        attachmentFileName: null,
        status: "SENDING",
        totalUnits: recipients.reduce(
          (sum: number, recipient: BulkRecipient) =>
            sum + recipient.units.length,
          0,
        ),
        uniqueCustomers: recipients.length,
        attemptedCount: recipients.length,
        successCount: 0,
        failedCount: 0,
        missingEmailCount: selectedCustomerIds.length - recipients.length,
        createdById: user.id,
      },
    });

    const missing = selectedCustomerIds.filter(
      (customerId) =>
        !recipients.some((recipient) => recipient.customerId === customerId),
    );
    if (missing.length > 0) {
      const missingById = new Map(
        failedRecipients.map((recipient: any) => [
          recipient.customerId,
          recipient,
        ]),
      );
      await this.db().bulkEmailRecipient.createMany({
        data: missing.map((customerId) => {
          const recipient: any = missingById.get(customerId);
          return {
            campaignId: campaign.id,
            customerId,
            customerName: recipient?.customerName || "Customer",
            companyName: this.cleanStr(recipient?.companyName),
            email: this.cleanStr(recipient?.email),
            phone: this.cleanStr(recipient?.phone),
            ownerName: this.cleanStr(recipient?.ownerName),
            ownerEmail: this.cleanStr(recipient?.ownerEmail),
            ownerRole: this.cleanStr(recipient?.ownerRole),
            unitNumbers: this.cleanStr(recipient?.unitNumbers) || "",
            unitSnapshot: recipient?.unitSnapshot || null,
            status: "MISSING_EMAIL",
            error: "Recipient no longer has a valid email address",
            sentAt: null,
          };
        }),
      });
    }

    const attachmentBundle: AttachmentBundle = {
      shared: [],
      byCustomerId: new Map(),
      selectedNames: [],
    };
    const { successes, failures } = await this.sendRecipientsForCampaign(
      user,
      campaign.id,
      originalCampaign.project,
      originalCampaign.subject,
      originalCampaign.message,
      recipients,
      attachmentBundle,
    );
    const status = "SENDING";

    await this.db().bulkEmailCampaign.update({
      where: { id: campaign.id },
      data: {
        status,
        successCount: successes.length,
        failedCount: failures.length,
        attemptedCount: recipients.length,
        missingEmailCount: missing.length,
      },
    });

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: status,
      queued: true,
      delivery: this.deliverySettings(),
      project: originalCampaign.project,
      projectLabel: PROJECT_LABELS[originalCampaign.project as ProjectType],
      subject: originalCampaign.subject,
      sentAt: new Date().toISOString(),
      attempted: recipients.length,
      successCount: successes.length,
      failedCount: failures.length,
      skippedMissingEmailCount: missing.length,
      successes,
      failures,
      missingEmail: missing,
    };
  }

  async sendBulkEmail(
    user: ReqUser,
    dto: {
      templateId?: string | null;
      campaignName?: string | null;
      project?: string | null;
      deliveryStatus?: string | null;
      ownerId?: string | null;
      language?: string | null;
      nationality?: string | null;
      q?: string | null;
      selectedCustomerIds?: string | string[] | null;
      selectedAttachmentIds?: string | string[] | null;
      subject?: string | null;
      message?: string | null;
    },
    files?: Express.Multer.File[],
  ) {
    const project = this.normalizeProject(dto.project);
    const brandedTemplate = dto.templateId === "perla-update";
    if (dto.templateId && !brandedTemplate)
      throw new BadRequestException("Unknown mail template");
    if (brandedTemplate && project !== "LA_JOYA_PERLA")
      throw new BadRequestException(
        "Perla template is only available for Perla",
      );
    const subjectTemplate = this.cleanStr(dto.subject);
    const messageTemplate = this.cleanStr(dto.message);

    if (!subjectTemplate) {
      throw new BadRequestException("Subject is required");
    }

    if (!messageTemplate) {
      throw new BadRequestException("Message is required");
    }

    const selectedCustomerIds = this.normalizeIdList(dto.selectedCustomerIds);
    const preview = await this.buildRecipientPreview({
      project,
      deliveryStatus: dto.deliveryStatus,
      ownerId: dto.ownerId,
      language: dto.language,
      nationality: dto.nationality,
      q: dto.q,
      selectedCustomerIds,
    });
    if (preview.recipients.length === 0) {
      throw new BadRequestException(
        "No customers with email found for this project",
      );
    }

    const attachmentBundle = await this.buildAttachmentBundle(
      project,
      preview.recipients,
      files,
      dto.selectedAttachmentIds,
    );
    const attachmentNames = attachmentBundle.selectedNames.join(", ");
    const campaignName =
      this.cleanStr(dto.campaignName) ||
      `${PROJECT_LABELS[project]} - ${subjectTemplate}`;
    const requestKey = createHash("sha256")
      .update(
        JSON.stringify({
          project,
          subjectTemplate: brandedTemplate
            ? "perla-update-units-v2"
            : subjectTemplate,
          messageTemplate: brandedTemplate
            ? "perla-update-units-v2"
            : messageTemplate,
          brandedTemplate,
          recipients: preview.recipients
            .map((r) => ({
              id: r.customerId,
              email: r.email,
              language: r.language,
              nationality: r.nationality,
              units: r.units.map((u) => u.id),
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
          attachments: [
            ...attachmentBundle.shared,
            ...[...attachmentBundle.byCustomerId.values()].flat(),
          ].map((a) => ({
            name: a.filename,
            hash: createHash("sha256").update(a.content).digest("hex"),
          })),
        }),
      )
      .digest("hex");
    const campaign = await this.prisma.$transaction(
      async (tx: any) => {
        // Serialize identical submissions across API replicas as well as browser retries.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))::text`;
        const existing = await tx.bulkEmailCampaign.findUnique({
          where: { requestKey },
        });
        if (existing) return existing;
        const created = await tx.bulkEmailCampaign.create({
          data: {
            requestKey,
            name: campaignName,
            project,
            subject: subjectTemplate,
            message: messageTemplate,
            attachmentFileName: attachmentNames || null,
            status: "SENDING",
            totalUnits: preview.totalUnits,
            uniqueCustomers: preview.uniqueCustomers,
            attemptedCount: preview.recipients.length,
            missingEmailCount: preview.missingEmail.length,
            createdById: user.id,
          },
        });
        if (preview.missingEmail.length)
          await tx.bulkEmailRecipient.createMany({
            data: preview.missingEmail.map((r) =>
              this.campaignRecipientData(created.id, r, "MISSING_EMAIL"),
            ),
          });
        await this.sendRecipientsForCampaign(
          user,
          created.id,
          project,
          subjectTemplate,
          messageTemplate,
          preview.recipients,
          attachmentBundle,
          brandedTemplate,
          tx,
        );
        return created;
      },
      { timeout: 60000 },
    );
    return this.queuedResult(campaign, preview.missingEmail);
  }

  async sendTestEmail(
    user: ReqUser,
    dto: {
      templateId?: string | null;
      project?: string | null;
      deliveryStatus?: string | null;
      ownerId?: string | null;
      language?: string | null;
      nationality?: string | null;
      q?: string | null;
      selectedCustomerIds?: string | string[] | null;
      selectedAttachmentIds?: string | string[] | null;
      previewCustomerId?: string | null;
      subject?: string | null;
      message?: string | null;
    },
    files?: Express.Multer.File[],
  ) {
    const to = this.normalizeEmail(user.email);
    if (!to) {
      throw new BadRequestException("Your user email is missing");
    }

    const project = this.normalizeProject(dto.project);
    const subjectTemplate = this.cleanStr(dto.subject);
    const messageTemplate = this.cleanStr(dto.message);

    if (!subjectTemplate) {
      throw new BadRequestException("Subject is required");
    }

    if (!messageTemplate) {
      throw new BadRequestException("Message is required");
    }

    const selectedCustomerIds = this.normalizeIdList(dto.selectedCustomerIds);
    const preview = await this.buildRecipientPreview({
      project,
      deliveryStatus: dto.deliveryStatus,
      ownerId: dto.ownerId,
      language: dto.language,
      nationality: dto.nationality,
      q: dto.q,
      selectedCustomerIds,
    });

    const previewCustomerId = this.cleanStr(dto.previewCustomerId);
    const recipient =
      (previewCustomerId
        ? preview.recipients.find((row) => row.customerId === previewCustomerId)
        : null) || preview.recipients[0];

    if (!recipient) {
      throw new BadRequestException(
        "No preview customer found for this filter",
      );
    }

    if (
      dto.templateId &&
      (dto.templateId !== "perla-update" || project !== "LA_JOYA_PERLA")
    )
      throw new BadRequestException("Invalid mail template");
    const branded =
      dto.templateId === "perla-update"
        ? await perlaTemplate(
            perlaLanguage(recipient.language, recipient.nationality).language,
          )
        : null;
    const subject = `[TEST] ${branded ? unitEmailSubject(project, recipient.units.map(unit => unit.unitNumber)) : this.renderTemplate(subjectTemplate, recipient, project)}`;
    const message = this.renderTemplate(messageTemplate, recipient, project);
    const attachmentBundle = await this.buildAttachmentBundle(
      project,
      [recipient],
      files,
      dto.selectedAttachmentIds,
    );
    const attachments = [
      ...(branded?.attachments || []),
      ...attachmentBundle.shared,
      ...(attachmentBundle.byCustomerId.get(recipient.customerId) || []),
    ];

    const delivery = await this.email.sendMail({
      to,
      subject,
      text: branded?.text || message,
      html: branded?.html || this.toHtml(message),
      replyTo: process.env.SMTP_USER,
      attachments: attachments.length ? attachments : undefined,
    });

    return {
      ok: true,
      messageId: delivery.messageId,
      smtpAccepted: delivery.accepted?.length > 0,
      to,
      previewCustomerId: recipient.customerId,
      previewCustomerName: recipient.fullName,
      subject,
      attachmentCount: attachments.length,
    };
  }
}
