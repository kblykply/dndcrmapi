import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type QualityProcessCategory =
  | "CONTEXT"
  | "PLANNING"
  | "LEADERSHIP"
  | "SUPPORT"
  | "OPERATIONAL"
  | "PERFORMANCE"
  | "IMPROVEMENT"
  | "CONSTRUCTION"
  | "REAL_ESTATE_SALES"
  | "VALUE";

type QualityProcessStatus = "ACTIVE" | "NEEDS_REVIEW" | "ARCHIVED";
type QualityDocumentType =
  | "PROCEDURE"
  | "POLICY"
  | "FORM"
  | "CHECKLIST"
  | "RECORD"
  | "DRAWING"
  | "CONTRACT"
  | "REPORT"
  | "OTHER";
type QualityDocumentStatus = "DRAFT" | "ACTIVE" | "NEEDS_REVIEW" | "ARCHIVED";

const QUALITY_PROCESS_CATEGORIES = [
  "CONTEXT",
  "PLANNING",
  "LEADERSHIP",
  "SUPPORT",
  "OPERATIONAL",
  "PERFORMANCE",
  "IMPROVEMENT",
  "CONSTRUCTION",
  "REAL_ESTATE_SALES",
  "VALUE",
] as const satisfies readonly QualityProcessCategory[];

const QUALITY_PROCESS_STATUSES = [
  "ACTIVE",
  "NEEDS_REVIEW",
  "ARCHIVED",
] as const satisfies readonly QualityProcessStatus[];

const QUALITY_DOCUMENT_TYPES = [
  "PROCEDURE",
  "POLICY",
  "FORM",
  "CHECKLIST",
  "RECORD",
  "DRAWING",
  "CONTRACT",
  "REPORT",
  "OTHER",
] as const satisfies readonly QualityDocumentType[];

const QUALITY_DOCUMENT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "NEEDS_REVIEW",
  "ARCHIVED",
] as const satisfies readonly QualityDocumentStatus[];

type CardBody = {
  code?: string | null;
  title?: string | null;
  description?: string | null;
  category?: QualityProcessCategory | null;
  status?: QualityProcessStatus | null;
  ownerDepartment?: string | null;
  color?: string | null;
  sortOrder?: number | string | null;
};

type ChecklistBody = {
  title?: string | null;
  description?: string | null;
  required?: boolean | null;
  isChecked?: boolean | null;
  dueAt?: string | null;
  sortOrder?: number | string | null;
};

type DocumentBody = {
  title?: string | null;
  type?: QualityDocumentType | null;
  status?: QualityDocumentStatus | null;
  revision?: string | null;
  ownerDepartment?: string | null;
  url?: string | null;
  storagePath?: string | null;
  fileName?: string | null;
  notes?: string | null;
};

const DEFAULT_CARDS: Array<{
  id: string;
  code: string;
  title: string;
  description: string;
  category: QualityProcessCategory;
  color: string;
  sortOrder: number;
}> = [
  {
    id: "qc-4-1-context",
    code: "4.1",
    title: "Kuruluşun ve Bağlamının Anlaşılması",
    description: "DND organizasyonunun iç ve dış bağlamını kalite sistemi içinde takip eder.",
    category: "CONTEXT",
    color: "#dbeafe",
    sortOrder: 410,
  },
  {
    id: "qc-4-2-interested-parties",
    code: "4.2",
    title: "İlgili Tarafların İhtiyaç ve Beklentileri",
    description: "Müşteri, tedarikçi, ekip ve resmi kurum beklentilerini yönetir.",
    category: "CONTEXT",
    color: "#dbeafe",
    sortOrder: 420,
  },
  {
    id: "qc-4-3-scope",
    code: "4.3",
    title: "Kalite Yönetim Sistemi Kapsamı",
    description: "KYS kapsamını, uygulanabilir süreçleri ve hariç tutmaları kaydeder.",
    category: "CONTEXT",
    color: "#dbeafe",
    sortOrder: 430,
  },
  {
    id: "qc-4-4-processes",
    code: "4.4",
    title: "KYS Süreçlerinin Belirlenmesi",
    description: "Süreç sahipleri, girdiler, çıktılar ve süreç ilişkilerini takip eder.",
    category: "CONTEXT",
    color: "#dbeafe",
    sortOrder: 440,
  },
  {
    id: "qc-5-leadership",
    code: "5",
    title: "Liderlik",
    description: "Yönetim taahhüdü, kalite politikası ve sorumlulukları kapsar.",
    category: "LEADERSHIP",
    color: "#dcfce7",
    sortOrder: 500,
  },
  {
    id: "qc-6-planning",
    code: "6",
    title: "Planlama",
    description: "Risk, fırsat, hedef ve değişiklik planlarını bir arada tutar.",
    category: "PLANNING",
    color: "#e0f2fe",
    sortOrder: 600,
  },
  {
    id: "qc-6-1-risk-opportunity",
    code: "6.1",
    title: "Risk ve Fırsatların Belirlenmesi",
    description: "Süreç riskleri ve iyileştirme fırsatlarını düzenli kontrol eder.",
    category: "PLANNING",
    color: "#fce7f3",
    sortOrder: 610,
  },
  {
    id: "qc-6-2-objectives",
    code: "6.2",
    title: "Hedefler ve Planlama",
    description: "Kalite hedeflerini, sorumluları ve gerçekleşme durumunu izler.",
    category: "PLANNING",
    color: "#fce7f3",
    sortOrder: 620,
  },
  {
    id: "qc-6-3-changes",
    code: "6.3",
    title: "Değişikliklerin Planlanması",
    description: "Süreç, ekip, tedarik ve doküman değişikliklerini kayıt altına alır.",
    category: "PLANNING",
    color: "#fce7f3",
    sortOrder: 630,
  },
  {
    id: "qc-7-support",
    code: "7",
    title: "Destek",
    description: "Kaynak, yetkinlik, farkındalık, iletişim ve dokümante bilgi süreçleri.",
    category: "SUPPORT",
    color: "#fef3c7",
    sortOrder: 700,
  },
  {
    id: "qc-7-1-resources",
    code: "7.1",
    title: "Kaynaklar",
    description: "İnsan, altyapı, ekipman ve çalışma ortamı ihtiyaçlarını kapsar.",
    category: "SUPPORT",
    color: "#fff7ed",
    sortOrder: 710,
  },
  {
    id: "qc-7-2-competence",
    code: "7.2",
    title: "Yeterlilik ve Yetkinlik",
    description: "Ekip yetkinlikleri, eğitim kayıtları ve görev yeterliliklerini izler.",
    category: "SUPPORT",
    color: "#fff7ed",
    sortOrder: 720,
  },
  {
    id: "qc-7-3-awareness",
    code: "7.3",
    title: "Farkındalık",
    description: "Kalite politikası, hedefler ve süreç sorumluluklarının paylaşımı.",
    category: "SUPPORT",
    color: "#fff7ed",
    sortOrder: 730,
  },
  {
    id: "qc-7-4-communication",
    code: "7.4",
    title: "İletişim",
    description: "İç ve dış iletişim kanalları, kayıtları ve sorumlulukları.",
    category: "SUPPORT",
    color: "#fff7ed",
    sortOrder: 740,
  },
  {
    id: "qc-7-5-documented-info",
    code: "7.5",
    title: "Dokümante Edilmiş Bilgi",
    description: "Prosedür, form, kayıt, revizyon ve doküman kontrol akışı.",
    category: "SUPPORT",
    color: "#fff7ed",
    sortOrder: 750,
  },
  {
    id: "qc-8-operation",
    code: "8",
    title: "Operasyon - Kurumsal Hizmetler ve İşletim",
    description: "Operasyonel süreçlerin ana kontrol kartı.",
    category: "OPERATIONAL",
    color: "#dbeafe",
    sortOrder: 800,
  },
  {
    id: "qc-8-1-operational-control",
    code: "8.1",
    title: "Operasyonel Planlama ve Kontrol",
    description: "Operasyonel kontroller, teslim kriterleri ve süreç planları.",
    category: "OPERATIONAL",
    color: "#fef9c3",
    sortOrder: 810,
  },
  {
    id: "qc-8-2-product-service-terms",
    code: "8.2",
    title: "Ürün ve Hizmetler İçin Şartlar",
    description: "Müşteri şartları, yasal şartlar ve proje beklentileri.",
    category: "OPERATIONAL",
    color: "#fef9c3",
    sortOrder: 820,
  },
  {
    id: "qc-8-3-design-development",
    code: "8.3",
    title: "Tasarım ve Geliştirme",
    description: "Tasarım girdileri, onaylar, revizyonlar ve çıktı kontrolleri.",
    category: "OPERATIONAL",
    color: "#fef9c3",
    sortOrder: 830,
  },
  {
    id: "qc-8-4-outsourced-control",
    code: "8.4",
    title: "Dışarıdan Tedarik Edilen Ürün ve Hizmetler",
    description: "Tedarikçi, taşeron ve dış hizmet kalite kontrolleri.",
    category: "OPERATIONAL",
    color: "#fef9c3",
    sortOrder: 840,
  },
  {
    id: "qc-8-5-production-service",
    code: "8.5",
    title: "Üretim ve Hizmet Sunumu",
    description: "İnşaat uygulama, teslim hazırlığı ve hizmet sunumu kontrolleri.",
    category: "OPERATIONAL",
    color: "#fef9c3",
    sortOrder: 850,
  },
  {
    id: "qc-8-6-release",
    code: "8.6",
    title: "Ürün ve Hizmetlerin Serbest Bırakılması",
    description: "Kontrol, test, teslim ve devreye alma serbest bırakma kayıtları.",
    category: "OPERATIONAL",
    color: "#fef9c3",
    sortOrder: 860,
  },
  {
    id: "qc-8-7-nonconforming-output",
    code: "8.7",
    title: "Uygun Olmayan Çıktının Kontrolü",
    description: "Uygunsuzluk, hata, eksik iş ve düzeltici faaliyet takibi.",
    category: "OPERATIONAL",
    color: "#fef9c3",
    sortOrder: 870,
  },
  {
    id: "qc-9-performance",
    code: "9",
    title: "Performans Değerlendirme",
    description: "Süreç ölçüm, analiz, iç tetkik ve yönetim gözden geçirme alanı.",
    category: "PERFORMANCE",
    color: "#e0f2fe",
    sortOrder: 900,
  },
  {
    id: "qc-9-1-monitoring",
    code: "9.1",
    title: "İzleme, Ölçme, Analiz ve Değerlendirme",
    description: "KPI, saha kontrol, memnuniyet ve süreç performans verileri.",
    category: "PERFORMANCE",
    color: "#fce7f3",
    sortOrder: 910,
  },
  {
    id: "qc-9-2-internal-audit",
    code: "9.2",
    title: "İç Tetkik",
    description: "İç denetim planları, bulgular, aksiyonlar ve takip kayıtları.",
    category: "PERFORMANCE",
    color: "#fce7f3",
    sortOrder: 920,
  },
  {
    id: "qc-9-3-management-review",
    code: "9.3",
    title: "Yönetimin Gözden Geçirmesi",
    description: "Yönetim gözden geçirme gündemi, kararları ve aksiyonları.",
    category: "PERFORMANCE",
    color: "#fce7f3",
    sortOrder: 930,
  },
  {
    id: "qc-10-improvement",
    code: "10",
    title: "İyileştirme",
    description: "Uygunsuzluk, düzeltici faaliyet ve sürekli iyileştirme yönetimi.",
    category: "IMPROVEMENT",
    color: "#e0f2fe",
    sortOrder: 1000,
  },
  {
    id: "qc-10-1-nonconformity",
    code: "10.1",
    title: "Uygunsuzluk ve Düzeltici Faaliyet",
    description: "Problem kaydı, kök neden, aksiyon ve kapanış takibi.",
    category: "IMPROVEMENT",
    color: "#e0f2fe",
    sortOrder: 1010,
  },
  {
    id: "qc-10-2-continuous-improvement",
    code: "10.2",
    title: "Sürekli İyileştirme",
    description: "Tekrarlayan iyileştirme çalışmaları ve standartlaştırma.",
    category: "IMPROVEMENT",
    color: "#e0f2fe",
    sortOrder: 1020,
  },
  {
    id: "qc-10-3-improvement-opportunities",
    code: "10.3",
    title: "İyileştirme Fırsatları",
    description: "Fırsat kayıtları ve süreç geliştirme önerileri.",
    category: "IMPROVEMENT",
    color: "#e0f2fe",
    sortOrder: 1030,
  },
  {
    id: "qc-construction-production",
    code: "İNŞAAT",
    title: "İnşaat Üretim Süreçleri",
    description: "Proje hazırlık, tasarım izin, tedarik, inşaat, kontrol ve teslim süreçleri.",
    category: "CONSTRUCTION",
    color: "#dbeafe",
    sortOrder: 2000,
  },
  {
    id: "qc-real-estate-sales",
    code: "SATIŞ",
    title: "Gayrimenkul Satış Süreçleri",
    description: "Pazarlama, müşteri ilişkileri, sözleşme, ödeme, teslim ve satış sonrası süreçleri.",
    category: "REAL_ESTATE_SALES",
    color: "#dbeafe",
    sortOrder: 2100,
  },
];

@Injectable()
export class QualityControlService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private ensureAuth(user: ReqUser) {
    if (!user?.id) {
      throw new ForbiddenException("Unauthorized");
    }
  }

  private canUse(user: ReqUser) {
    return ["ADMIN", "MANAGER", "AFTERSALES", "SALES"].includes(user.role);
  }

  private cleanStr(v?: string | null) {
    const x = String(v ?? "").trim();
    return x || null;
  }

  private parseDateOrNull(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("Invalid date");
    }
    return date;
  }

  private parseIntOrDefault(value: number | string | null | undefined, fallback: number) {
    if (value === undefined || value === null || value === "") return fallback;
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new BadRequestException("Invalid number");
    }
    return Math.trunc(num);
  }

  private parseBool(value: boolean | string | number | null | undefined, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;

    const clean = value.trim().toLowerCase();
    if (!clean) return fallback;
    if (["true", "1", "yes", "on"].includes(clean)) return true;
    if (["false", "0", "no", "off"].includes(clean)) return false;
    throw new BadRequestException("Invalid boolean");
  }

  private parseEnum<T extends string>(
    value: T | string | null | undefined,
    values: readonly T[],
    fieldName: string,
    fallback: T,
  ) {
    const clean = this.cleanStr(value);
    if (!clean) return fallback;
    if (!values.includes(clean as T)) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
    return clean as T;
  }

  private parseEnumFilter<T extends string>(
    value: T | "ALL" | string | null | undefined,
    values: readonly T[],
    fieldName: string,
  ) {
    const clean = this.cleanStr(value);
    if (!clean || clean === "ALL") return "ALL" as const;
    if (!values.includes(clean as T)) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
    return clean as T;
  }

  private assertCanUse(user: ReqUser) {
    this.ensureAuth(user);
    if (!this.canUse(user)) {
      throw new ForbiddenException("No access to quality control module");
    }
  }

  private async ensureDefaultCards() {
    await this.prisma.qualityProcessCard.createMany({
      data: DEFAULT_CARDS.map((card) => ({
        ...card,
        status: "ACTIVE" as const,
      })),
      skipDuplicates: true,
    });
  }

  private listInclude() {
    return {
      checklists: {
        select: {
          id: true,
          isChecked: true,
          required: true,
          dueAt: true,
        },
      },
      documents: {
        select: {
          id: true,
          status: true,
        },
      },
      _count: {
        select: {
          logs: true,
        },
      },
    };
  }

  private detailInclude() {
    return {
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
      updatedBy: {
        select: { id: true, name: true, email: true, role: true },
      },
      checklists: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
          checkedBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
      },
      documents: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
          updatedBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        orderBy: [{ updatedAt: "desc" as const }, { createdAt: "desc" as const }],
      },
      logs: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
        orderBy: { createdAt: "desc" as const },
        take: 80,
      },
    };
  }

  private summarizeCard(card: any) {
    const { checklists = [], documents = [], _count, ...safeCard } = card;
    const now = Date.now();
    const checklistTotal = checklists.length || 0;
    const checklistDone =
      checklists.filter((item: any) => item.isChecked).length || 0;
    const requiredTotal =
      checklists.filter((item: any) => item.required).length || 0;
    const requiredDone =
      checklists.filter((item: any) => item.required && item.isChecked).length ||
      0;
    const documentsTotal = documents.length || 0;
    const documentsNeedReview =
      documents.filter((item: any) => item.status === "NEEDS_REVIEW").length || 0;
    const overdueChecklist =
      checklists.filter((item: any) => {
        if (!item.dueAt || item.isChecked) return false;
        return new Date(item.dueAt).getTime() < now;
      }).length || 0;

    return {
      ...safeCard,
      checklistTotal,
      checklistDone,
      requiredTotal,
      requiredDone,
      documentsTotal,
      documentsNeedReview,
      overdueChecklist,
      logsTotal: _count?.logs || 0,
      completion:
        checklistTotal === 0
          ? 0
          : Math.round((checklistDone / checklistTotal) * 100),
    };
  }

  private async getCardOrThrow(id: string) {
    const card = await this.prisma.qualityProcessCard.findUnique({
      where: { id },
      include: this.detailInclude(),
    });

    if (!card) {
      throw new NotFoundException("Quality process card not found");
    }

    return card;
  }

  private async log(
    user: ReqUser,
    cardId: string,
    action: string,
    note?: string | null,
    metaJson?: any,
  ) {
    await this.prisma.qualityProcessLog.create({
      data: {
        cardId,
        createdById: user.id,
        action,
        note: this.cleanStr(note),
        metaJson: metaJson ?? null,
      },
    });

    await this.audit.log(user, action, "QualityProcessCard", cardId, metaJson);
  }

  async listCards(
    user: ReqUser,
    query?: {
      q?: string;
      category?: QualityProcessCategory | "ALL";
      status?: QualityProcessStatus | "ALL";
    },
  ) {
    this.assertCanUse(user);
    await this.ensureDefaultCards();

    const q = this.cleanStr(query?.q);
    const category = this.parseEnumFilter(
      query?.category,
      QUALITY_PROCESS_CATEGORIES,
      "category",
    );
    const status = this.parseEnumFilter(
      query?.status,
      QUALITY_PROCESS_STATUSES,
      "status",
    );

    const where: any = {
      AND: [],
    };

    if (category !== "ALL") where.AND.push({ category });
    if (status !== "ALL") where.AND.push({ status });
    if (q) {
      where.AND.push({
        OR: [
          { code: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { ownerDepartment: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    if (where.AND.length === 0) delete where.AND;

    const cards = await this.prisma.qualityProcessCard.findMany({
      where,
      include: this.listInclude(),
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });

    const items = cards.map((card) => this.summarizeCard(card));
    const totals = items.reduce(
      (acc, card) => {
        acc.cards += 1;
        acc.checklistTotal += card.checklistTotal;
        acc.checklistDone += card.checklistDone;
        acc.documents += card.documentsTotal;
        acc.documentsNeedReview += card.documentsNeedReview;
        acc.overdueChecklist += card.overdueChecklist;
        if (card.status === "NEEDS_REVIEW") acc.cardsNeedReview += 1;
        return acc;
      },
      {
        cards: 0,
        cardsNeedReview: 0,
        checklistTotal: 0,
        checklistDone: 0,
        documents: 0,
        documentsNeedReview: 0,
        overdueChecklist: 0,
      },
    );

    return {
      items,
      totals: {
        ...totals,
        completion:
          totals.checklistTotal === 0
            ? 0
            : Math.round((totals.checklistDone / totals.checklistTotal) * 100),
      },
    };
  }

  async getCard(user: ReqUser, id: string) {
    this.assertCanUse(user);
    await this.ensureDefaultCards();
    return this.getCardOrThrow(id);
  }

  async createCard(user: ReqUser, body: CardBody) {
    this.assertCanUse(user);

    const code = this.cleanStr(body.code);
    const title = this.cleanStr(body.title);

    if (!code) throw new BadRequestException("code is required");
    if (!title) throw new BadRequestException("title is required");

    const card = await this.prisma.qualityProcessCard.create({
      data: {
        code,
        title,
        description: this.cleanStr(body.description),
        category: this.parseEnum(
          body.category,
          QUALITY_PROCESS_CATEGORIES,
          "category",
          "OPERATIONAL",
        ),
        status: this.parseEnum(
          body.status,
          QUALITY_PROCESS_STATUSES,
          "status",
          "ACTIVE",
        ),
        ownerDepartment: this.cleanStr(body.ownerDepartment),
        color: this.cleanStr(body.color),
        sortOrder: this.parseIntOrDefault(body.sortOrder, 0),
        createdById: user.id,
        updatedById: user.id,
      },
      include: this.detailInclude(),
    });

    await this.log(user, card.id, "QUALITY_CARD_CREATE", "Quality card created", {
      code: card.code,
      title: card.title,
    });

    return card;
  }

  async updateCard(user: ReqUser, id: string, body: CardBody) {
    this.assertCanUse(user);
    await this.getCardOrThrow(id);

    const data: any = {
      updatedById: user.id,
    };

    if (body.code !== undefined) {
      const code = this.cleanStr(body.code);
      if (!code) throw new BadRequestException("code is required");
      data.code = code;
    }
    if (body.title !== undefined) {
      const title = this.cleanStr(body.title);
      if (!title) throw new BadRequestException("title is required");
      data.title = title;
    }
    if (body.description !== undefined) data.description = this.cleanStr(body.description);
    if (body.category !== undefined) {
      data.category = this.parseEnum(
        body.category,
        QUALITY_PROCESS_CATEGORIES,
        "category",
        "OPERATIONAL",
      );
    }
    if (body.status !== undefined) {
      data.status = this.parseEnum(
        body.status,
        QUALITY_PROCESS_STATUSES,
        "status",
        "ACTIVE",
      );
    }
    if (body.ownerDepartment !== undefined) data.ownerDepartment = this.cleanStr(body.ownerDepartment);
    if (body.color !== undefined) data.color = this.cleanStr(body.color);
    if (body.sortOrder !== undefined) {
      data.sortOrder = this.parseIntOrDefault(body.sortOrder, 0);
    }

    const updated = await this.prisma.qualityProcessCard.update({
      where: { id },
      data,
      include: this.detailInclude(),
    });

    await this.log(user, id, "QUALITY_CARD_UPDATE", "Quality card updated", {
      code: updated.code,
      title: updated.title,
      status: updated.status,
      category: updated.category,
    });

    return updated;
  }

  async createChecklistItem(user: ReqUser, cardId: string, body: ChecklistBody) {
    this.assertCanUse(user);
    await this.getCardOrThrow(cardId);

    const title = this.cleanStr(body.title);
    if (!title) throw new BadRequestException("title is required");
    const isChecked = this.parseBool(body.isChecked);

    const item = await this.prisma.qualityChecklistItem.create({
      data: {
        cardId,
        title,
        description: this.cleanStr(body.description),
        required: this.parseBool(body.required),
        isChecked,
        dueAt: this.parseDateOrNull(body.dueAt),
        checkedAt: isChecked ? new Date() : null,
        checkedById: isChecked ? user.id : null,
        sortOrder: this.parseIntOrDefault(body.sortOrder, 0),
        createdById: user.id,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        checkedBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.log(user, cardId, "QUALITY_CHECKLIST_CREATE", "Checklist item added", {
      checklistItemId: item.id,
      title: item.title,
    });

    return item;
  }

  async updateChecklistItem(
    user: ReqUser,
    cardId: string,
    itemId: string,
    body: ChecklistBody,
  ) {
    this.assertCanUse(user);
    await this.getCardOrThrow(cardId);

    const existing = await this.prisma.qualityChecklistItem.findFirst({
      where: { id: itemId, cardId },
    });

    if (!existing) {
      throw new NotFoundException("Checklist item not found");
    }

    const data: any = {};

    if (body.title !== undefined) {
      const title = this.cleanStr(body.title);
      if (!title) throw new BadRequestException("title is required");
      data.title = title;
    }
    if (body.description !== undefined) data.description = this.cleanStr(body.description);
    if (body.required !== undefined) data.required = this.parseBool(body.required);
    if (body.dueAt !== undefined) data.dueAt = this.parseDateOrNull(body.dueAt);
    if (body.sortOrder !== undefined) {
      data.sortOrder = this.parseIntOrDefault(body.sortOrder, existing.sortOrder);
    }
    if (body.isChecked !== undefined) {
      const nextChecked = this.parseBool(body.isChecked, existing.isChecked);
      data.isChecked = nextChecked;
      data.checkedAt = nextChecked ? new Date() : null;
      data.checkedById = nextChecked ? user.id : null;
    }

    const updated = await this.prisma.qualityChecklistItem.update({
      where: { id: itemId },
      data,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        checkedBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.log(user, cardId, "QUALITY_CHECKLIST_UPDATE", "Checklist item updated", {
      checklistItemId: updated.id,
      title: updated.title,
      isChecked: updated.isChecked,
    });

    return updated;
  }

  async deleteChecklistItem(user: ReqUser, cardId: string, itemId: string) {
    this.assertCanUse(user);
    await this.getCardOrThrow(cardId);

    const existing = await this.prisma.qualityChecklistItem.findFirst({
      where: { id: itemId, cardId },
    });

    if (!existing) {
      throw new NotFoundException("Checklist item not found");
    }

    await this.prisma.qualityChecklistItem.delete({ where: { id: itemId } });

    await this.log(user, cardId, "QUALITY_CHECKLIST_DELETE", "Checklist item deleted", {
      checklistItemId: itemId,
      title: existing.title,
    });

    return { ok: true };
  }

  async createDocument(user: ReqUser, cardId: string, body: DocumentBody) {
    this.assertCanUse(user);
    await this.getCardOrThrow(cardId);

    const title = this.cleanStr(body.title);
    if (!title) throw new BadRequestException("title is required");

    const document = await this.prisma.qualityDocument.create({
      data: {
        cardId,
        title,
        type: this.parseEnum(
          body.type,
          QUALITY_DOCUMENT_TYPES,
          "document type",
          "PROCEDURE",
        ),
        status: this.parseEnum(
          body.status,
          QUALITY_DOCUMENT_STATUSES,
          "document status",
          "ACTIVE",
        ),
        revision: this.cleanStr(body.revision),
        ownerDepartment: this.cleanStr(body.ownerDepartment),
        url: this.cleanStr(body.url),
        storagePath: this.cleanStr(body.storagePath),
        fileName: this.cleanStr(body.fileName),
        notes: this.cleanStr(body.notes),
        createdById: user.id,
        updatedById: user.id,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        updatedBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.log(user, cardId, "QUALITY_DOCUMENT_CREATE", "Document added", {
      documentId: document.id,
      title: document.title,
      type: document.type,
      status: document.status,
    });

    return document;
  }

  async updateDocument(
    user: ReqUser,
    cardId: string,
    documentId: string,
    body: DocumentBody,
  ) {
    this.assertCanUse(user);
    await this.getCardOrThrow(cardId);

    const existing = await this.prisma.qualityDocument.findFirst({
      where: { id: documentId, cardId },
    });

    if (!existing) {
      throw new NotFoundException("Document not found");
    }

    const data: any = {
      updatedById: user.id,
    };

    if (body.title !== undefined) {
      const title = this.cleanStr(body.title);
      if (!title) throw new BadRequestException("title is required");
      data.title = title;
    }
    if (body.type !== undefined) {
      data.type = this.parseEnum(
        body.type,
        QUALITY_DOCUMENT_TYPES,
        "document type",
        "PROCEDURE",
      );
    }
    if (body.status !== undefined) {
      data.status = this.parseEnum(
        body.status,
        QUALITY_DOCUMENT_STATUSES,
        "document status",
        "ACTIVE",
      );
    }
    if (body.revision !== undefined) data.revision = this.cleanStr(body.revision);
    if (body.ownerDepartment !== undefined) data.ownerDepartment = this.cleanStr(body.ownerDepartment);
    if (body.url !== undefined) data.url = this.cleanStr(body.url);
    if (body.storagePath !== undefined) data.storagePath = this.cleanStr(body.storagePath);
    if (body.fileName !== undefined) data.fileName = this.cleanStr(body.fileName);
    if (body.notes !== undefined) data.notes = this.cleanStr(body.notes);

    const updated = await this.prisma.qualityDocument.update({
      where: { id: documentId },
      data,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
        updatedBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.log(user, cardId, "QUALITY_DOCUMENT_UPDATE", "Document updated", {
      documentId: updated.id,
      title: updated.title,
      type: updated.type,
      status: updated.status,
    });

    return updated;
  }

  async deleteDocument(user: ReqUser, cardId: string, documentId: string) {
    this.assertCanUse(user);
    await this.getCardOrThrow(cardId);

    const existing = await this.prisma.qualityDocument.findFirst({
      where: { id: documentId, cardId },
    });

    if (!existing) {
      throw new NotFoundException("Document not found");
    }

    await this.prisma.qualityDocument.delete({ where: { id: documentId } });

    await this.log(user, cardId, "QUALITY_DOCUMENT_DELETE", "Document deleted", {
      documentId,
      title: existing.title,
    });

    return { ok: true };
  }

  async addLog(user: ReqUser, cardId: string, note?: string | null) {
    this.assertCanUse(user);
    await this.getCardOrThrow(cardId);

    const cleanNote = this.cleanStr(note);
    if (!cleanNote) {
      throw new BadRequestException("note is required");
    }

    await this.log(user, cardId, "QUALITY_NOTE_CREATE", cleanNote, {});

    return this.prisma.qualityProcessLog.findFirst({
      where: {
        cardId,
        createdById: user.id,
        action: "QUALITY_NOTE_CREATE",
        note: cleanNote,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
