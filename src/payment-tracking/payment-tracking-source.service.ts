import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LogoDatabaseService } from '../logo-database/logo-database.service';
import {
  PaymentTrackingCatalogService,
  PAYMENT_DATABASE,
  PAYMENT_PLAN_VIEW,
  PAYMENT_ATTRIBUTE_VIEW,
  PAYMENT_CONTACT_VIEW,
} from './payment-tracking-catalog.service';
import type { PaymentViewMetadata } from './payment-tracking-catalog.service';
import { paymentTrackingToday as reportToday } from './payment-tracking-date';
import { paymentKindForProject } from './payment-tracking-kind';
import {
  readPaymentSourceAudit,
  sourceAuditIdentity,
} from './payment-tracking-source-audit';
import type {
  PaymentContact,
  PaymentIdentity,
  PaymentInstallment,
  PaymentSourceCase,
  PaymentSourceSnapshot,
} from './payment-tracking.types';

const SOURCE_DATABASE = PAYMENT_DATABASE;
const SOURCE_SCHEMA = 'dbo';
const SOURCE_VIEW = PAYMENT_PLAN_VIEW;
const SOURCE_QUALIFIED_NAME = '[LOGO_DND].[dbo].[L_223_ODEME_PLANI]';
const AUTHORIZATION_VIEW = PAYMENT_ATTRIBUTE_VIEW;
const AUTHORIZATION_QUALIFIED_NAME = '[LOGO_DND].[dbo].[L_223_FATURA_VADE]';
const CONTACT_QUALIFIED_NAME = '[LOGO_DND].[dbo].[L_223_OZET_SATIS]';
const SOURCE_ROW_LIMIT = 25_000;
const SOURCE_TTL_MS = 30_000;
const SOURCE_MAX_AGE_MS = 300_000;
const SOURCE_RETRY_BACKOFF_MS = 15_000;
const SOURCE_REFRESH_POLL_MS = 3_000;
const SOURCE_ACTIVE_WINDOW_MS = 120_000;
const SOURCE_IDLE_REFRESH_MS = 120_000;
const COLUMNS = {
  CARIKODU: { column: 'CARİ KOD', kind: 'text' },
  CARIADI: { column: 'CARİ ADI', kind: 'text' },
  DAIRE: { column: 'DAİRE', kind: 'text' },
  DAIREADI: { column: 'DAİRE ADI', kind: 'text' },
  PROJEKODU: { column: 'PROJE KOD', kind: 'text' },
  VADE: { column: 'VADE', kind: 'date' },
  DVZ: { column: 'DVZ', kind: 'text' },
  TOPLAMTUTAR: { column: 'TUTAR', kind: 'number' },
  TOPLAMODENEN: { column: 'ODENEN', kind: 'number' },
} as const;
const AUTHORIZATION_COLUMNS = {
  CARIKODU: { column: 'CARİ KOD', kind: 'text' },
  DAIRE: { column: 'DAİRE', kind: 'text' },
  DVZ: { column: 'DVZ', kind: 'text' },
  YETKIKODU: { column: 'YETKİ_KODU', kind: 'text' },
  FATURAOK: { column: 'FAT_OK', kind: 'text' },
  SATISTEMSILCISIKODU: { column: 'SE_KODU', kind: 'text' },
  EMLAKCIKODU: { column: 'BROKER', kind: 'text' },
  FATURATARIHI: { column: 'FAT TARİHİ', kind: 'date' },
} as const;
const CONTACT_COLUMNS = {
  customerCode: { column: 'CARİ KOD', kind: 'text' },
  email: { column: 'MAIL', kind: 'text' },
  phone: { column: 'TELEFON', kind: 'text' },
} as const;
type SourceRow = Record<keyof typeof COLUMNS, unknown>;
type FinancialRead = { rows: SourceRow[]; readAt: Date };
type AuthorizationRow = Record<
  keyof typeof AUTHORIZATION_COLUMNS | 'RAW_COUNT',
  unknown
>;
type CaseAttributes = {
  codes: Set<string>;
  hasBlank: boolean;
  invoiceOkValues: Set<string>;
  invoiceOkHasBlank: boolean;
  representatives: Set<string>;
  brokers: Set<string>;
  invoiceDates: Set<string>;
};
type AuthorizationRead = {
  available: boolean;
  byCase: Map<string, CaseAttributes>;
};
function selection(columns: Record<string, { column: string }>): string {
  return Object.entries(columns)
    .map(([alias, field]) => `[v].[${field.column}] AS [${alias}]`)
    .join(', ');
}
type NormalizedRow = PaymentInstallment & {
  incomplete: boolean;
  overdueAmount: number | null;
  dueTodayAmount: number | null;
};
type Group = {
  identity: PaymentIdentity;
  customerNames: Set<string>;
  unitNames: Set<string>;
  projects: Map<string, { code: string; name: string }>;
  representatives: Set<string>;
  brokers: Set<string>;
  invoiceDates: Set<string>;
  rows: NormalizedRow[];
};

/** Exact source identity only. Never use mutable money, dates or a row's display position. */
export function paymentTrackingCaseKey(identity: PaymentIdentity): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'payment-tracking-case-logo-v2',
        SOURCE_DATABASE,
        SOURCE_SCHEMA,
        223,
        1,
        identity.customerCode,
        identity.unitCode,
        identity.currency,
      ]),
      'utf8',
    )
    .digest('hex');
}
function unavailable(code: string, message: string): never {
  throw new ServiceUnavailableException({ code, message });
}
function sourceText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    return unavailable(
      'PAYMENT_TRACKING_SOURCE_VALUE_INVALID',
      'Ödeme kaynağındaki metin alanları doğrulanamadı.',
    );
  return value;
}
function sourceIdentity(row: SourceRow | AuthorizationRow): PaymentIdentity {
  return {
    customerCode: sourceText(row.CARIKODU),
    unitCode: sourceText(row.DAIRE),
    currency: sourceText(row.DVZ),
  };
}
function matchesSourceSchema(
  view: PaymentViewMetadata,
  name: string,
  qualifiedName: string,
  columns: Record<string, { column: string; kind: string }>,
): boolean {
  return (
    view.available &&
    view.database === SOURCE_DATABASE &&
    view.schema === SOURCE_SCHEMA &&
    view.name === name &&
    view.sourceKind === 'VIEW' &&
    view.qualifiedName === qualifiedName &&
    Object.values(columns).every((field) =>
      view.columns.some(
        (column) => column.name === field.column && column.kind === field.kind,
      ),
    )
  );
}
function sourceAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  // The verified source fields are SQL numbers. Text, NaN and infinities must not become zero.
  if (typeof value !== 'number' || !Number.isFinite(value))
    return unavailable(
      'PAYMENT_TRACKING_SOURCE_AMOUNT_INVALID',
      'Ödeme kaynağındaki tutar alanları doğrulanamadı.',
    );
  return value;
}
function sourceDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed =
    value instanceof Date
      ? value
      : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)
        ? new Date(value)
        : null;
  if (
    !parsed ||
    !Number.isFinite(parsed.getTime()) ||
    (typeof value === 'string' &&
      parsed.toISOString().slice(0, 10) !== value.slice(0, 10))
  )
    return unavailable(
      'PAYMENT_TRACKING_SOURCE_DATE_INVALID',
      'Ödeme kaynağındaki tarih alanları doğrulanamadı.',
    );
  // SQL datetime is the original civil date, not a UTC instant to shift into another day.
  return parsed.toISOString().slice(0, 10);
}
/** Match SQL SUM: a partial known subtotal is accompanied by incompleteRows; all unknown stays null. */
function sumKnown(values: Array<number | null>): number | null {
  let total: number | null = null;
  for (const value of values) if (value !== null) total = (total ?? 0) + value;
  if (total !== null && !Number.isFinite(total))
    return unavailable(
      'PAYMENT_TRACKING_SOURCE_AMOUNT_INVALID',
      'Ödeme kaynağındaki toplam tutar doğrulanamadı.',
    );
  return total;
}
function compareText(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}
function normalizedRow(
  row: SourceRow,
  sequence: number,
  today: string,
): NormalizedRow {
  const amount = sourceAmount(row.TOPLAMTUTAR);
  const paid = sourceAmount(row.TOPLAMODENEN);
  const dueDate = sourceDate(row.VADE);
  const currency = sourceText(row.DVZ);
  const balance = amount === null || paid === null ? null : amount - paid;
  if (balance !== null && !Number.isFinite(balance))
    return unavailable(
      'PAYMENT_TRACKING_SOURCE_AMOUNT_INVALID',
      'Ödeme kaynağındaki kalan tutar doğrulanamadı.',
    );
  const outstanding = balance === null ? null : Math.max(balance, 0);
  const status =
    balance === null
      ? 'unknown'
      : balance <= 0
        ? 'paid'
        : dueDate === null
          ? 'unknown'
          : dueDate < today
            ? 'overdue'
            : dueDate === today
              ? 'today'
              : 'upcoming';
  const timedUnknown = balance === null || (balance > 0 && dueDate === null);
  const overdueDays =
    status === 'overdue'
      ? Math.round((Date.parse(today) - Date.parse(dueDate!)) / 86_400_000)
      : 0;
  return {
    sequence,
    projectCode: sourceText(row.PROJEKODU),
    paymentKind: paymentKindForProject(sourceText(row.PROJEKODU)),
    dueDate,
    amount,
    paid,
    outstanding,
    overdueDays,
    status,
    incomplete:
      amount === null || paid === null || dueDate === null || !currency?.trim(),
    overdueAmount: timedUnknown ? null : status === 'overdue' ? outstanding : 0,
    dueTodayAmount: timedUnknown ? null : status === 'today' ? outstanding : 0,
  };
}
function sourceCase(
  key: string,
  group: Group,
  today: string,
  authorization: PaymentSourceCase['authorization'],
  invoiceOk: NonNullable<PaymentSourceCase['invoiceOk']>,
): PaymentSourceCase {
  const customerNames = [...group.customerNames].sort(compareText);
  const unitNames = [...group.unitNames].sort(compareText);
  const projects = [...group.projects.values()].sort(
    (a, b) => compareText(a.code, b.code) || compareText(a.name, b.name),
  );
  const sorted = [...group.rows].sort((a, b) =>
    a.dueDate === b.dueDate
      ? a.sequence - b.sequence
      : a.dueDate === null
        ? 1
        : b.dueDate === null
          ? -1
          : compareText(a.dueDate, b.dueDate),
  );
  const openDates = sorted
    .filter(
      (row) =>
        row.outstanding !== null && row.outstanding > 0 && row.dueDate !== null,
    )
    .map((row) => row.dueDate!);
  const { identity } = group;
  const canTrack =
    Boolean(identity.customerCode?.trim()) &&
    Boolean(identity.unitCode?.trim()) &&
    Boolean(identity.currency?.trim());
  return {
    key,
    identity,
    customerName:
      customerNames.join(' · ') ||
      identity.customerCode ||
      'Bilinmeyen müşteri',
    unitName: unitNames.join(' · ') || identity.unitCode || 'Bilinmeyen daire',
    customerNames,
    unitNames,
    projects,
    representatives: [...group.representatives].sort(compareText),
    brokers: [...group.brokers].sort(compareText),
    invoiceDates: [...group.invoiceDates].sort(compareText),
    authorization,
    invoiceOk,
    installmentCount: sorted.length,
    incompleteRows: sorted.filter((row) => row.incomplete).length,
    amount: sumKnown(sorted.map((row) => row.amount)),
    paid: sumKnown(sorted.map((row) => row.paid)),
    outstanding: sumKnown(sorted.map((row) => row.outstanding)),
    overdueAmount: sumKnown(sorted.map((row) => row.overdueAmount)),
    overdueCount: sorted.filter((row) => row.status === 'overdue').length,
    dueTodayAmount: sumKnown(sorted.map((row) => row.dueTodayAmount)),
    oldestDueDate: openDates[0] ?? null,
    nextDueDate: openDates.find((date) => date >= today) ?? null,
    overdueDays: sorted.reduce(
      (days, row) => Math.max(days, row.overdueDays),
      0,
    ),
    canTrack,
    trackingIssue: canTrack
      ? null
      : 'Logo cari, daire veya döviz kodu eksik. Bu grup yalnız okunabilir; takip kaydı açılamaz.',
    // Sequence is presentation only and is rebuilt after sorting. Duplicate source rows remain separate.
    installments: sorted.map((row, index) => ({
      sequence: index + 1,
      projectCode: row.projectCode,
      paymentKind: row.paymentKind,
      dueDate: row.dueDate,
      amount: row.amount,
      paid: row.paid,
      outstanding: row.outstanding,
      overdueDays: row.overdueDays,
      status: row.status,
    })),
  };
}

@Injectable()
export class PaymentTrackingSourceService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private cached: { expiresAt: number; value: PaymentSourceSnapshot } | null =
    null;
  private loading: Promise<PaymentSourceSnapshot> | null = null;
  private retryAt = 0;
  private refreshFailed = false;
  private backgroundStarted = false;
  private destroyed = false;
  private backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUserReadAt: number | null = null;
  private lastRefreshFinishedAt: number | null = null;
  constructor(
    private readonly database: LogoDatabaseService,
    private readonly catalog: PaymentTrackingCatalogService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.backgroundStarted || this.destroyed) return;
    this.backgroundStarted = true;
    // Do not delay HTTP startup. The first user shares this same in-flight read.
    void this.refresh().catch(() => undefined);
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.clearBackgroundTimer();
  }

  private clearBackgroundTimer(): void {
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
    this.backgroundTimer = null;
  }

  private nextBackgroundReadAt(now: number): number | null {
    if (this.lastRefreshFinishedAt === null) return null;
    const active =
      this.lastUserReadAt !== null &&
      now - this.lastUserReadAt < SOURCE_ACTIVE_WINDOW_MS;
    return Math.max(
      this.lastRefreshFinishedAt +
        (active ? SOURCE_TTL_MS : SOURCE_IDLE_REFRESH_MS),
      this.retryAt,
    );
  }

  private scheduleBackgroundRefresh(): void {
    this.clearBackgroundTimer();
    if (!this.backgroundStarted || this.destroyed || this.loading) return;
    const now = Date.now();
    const nextAt = this.nextBackgroundReadAt(now);
    if (nextAt === null) return;
    this.backgroundTimer = setTimeout(
      () => {
        this.backgroundTimer = null;
        if (this.destroyed) return;
        // Activity may have expired while the timer was waiting. Scheduled reads
        // never mark the application active or bypass the failure backoff.
        const currentNow = Date.now();
        const currentNextAt = this.nextBackgroundReadAt(currentNow);
        if (currentNextAt === null) return;
        if (currentNow < currentNextAt) {
          this.scheduleBackgroundRefresh();
          return;
        }
        void this.refresh().catch(() => undefined);
      },
      Math.max(1, nextAt - now),
    );
    this.backgroundTimer.unref();
  }

  async snapshot(forceFresh = false): Promise<PaymentSourceSnapshot> {
    const now = Date.now();
    this.lastUserReadAt = now;
    this.scheduleBackgroundRefresh();
    const cached = this.cached;
    if (
      !forceFresh &&
      cached &&
      cached.value.asOf === reportToday() &&
      now - Date.parse(cached.value.generatedAt) < SOURCE_MAX_AGE_MS
    ) {
      // Cached readers must not queue behind an in-flight refresh, including a forced one.
      if (this.loading)
        return this.withFreshness(
          cached.value,
          'refreshing',
          SOURCE_REFRESH_POLL_MS,
        );
      if (this.refreshFailed && this.retryAt > now)
        return this.withFreshness(cached.value, 'stale', this.retryAt - now);
      if (!this.refreshFailed && cached.expiresAt > now)
        return this.withFreshness(cached.value, 'fresh', null);
      // A background error is recorded by refresh(); attaching a handler prevents unhandled rejection.
      void this.refresh().catch(() => undefined);
      return this.withFreshness(
        cached.value,
        'refreshing',
        SOURCE_REFRESH_POLL_MS,
      );
    }
    // Writes, explicit refresh, expired snapshots and a new local day always await current SQL.
    return this.withFreshness(await this.refresh(), 'fresh', null);
  }

  private withFreshness(
    value: PaymentSourceSnapshot,
    status: 'fresh' | 'refreshing' | 'stale',
    retryAfterMs: number | null,
  ): PaymentSourceSnapshot {
    return {
      ...structuredClone(value),
      freshness: {
        status,
        retryAfterMs,
        maxAgeSeconds: SOURCE_MAX_AGE_MS / 1000,
      },
    };
  }

  private refresh(): Promise<PaymentSourceSnapshot> {
    if (this.loading) return this.loading;
    this.clearBackgroundTimer();
    const pending = this.readSnapshot()
      .then(
        (value) => {
          this.cached = {
            value,
            expiresAt: Date.parse(value.generatedAt) + SOURCE_TTL_MS,
          };
          this.retryAt = 0;
          this.refreshFailed = false;
          return value;
        },
        (error: unknown) => {
          const response: unknown =
            error instanceof ServiceUnavailableException
              ? error.getResponse()
              : null;
          if (
            response !== null &&
            typeof response === 'object' &&
            'code' in response &&
            response.code === 'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID'
          ) {
            // An observed data-integrity failure must not reappear as a stale
            // financial snapshot. Connectivity failures keep the normal age cap.
            this.cached = null;
          }
          this.retryAt = Date.now() + SOURCE_RETRY_BACKOFF_MS;
          this.refreshFailed = true;
          throw error;
        },
      )
      .finally(() => {
        if (this.loading === pending) {
          this.loading = null;
          this.lastRefreshFinishedAt = Date.now();
          this.scheduleBackgroundRefresh();
        }
      });
    this.loading = pending;
    return pending;
  }

  private async readFinancialRows(): Promise<FinancialRead> {
    const view = await this.catalog.requireView(SOURCE_VIEW);
    if (!matchesSourceSchema(view, SOURCE_VIEW, SOURCE_QUALIFIED_NAME, COLUMNS))
      return unavailable(
        'PAYMENT_TRACKING_SOURCE_SCHEMA_CHANGED',
        'Ödeme takibi için doğrulanmış LOGO_DND görünümü ve kolonları gerekli.',
      );
    const rows = await this.database.query<SourceRow>(
      `SELECT TOP (${SOURCE_ROW_LIMIT + 1}) ${selection(COLUMNS)} FROM ${SOURCE_QUALIFIED_NAME} AS [v]`,
    );
    const readAt = new Date();
    if (rows.length > SOURCE_ROW_LIMIT)
      return unavailable(
        'PAYMENT_TRACKING_SOURCE_LIMIT_EXCEEDED',
        'Ödeme kaynağı güvenli okuma sınırını aştı. Eksik bir liste gösterilmedi.',
      );
    return { rows, readAt };
  }

  private async readSnapshot(): Promise<PaymentSourceSnapshot> {
    // Money stays in the verified VIEW. The independent aggregate audit blocks
    // duplicate/cancelled source components without changing its KDV selection.
    const [financialResult, authorizationResult, auditResult] =
      await Promise.allSettled([
        this.readFinancialRows(),
        this.readAuthorization(),
        readPaymentSourceAudit(this.database),
      ]);
    if (auditResult.status === 'rejected') throw auditResult.reason;
    const audit = auditResult.value;
    const authorization: AuthorizationRead =
      authorizationResult.status === 'fulfilled'
        ? authorizationResult.value
        : { available: false, byCase: new Map() };
    let financial: FinancialRead;
    if (financialResult.status === 'fulfilled')
      financial = financialResult.value;
    else {
      const error: unknown = financialResult.reason;
      const response: unknown =
        error instanceof ServiceUnavailableException
          ? error.getResponse()
          : null;
      const databaseUnavailable =
        response !== null &&
        typeof response === 'object' &&
        'code' in response &&
        response.code === 'LOGO_DB_UNAVAILABLE';
      // An optional query failure may reset the shared pool. Retry finance once after both settle.
      // Schema, row limits and malformed values must never trigger a financial retry.
      if (!this.destroyed && !authorization.available && databaseUnavailable)
        financial = await this.readFinancialRows();
      else throw error;
    }
    const { rows, readAt } = financial;
    if (rows.length > audit.paymentRows)
      return unavailable(
        'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID',
        'Logo ödeme satırları denetlenen kaynakla uyuşmuyor. Eksik veya çoğalmış tutarlar gösterilmedi.',
      );
    const now = new Date();
    const today = reportToday(now);
    const groups = new Map<string, Group>();
    for (const row of rows) {
      const identity = sourceIdentity(row);
      const key = paymentTrackingCaseKey(identity);
      const group = groups.get(key) ?? {
        identity,
        customerNames: new Set<string>(),
        unitNames: new Set<string>(),
        projects: new Map<string, { code: string; name: string }>(),
        representatives: new Set<string>(),
        brokers: new Set<string>(),
        invoiceDates: new Set<string>(),
        rows: [],
      };
      const customerName = sourceText(row.CARIADI);
      const unitName = sourceText(row.DAIREADI);
      if (customerName?.trim()) group.customerNames.add(customerName);
      if (unitName?.trim()) group.unitNames.add(unitName);
      const project = {
        code: sourceText(row.PROJEKODU) ?? '',
        name: '',
      };
      if (project.code || project.name)
        group.projects.set(
          JSON.stringify([project.code, project.name]),
          project,
        );
      group.rows.push(normalizedRow(row, group.rows.length + 1, today));
      groups.set(key, group);
    }
    const cases = [...groups]
      .map(([key, group]) => {
        const attributes = authorization.byCase.get(key);
        if (attributes) {
          group.representatives = attributes.representatives;
          group.brokers = attributes.brokers;
          group.invoiceDates = attributes.invoiceDates;
        }
        const status = !authorization.available
          ? 'unavailable'
          : attributes
            ? 'matched'
            : 'unmatched';
        const item = sourceCase(
          key,
          group,
          today,
          {
            status,
            codes: attributes ? [...attributes.codes].sort(compareText) : [],
            hasBlank: attributes?.hasBlank ?? false,
          },
          {
            status,
            values: attributes
              ? [...attributes.invoiceOkValues].sort(compareText)
              : [],
            hasBlank: attributes?.invoiceOkHasBlank ?? false,
          },
        );
        return {
          ...item,
          sourceReview:
            audit.reviews.get(sourceAuditIdentity(item.identity)) ?? null,
        };
      })
      .sort((a, b) => compareText(a.key, b.key));
    return {
      database: SOURCE_DATABASE,
      view: SOURCE_VIEW,
      generatedAt: readAt.toISOString(),
      importedAt: (this.database as LogoDatabaseService & { importedAt?: string | null }).importedAt ?? null,
      asOf: today,
      recordCount: rows.length,
      audit: {
        ...audit.summary,
        reviewCaseCount: cases.filter((item) => item.sourceReview !== null)
          .length,
      },
      authorizationSource: {
        view: AUTHORIZATION_VIEW,
        status: authorization.available ? 'available' : 'unavailable',
        matchedCases: cases.filter(
          (item) => item.authorization.status === 'matched',
        ).length,
        unmatchedCases: cases.filter(
          (item) => item.authorization.status === 'unmatched',
        ).length,
        multipleCodeCases: cases.filter(
          (item) => item.authorization.codes.length > 1,
        ).length,
        message: authorization.available
          ? null
          : 'Logo fatura ayrıntıları okunamadı. Ödeme bilgileri gösteriliyor; yetki kodu, temsilci, emlakçı ve fatura tarihi filtreleri geçici olarak kullanılamıyor.',
      },
      cases,
    };
  }

  async contact(customerCode: string | null): Promise<PaymentContact> {
    const empty: PaymentContact = {
      email: null,
      phone: null,
      source: null,
      status: 'missing',
    };
    if (!customerCode?.trim()) return empty;
    try {
      const view = await this.catalog.requireView(PAYMENT_CONTACT_VIEW);
      if (
        !matchesSourceSchema(
          view,
          PAYMENT_CONTACT_VIEW,
          CONTACT_QUALIFIED_NAME,
          CONTACT_COLUMNS,
        )
      )
        return { ...empty, status: 'unavailable' };
      const rows = await this.database.query<
        Record<keyof typeof CONTACT_COLUMNS, unknown>
      >(
        `SELECT TOP (101) ${selection(CONTACT_COLUMNS)} FROM ${CONTACT_QUALIFIED_NAME} AS [v] WHERE [v].[CARİ KOD]=@customerCode`,
        { customerCode },
      );
      if (rows.length > 100) return { ...empty, status: 'ambiguous' };
      // SQL collation may match differently cased codes. Preserve exact source-code identity.
      const matches = rows.filter(
        (row) => sourceText(row.customerCode) === customerCode,
      );
      const emails = new Set(
        matches
          .map((row) => sourceText(row.email)?.trim())
          .filter((value): value is string => Boolean(value)),
      );
      const phones = new Set(
        matches
          .map((row) => sourceText(row.phone)?.trim())
          .filter((value): value is string => Boolean(value)),
      );
      if (emails.size > 1 || phones.size > 1)
        return { ...empty, status: 'ambiguous' };
      const email = [...emails][0] ?? null;
      const phone = [...phones][0] ?? null;
      return {
        email,
        phone,
        status: email || phone ? 'matched' : 'missing',
        source: matches.length ? 'Logo · tam cari kodu eşleşmesi' : null,
      };
    } catch {
      return { ...empty, status: 'unavailable' };
    }
  }

  private async readAuthorization(): Promise<AuthorizationRead> {
    try {
      const view = await this.catalog.requireView(AUTHORIZATION_VIEW);
      if (
        !matchesSourceSchema(
          view,
          AUTHORIZATION_VIEW,
          AUTHORIZATION_QUALIFIED_NAME,
          AUTHORIZATION_COLUMNS,
        )
      )
        return { available: false, byCase: new Map() };
      const aliases = Object.keys(AUTHORIZATION_COLUMNS)
        .map((alias) => `[${alias}]`)
        .join(', ');
      const exactTextGroups = Object.entries(AUTHORIZATION_COLUMNS)
        .filter(([, field]) => field.kind === 'text')
        .map(([alias]) => `CONVERT(varbinary(max), [${alias}])`)
        .join(', ');
      // Bound raw rows before grouping; binary keys preserve case and trailing spaces.
      // The cap also makes the bigint count safe to return as a SQL int / JS number.
      const rows = await this.database.query<AuthorizationRow>(
        `WITH [raw] AS (SELECT TOP (${SOURCE_ROW_LIMIT + 1}) ${selection(AUTHORIZATION_COLUMNS)} FROM ${AUTHORIZATION_QUALIFIED_NAME} AS [v]) SELECT ${aliases}, CONVERT(int, COUNT_BIG(*)) AS [RAW_COUNT] FROM [raw] GROUP BY ${aliases}, ${exactTextGroups}`,
      );
      if (rows.length > SOURCE_ROW_LIMIT)
        return { available: false, byCase: new Map() };
      const byCase: AuthorizationRead['byCase'] = new Map();
      let rawCount = 0;
      for (const row of rows) {
        if (
          typeof row.RAW_COUNT !== 'number' ||
          !Number.isSafeInteger(row.RAW_COUNT) ||
          row.RAW_COUNT < 1
        )
          return { available: false, byCase: new Map() };
        rawCount += row.RAW_COUNT;
        if (rawCount > SOURCE_ROW_LIMIT)
          return { available: false, byCase: new Map() };
        const key = paymentTrackingCaseKey(sourceIdentity(row));
        const attributes = byCase.get(key) ?? {
          codes: new Set<string>(),
          hasBlank: false,
          invoiceOkValues: new Set<string>(),
          invoiceOkHasBlank: false,
          representatives: new Set<string>(),
          brokers: new Set<string>(),
          invoiceDates: new Set<string>(),
        };
        const code = sourceText(row.YETKIKODU);
        if (code?.trim()) attributes.codes.add(code);
        else attributes.hasBlank = true;
        const invoiceOk = sourceText(row.FATURAOK);
        if (invoiceOk?.trim()) attributes.invoiceOkValues.add(invoiceOk);
        else attributes.invoiceOkHasBlank = true;
        const representative = sourceText(row.SATISTEMSILCISIKODU);
        const broker = sourceText(row.EMLAKCIKODU);
        const invoiceDate = sourceDate(row.FATURATARIHI);
        if (representative?.trim())
          attributes.representatives.add(representative);
        if (broker?.trim()) attributes.brokers.add(broker);
        if (invoiceDate) attributes.invoiceDates.add(invoiceDate);
        byCase.set(key, attributes);
      }
      return { available: true, byCase };
    } catch {
      // An unavailable optional dimension never hides valid financial rows or reuses stale codes.
      return { available: false, byCase: new Map() };
    }
  }
}
