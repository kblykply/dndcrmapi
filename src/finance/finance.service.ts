import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Role } from "../common/types";

type ReqUser = { id: string; role: Role; email: string };

const KINDS = ["INCOME", "EXPENSE"] as const;
const PAYMENT_TYPES = [
  "SALE_INSTALLMENT",
  "RENTAL_INCOME",
  "CREDIT_INSTALLMENT",
  "CHECK_PAYMENT",
  "REALTOR_COMMISSION",
  "SUBCONTRACTOR",
  "INVOICE",
  "OTHER",
  "TAX",
  "SALARY",
] as const;
const STATUSES = ["PLANNED", "PAID", "OVERDUE", "CANCELED"] as const;
const CURRENCIES = ["GBP", "USD", "EUR", "TRY"] as const;
const PROJECTS = [
  "LA_JOYA",
  "LA_JOYA_PERLA",
  "LA_JOYA_PERLA_II",
  "LAGOON_VERDE",
] as const;
const SETTLEMENT_METHODS = [
  "CASH",
  "CHECK",
  "BARTER",
  "BANK_TRANSFER",
  "OTHER",
] as const;

type FinanceEntryKind = (typeof KINDS)[number];
type FinancePaymentType = (typeof PAYMENT_TYPES)[number];
type FinancePaymentStatus = (typeof STATUSES)[number];
type FinanceCurrency = (typeof CURRENCIES)[number];
type ProjectType = (typeof PROJECTS)[number];
type FinanceSettlementMethod = (typeof SETTLEMENT_METHODS)[number];

const entryInclude = {
  customer: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      oldCustomerCode: true,
    },
  },
  unitSelection: {
    select: {
      id: true,
      project: true,
      unitNumber: true,
      customer: { select: { id: true, fullName: true } },
    },
  },
  dueOptions: { orderBy: { daysFromOriginal: "asc" as const } },
  splits: {
    include: {
      unitSelection: {
        select: {
          id: true,
          project: true,
          unitNumber: true,
          customer: { select: { id: true, fullName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  createdBy: { select: { id: true, name: true, email: true, role: true } },
  updatedBy: { select: { id: true, name: true, email: true, role: true } },
};

function cleanText(value?: string | null) {
  return (value || "").trim();
}

function normalizeEnum<T extends readonly string[]>(
  value: string | null | undefined,
  allowed: T,
  label: string,
  fallback?: T[number],
): T[number] {
  const normalized = cleanText(value).toUpperCase();
  if (!normalized && fallback) return fallback;
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T[number];
  throw new BadRequestException(`Invalid ${label}`);
}

function optionalEnum<T extends readonly string[]>(
  value: string | null | undefined,
  allowed: T,
  label: string,
) {
  if (value === null || value === undefined || cleanText(value) === "") return null;
  return normalizeEnum(value, allowed, label);
}

function parseAmount(value: unknown, label = "amount") {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`${label} must be a positive number`);
  }
  return Math.round(parsed * 100) / 100;
}

function parseRatio(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new BadRequestException("Split ratio must be between 0 and 100");
  }
  return Math.round(parsed * 100) / 100;
}

function parseRate(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException("Exchange rate must be bigger than zero");
  }
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

function parseIntOption(value: unknown, fallback = 0) {
  if (value === null || value === undefined || cleanText(String(value)) === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException("Invalid day option");
  }
  return Math.max(0, Math.round(parsed));
}

function parseDate(value: string | null | undefined, label: string) {
  const raw = cleanText(value);
  if (!raw) throw new BadRequestException(`${label} is required`);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return parsed;
}

function optionalDate(value: string | null | undefined, label: string) {
  if (value === null || value === undefined || cleanText(value) === "") return null;
  return parseDate(value, label);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function dateRange(dateFrom?: string, dateTo?: string) {
  const now = new Date();
  const start = dateFrom
    ? startOfDay(parseDate(dateFrom, "dateFrom"))
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = dateTo
    ? endOfDay(parseDate(dateTo, "dateTo"))
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  if (start > end) throw new BadRequestException("dateFrom cannot be after dateTo");
  return { start, end };
}

function money(value: unknown) {
  return Number(value || 0);
}

function normalizeDueOptions(
  rows: Array<{ label?: string | null; daysFromOriginal?: number | string | null }> | null | undefined,
  originalDueDate: Date,
  selectedDays: number,
) {
  const source = Array.isArray(rows) && rows.length > 0 ? rows : [
    { daysFromOriginal: 0 },
    { daysFromOriginal: 30 },
    { daysFromOriginal: 60 },
    { daysFromOriginal: 90 },
  ];
  const map = new Map<number, string>();

  for (const row of source) {
    const days = parseIntOption(row?.daysFromOriginal, 0);
    map.set(days, cleanText(row?.label) || (days === 0 ? "Original due date" : `${days} days`));
  }

  map.set(0, map.get(0) || "Original due date");
  map.set(selectedDays, map.get(selectedDays) || (selectedDays === 0 ? "Original due date" : `${selectedDays} days`));

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([days, label]) => ({
      label,
      daysFromOriginal: days,
      dueDate: addDays(originalDueDate, days),
      isSelected: days === selectedDays,
    }));
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private serializeEntry(entry: any) {
    return {
      ...entry,
      amount: money(entry.amount),
      exchangeRateToBase:
        entry.exchangeRateToBase === null || entry.exchangeRateToBase === undefined
          ? null
          : Number(entry.exchangeRateToBase),
      dueOptions: (entry.dueOptions || []).map((option: any) => ({
        ...option,
      })),
      splits: (entry.splits || []).map((split: any) => ({
        ...split,
        ratio: Number(split.ratio || 0),
        amount:
          split.amount === null || split.amount === undefined
            ? null
            : money(split.amount),
      })),
    };
  }

  private async log(
    entryId: string,
    user: ReqUser | null,
    action: string,
    field?: string | null,
    oldValue?: unknown,
    newValue?: unknown,
  ) {
    await this.prisma.financeEntryLog.create({
      data: {
        entryId,
        action,
        field: field || null,
        oldValue:
          oldValue === null || oldValue === undefined ? null : String(oldValue),
        newValue:
          newValue === null || newValue === undefined ? null : String(newValue),
        createdById: user?.id || null,
      },
    });
  }

  private async latestRateMap(baseCurrency: FinanceCurrency) {
    const rows = await this.prisma.financeExchangeRate.findMany({
      where: { baseCurrency },
      orderBy: [{ currency: "asc" }, { effectiveDate: "desc" }],
    });
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!map.has(row.currency)) map.set(row.currency, Number(row.rateToBase));
    }
    map.set(baseCurrency, 1);
    return map;
  }

  private entryBaseAmount(entry: any, rates: Map<string, number>, baseCurrency: FinanceCurrency) {
    const amount = money(entry.amount);
    if (entry.currency === baseCurrency) return amount;
    const rate = entry.exchangeRateToBase ? Number(entry.exchangeRateToBase) : rates.get(entry.currency);
    return amount * (rate || 1);
  }

  async listEntries(query: {
    kind?: FinanceEntryKind;
    paymentType?: FinancePaymentType;
    status?: FinancePaymentStatus;
    currency?: FinanceCurrency;
    project?: ProjectType;
    dateFrom?: string;
    dateTo?: string;
    q?: string;
  }) {
    const where: any = {};
    if (query.kind) where.kind = normalizeEnum(query.kind, KINDS, "kind");
    if (query.paymentType) {
      where.paymentType = normalizeEnum(query.paymentType, PAYMENT_TYPES, "payment type");
    }
    if (query.status) where.status = normalizeEnum(query.status, STATUSES, "status");
    if (query.currency) where.currency = normalizeEnum(query.currency, CURRENCIES, "currency");
    if (query.project) where.project = normalizeEnum(query.project, PROJECTS, "project");

    if (query.dateFrom || query.dateTo) {
      const { start, end } = dateRange(query.dateFrom, query.dateTo);
      where.plannedDueDate = { gte: start, lte: end };
    }

    const q = cleanText(query.q);
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { vendorName: { contains: q, mode: "insensitive" } },
        { contractReference: { contains: q, mode: "insensitive" } },
        { customer: { fullName: { contains: q, mode: "insensitive" } } },
        { unitSelection: { unitNumber: { contains: q, mode: "insensitive" } } },
      ];
    }

    const items = await this.prisma.financeEntry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ plannedDueDate: "asc" }, { createdAt: "desc" }],
      take: 300,
    });

    return {
      items: items.map((item: any) => this.serializeEntry(item)),
      total: items.length,
    };
  }

  async getEntry(id: string) {
    const entry = await this.prisma.financeEntry.findUnique({
      where: { id },
      include: {
        ...entryInclude,
        logs: {
          include: {
            createdBy: { select: { id: true, name: true, email: true, role: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 80,
        },
      },
    });
    if (!entry) throw new NotFoundException("Finance entry not found");
    return this.serializeEntry(entry);
  }

  private async entryData(body: any, existing?: any) {
    const kind = normalizeEnum(body.kind ?? existing?.kind, KINDS, "kind");
    const paymentType = normalizeEnum(
      body.paymentType ?? existing?.paymentType,
      PAYMENT_TYPES,
      "payment type",
      kind === "INCOME" ? "SALE_INSTALLMENT" : "OTHER",
    );
    const status = normalizeEnum(
      body.status ?? existing?.status,
      STATUSES,
      "status",
      "PLANNED",
    );
    const title = cleanText(body.title ?? existing?.title);
    if (!title) throw new BadRequestException("Title is required");

    const originalDueDate =
      body.originalDueDate !== undefined
        ? parseDate(body.originalDueDate, "originalDueDate")
        : existing?.originalDueDate;
    if (!originalDueDate) throw new BadRequestException("originalDueDate is required");

    const selectedDeferralDays =
      body.selectedDeferralDays !== undefined
        ? parseIntOption(body.selectedDeferralDays, existing?.selectedDeferralDays || 0)
        : existing?.selectedDeferralDays || 0;
    const plannedDueDate =
      body.plannedDueDate !== undefined && body.selectedDeferralDays === undefined
        ? parseDate(body.plannedDueDate, "plannedDueDate")
        : addDays(originalDueDate, selectedDeferralDays);
    if (!existing && body.amount === undefined) {
      throw new BadRequestException("Amount is required");
    }
    const amount =
      body.amount !== undefined ? parseAmount(body.amount) : money(existing?.amount);

    return {
      kind,
      paymentType,
      status,
      title,
      description: cleanText(body.description ?? existing?.description) || null,
      vendorName: cleanText(body.vendorName ?? existing?.vendorName) || null,
      contractReference:
        cleanText(body.contractReference ?? existing?.contractReference) || null,
      amount,
      currency: normalizeEnum(
        body.currency ?? existing?.currency,
        CURRENCIES,
        "currency",
        "GBP",
      ),
      exchangeRateToBase:
        body.exchangeRateToBase === null || body.exchangeRateToBase === ""
          ? null
          : body.exchangeRateToBase !== undefined
            ? parseRate(body.exchangeRateToBase)
            : existing?.exchangeRateToBase
              ? Number(existing.exchangeRateToBase)
              : null,
      baseCurrency: normalizeEnum(
        body.baseCurrency ?? existing?.baseCurrency,
        CURRENCIES,
        "base currency",
        "GBP",
      ),
      originalDueDate,
      plannedDueDate,
      selectedDeferralDays,
      paidAt:
        body.paidAt !== undefined
          ? optionalDate(body.paidAt, "paidAt")
          : existing?.paidAt || null,
      customerId: cleanText(body.customerId ?? existing?.customerId) || null,
      unitSelectionId:
        cleanText(body.unitSelectionId ?? existing?.unitSelectionId) || null,
      project: optionalEnum(body.project ?? existing?.project, PROJECTS, "project"),
    };
  }

  private normalizeSplits(rows: any, amount: number, existingRows?: any[]) {
    const source =
      rows !== undefined
        ? Array.isArray(rows)
          ? rows
          : []
        : (existingRows || []).map((row) => ({
            method: row.method,
            ratio: row.ratio,
            amount: row.amount,
            unitSelectionId: row.unitSelectionId,
            note: row.note,
          }));

    return source
      .map((row: any) => {
        const ratio = parseRatio(row?.ratio ?? 0);
        if (ratio <= 0) return null;
        const method = normalizeEnum(
          row?.method,
          SETTLEMENT_METHODS,
          "settlement method",
          "CASH",
        ) as FinanceSettlementMethod;
        const explicitAmount =
          row?.amount === null || row?.amount === undefined || cleanText(String(row.amount)) === ""
            ? null
            : parseAmount(row.amount, "split amount");

        return {
          method,
          ratio,
          amount: explicitAmount ?? Math.round(amount * (ratio / 100) * 100) / 100,
          unitSelectionId: cleanText(row?.unitSelectionId) || null,
          note: cleanText(row?.note) || null,
        };
      })
      .filter(Boolean);
  }

  async createEntry(user: ReqUser, body: any) {
    const data = await this.entryData(body);
    const dueOptions = normalizeDueOptions(
      body.dueOptions,
      data.originalDueDate,
      data.selectedDeferralDays,
    );
    const splits = this.normalizeSplits(body.splits, data.amount);

    const entry = await this.prisma.financeEntry.create({
      data: {
        ...data,
        createdById: user.id,
        updatedById: user.id,
        dueOptions: { create: dueOptions },
        splits: { create: splits as any },
      },
      include: entryInclude,
    });

    await this.log(entry.id, user, "CREATE", null, null, data.title);
    return this.getEntry(entry.id);
  }

  async updateEntry(user: ReqUser, id: string, body: any) {
    const existing = await this.prisma.financeEntry.findUnique({
      where: { id },
      include: { dueOptions: true, splits: true },
    });
    if (!existing) throw new NotFoundException("Finance entry not found");

    const data = await this.entryData(body, existing);
    const dueOptions = normalizeDueOptions(
      body.dueOptions,
      data.originalDueDate,
      data.selectedDeferralDays,
    );
    const splits = this.normalizeSplits(body.splits, data.amount, existing.splits);

    const changedFields = [
      "kind",
      "paymentType",
      "status",
      "title",
      "description",
      "vendorName",
      "contractReference",
      "amount",
      "currency",
      "exchangeRateToBase",
      "baseCurrency",
      "originalDueDate",
      "plannedDueDate",
      "selectedDeferralDays",
      "paidAt",
      "customerId",
      "unitSelectionId",
      "project",
    ].filter((field) => String((existing as any)[field] ?? "") !== String((data as any)[field] ?? ""));

    const operations: any[] = [
      this.prisma.financeEntry.update({
        where: { id },
        data: { ...data, updatedById: user.id },
      }),
      this.prisma.financeEntryDueOption.deleteMany({ where: { entryId: id } }),
      this.prisma.financeEntryDueOption.createMany({
        data: dueOptions.map((option) => ({ ...option, entryId: id })),
      }),
      this.prisma.financeEntrySplit.deleteMany({ where: { entryId: id } }),
    ];

    if ((splits as any[]).length > 0) {
      operations.push(
        this.prisma.financeEntrySplit.createMany({
          data: (splits as any[]).map((split) => ({ ...split, entryId: id })),
        }),
      );
    }

    await this.prisma.$transaction(operations);

    for (const field of changedFields) {
      await this.log(id, user, "UPDATE", field, (existing as any)[field], (data as any)[field]);
    }

    return this.getEntry(id);
  }

  async selectDueOption(
    user: ReqUser,
    id: string,
    body: { optionId?: string | null; daysFromOriginal?: number | string | null },
  ) {
    const entry = await this.prisma.financeEntry.findUnique({
      where: { id },
      include: { dueOptions: true },
    });
    if (!entry) throw new NotFoundException("Finance entry not found");

    const option = body.optionId
      ? entry.dueOptions.find((row: any) => row.id === body.optionId)
      : entry.dueOptions.find(
          (row: any) => row.daysFromOriginal === parseIntOption(body.daysFromOriginal, 0),
        );
    if (!option) throw new BadRequestException("Due option not found");

    await this.prisma.$transaction([
      this.prisma.financeEntryDueOption.updateMany({
        where: { entryId: id },
        data: { isSelected: false },
      }),
      this.prisma.financeEntryDueOption.update({
        where: { id: option.id },
        data: { isSelected: true },
      }),
      this.prisma.financeEntry.update({
        where: { id },
        data: {
          selectedDeferralDays: option.daysFromOriginal,
          plannedDueDate: option.dueDate,
          updatedById: user.id,
        },
      }),
    ]);

    await this.log(
      id,
      user,
      "SELECT_DUE_OPTION",
      "plannedDueDate",
      entry.plannedDueDate,
      option.dueDate,
    );

    return this.getEntry(id);
  }

  async deleteEntry(user: ReqUser, id: string) {
    const existing = await this.prisma.financeEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Finance entry not found");
    await this.log(id, user, "DELETE", null, existing.title, null);
    await this.prisma.financeEntry.delete({ where: { id } });
    return { ok: true };
  }

  async dashboard(query: {
    dateFrom?: string;
    dateTo?: string;
    baseCurrency?: FinanceCurrency;
  }) {
    const baseCurrency = normalizeEnum(
      query.baseCurrency,
      CURRENCIES,
      "base currency",
      "GBP",
    ) as FinanceCurrency;
    const { start, end } = dateRange(query.dateFrom, query.dateTo);
    const entries = await this.prisma.financeEntry.findMany({
      where: {
        plannedDueDate: { gte: start, lte: end },
        status: { not: "CANCELED" },
      },
      include: entryInclude,
      orderBy: { plannedDueDate: "asc" },
    });
    const rates = await this.latestRateMap(baseCurrency);

    const totals = {
      income: 0,
      expense: 0,
      net: 0,
      profitRate: 0,
      planned: 0,
      paid: 0,
      overdue: 0,
      flexibleExpenses: 0,
    };
    const maxDeferralTotals = {
      income: 0,
      expense: 0,
      net: 0,
      profitRate: 0,
    };
    const byPaymentType = new Map<string, { income: number; expense: number; count: number }>();
    const byStatus = new Map<string, { income: number; expense: number; count: number }>();
    const byCurrency = new Map<string, { income: number; expense: number; count: number }>();
    const byProject = new Map<string, { income: number; expense: number; count: number }>();
    const byMonth = new Map<string, { income: number; expense: number; net: number }>();
    const byPeriod = new Map<string, { income: number; expense: number; net: number }>();
    const today = startOfDay(new Date());
    const sevenDays = addDays(today, 7);
    const thirtyDays = addDays(today, 30);
    const dueBuckets = {
      overdue: { income: 0, expense: 0, count: 0 },
      next7: { income: 0, expense: 0, count: 0 },
      next30: { income: 0, expense: 0, count: 0 },
      later: { income: 0, expense: 0, count: 0 },
    };
    const rangeDays = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const periodMode = rangeDays <= 45 ? "DAY" : "MONTH";

    const serialized = entries.map((entry: any) => {
      const baseAmount = this.entryBaseAmount(entry, rates, baseCurrency);
      if (entry.kind === "INCOME") totals.income += baseAmount;
      if (entry.kind === "EXPENSE") totals.expense += baseAmount;
      if (entry.status === "PLANNED") totals.planned += baseAmount;
      if (entry.status === "PAID") totals.paid += baseAmount;
      if (entry.status === "OVERDUE") totals.overdue += baseAmount;
      if (entry.kind === "EXPENSE" && (entry.dueOptions || []).length > 1) {
        totals.flexibleExpenses += baseAmount;
      }

      const maxDueDate =
        entry.kind === "EXPENSE" && (entry.dueOptions || []).length > 0
          ? (entry.dueOptions || []).reduce(
              (latest: Date, option: any) =>
                option.dueDate && option.dueDate > latest ? option.dueDate : latest,
              entry.plannedDueDate,
            )
          : entry.plannedDueDate;
      if (maxDueDate >= start && maxDueDate <= end) {
        if (entry.kind === "INCOME") maxDeferralTotals.income += baseAmount;
        if (entry.kind === "EXPENSE") maxDeferralTotals.expense += baseAmount;
      }

      const typeRow = byPaymentType.get(entry.paymentType) || { income: 0, expense: 0, count: 0 };
      if (entry.kind === "INCOME") typeRow.income += baseAmount;
      if (entry.kind === "EXPENSE") typeRow.expense += baseAmount;
      typeRow.count += 1;
      byPaymentType.set(entry.paymentType, typeRow);

      const statusRow = byStatus.get(entry.status) || { income: 0, expense: 0, count: 0 };
      if (entry.kind === "INCOME") statusRow.income += baseAmount;
      if (entry.kind === "EXPENSE") statusRow.expense += baseAmount;
      statusRow.count += 1;
      byStatus.set(entry.status, statusRow);

      const currencyRow = byCurrency.get(entry.currency) || { income: 0, expense: 0, count: 0 };
      if (entry.kind === "INCOME") currencyRow.income += Number(entry.amount || 0);
      if (entry.kind === "EXPENSE") currencyRow.expense += Number(entry.amount || 0);
      currencyRow.count += 1;
      byCurrency.set(entry.currency, currencyRow);

      const projectKey = entry.project || entry.unitSelection?.project || "UNSELECTED";
      const projectRow = byProject.get(projectKey) || { income: 0, expense: 0, count: 0 };
      if (entry.kind === "INCOME") projectRow.income += baseAmount;
      if (entry.kind === "EXPENSE") projectRow.expense += baseAmount;
      projectRow.count += 1;
      byProject.set(projectKey, projectRow);

      const monthKey = entry.plannedDueDate.toISOString().slice(0, 7);
      const monthRow = byMonth.get(monthKey) || { income: 0, expense: 0, net: 0 };
      if (entry.kind === "INCOME") monthRow.income += baseAmount;
      if (entry.kind === "EXPENSE") monthRow.expense += baseAmount;
      monthRow.net = monthRow.income - monthRow.expense;
      byMonth.set(monthKey, monthRow);

      const periodKey =
        periodMode === "DAY"
          ? entry.plannedDueDate.toISOString().slice(0, 10)
          : monthKey;
      const periodRow = byPeriod.get(periodKey) || { income: 0, expense: 0, net: 0 };
      if (entry.kind === "INCOME") periodRow.income += baseAmount;
      if (entry.kind === "EXPENSE") periodRow.expense += baseAmount;
      periodRow.net = periodRow.income - periodRow.expense;
      byPeriod.set(periodKey, periodRow);

      const dueBucket =
        entry.plannedDueDate < today
          ? dueBuckets.overdue
          : entry.plannedDueDate <= sevenDays
            ? dueBuckets.next7
            : entry.plannedDueDate <= thirtyDays
              ? dueBuckets.next30
              : dueBuckets.later;
      if (entry.kind === "INCOME") dueBucket.income += baseAmount;
      if (entry.kind === "EXPENSE") dueBucket.expense += baseAmount;
      dueBucket.count += 1;

      return { ...this.serializeEntry(entry), baseAmount, maxDeferralDueDate: maxDueDate };
    });

    totals.net = totals.income - totals.expense;
    totals.profitRate = totals.income > 0 ? (totals.net / totals.income) * 100 : 0;
    maxDeferralTotals.net = maxDeferralTotals.income - maxDeferralTotals.expense;
    maxDeferralTotals.profitRate =
      maxDeferralTotals.income > 0
        ? (maxDeferralTotals.net / maxDeferralTotals.income) * 100
        : 0;

    let cumulativeNet = 0;
    const periodRows = [...byPeriod.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, value]) => {
        cumulativeNet += value.net;
        return { period, ...value, cumulativeNet };
      });

    return {
      range: { dateFrom: start, dateTo: end, baseCurrency },
      totals,
      scenarios: {
        current: totals,
        maxDeferral: maxDeferralTotals,
      },
      dueBuckets,
      entries: serialized.slice(0, 120),
      byPaymentType: [...byPaymentType.entries()].map(([paymentType, value]) => ({
        paymentType,
        ...value,
        net: value.income - value.expense,
      })),
      byStatus: [...byStatus.entries()].map(([status, value]) => ({
        status,
        ...value,
        net: value.income - value.expense,
      })),
      byCurrency: [...byCurrency.entries()].map(([currency, value]) => ({
        currency,
        ...value,
        net: value.income - value.expense,
      })),
      byProject: [...byProject.entries()].map(([project, value]) => ({
        project,
        ...value,
        net: value.income - value.expense,
      })),
      byMonth: [...byMonth.entries()].map(([month, value]) => ({ month, ...value })),
      byPeriod: periodRows,
      flexibleEntries: serialized
        .filter((entry: any) => entry.kind === "EXPENSE" && entry.dueOptions.length > 1)
        .slice(0, 20),
      upcomingIncome: serialized
        .filter((entry: any) => entry.kind === "INCOME")
        .sort((a: any, b: any) => b.baseAmount - a.baseAmount)
        .slice(0, 10),
      upcomingExpenses: serialized
        .filter((entry: any) => entry.kind === "EXPENSE")
        .sort((a: any, b: any) => b.baseAmount - a.baseAmount)
        .slice(0, 10),
    };
  }

  async listExchangeRates(query: {
    baseCurrency?: FinanceCurrency;
    currency?: FinanceCurrency;
  }) {
    const where: any = {};
    if (query.baseCurrency) {
      where.baseCurrency = normalizeEnum(query.baseCurrency, CURRENCIES, "base currency");
    }
    if (query.currency) where.currency = normalizeEnum(query.currency, CURRENCIES, "currency");

    const rows = await this.prisma.financeExchangeRate.findMany({
      where,
      include: { createdBy: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
      take: 120,
    });

    return rows.map((row: any) => ({
      ...row,
      rateToBase: Number(row.rateToBase),
    }));
  }

  async createExchangeRate(user: ReqUser, body: any) {
    const currency = normalizeEnum(body.currency, CURRENCIES, "currency") as FinanceCurrency;
    const baseCurrency = normalizeEnum(
      body.baseCurrency,
      CURRENCIES,
      "base currency",
      "GBP",
    ) as FinanceCurrency;
    const rateToBase = currency === baseCurrency ? 1 : parseRate(body.rateToBase);
    const effectiveDate = body.effectiveDate
      ? parseDate(body.effectiveDate, "effectiveDate")
      : new Date();

    const row = await this.prisma.financeExchangeRate.create({
      data: {
        currency,
        baseCurrency,
        rateToBase,
        effectiveDate,
        note: cleanText(body.note) || null,
        createdById: user.id,
      },
      include: { createdBy: { select: { id: true, name: true, email: true, role: true } } },
    });

    return { ...row, rateToBase: Number(row.rateToBase) };
  }

  async customerLookup(q?: string) {
    const search = cleanText(q);
    const rows = await this.prisma.customer.findMany({
      where: {
        type: "EXISTING",
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
                { oldCustomerCode: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        oldCustomerCode: true,
      },
      orderBy: { fullName: "asc" },
      take: 80,
    });
    return rows;
  }

  async unitLookup(query: { q?: string; project?: ProjectType }) {
    const search = cleanText(query.q);
    const where: any = {
      customer: { type: "EXISTING" },
    };
    if (query.project) where.project = normalizeEnum(query.project, PROJECTS, "project");
    if (search) {
      where.OR = [
        { unitNumber: { contains: search, mode: "insensitive" } },
        { customer: { fullName: { contains: search, mode: "insensitive" } } },
      ];
    }

    const rows = await this.prisma.customerUnitSelection.findMany({
      where,
      select: {
        id: true,
        project: true,
        unitNumber: true,
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
      },
      orderBy: [{ project: "asc" }, { unitNumber: "asc" }],
      take: 120,
    });
    return rows;
  }
}
