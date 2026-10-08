import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PROJECT_LABELS, PROJECT_TYPES } from '../common/projects';
import { paymentTrackingDate } from './payment-tracking-date';
import { selectPaymentKind } from './payment-tracking-kind';
import { paymentProjectGroups } from './payment-tracking-project';
import {
  invoiceOkFilterOptions,
  matchesInvoiceOk,
  parseInvoiceOkFilter,
  requireInvoiceOkSource,
} from './payment-tracking-invoice-ok';
import { PaymentTrackingSourceService } from './payment-tracking-source.service';
import type {
  PaymentInstallment,
  PaymentKindFilter,
  PaymentProjectGroup,
  PaymentProjectGroupFilter,
  PaymentSourceCase,
  PaymentSourceSnapshot,
} from './payment-tracking.types';
import type {
  CollectionAgingBucket,
  CollectionAgingKey,
  CollectionBreakdown,
  CollectionCaseMonth,
  CollectionDetailScope,
  CollectionOverdueConcentration,
  CollectionPerformanceTotals,
  CollectionProjectInsight,
  CollectionRepresentativeBreakdown,
  CollectionRepresentativeState,
  CollectionTotals,
  PaymentCollectionReport,
} from './payment-collection-report.types';

const AUTH_STATES = [
  'all',
  'coded',
  'blank',
  'mixed',
  'unmatched',
  'multiple',
] as const;
const AGING_KEYS = ['1_30', '31_60', '61_90', '90_plus'] as const;
type AuthorizationState = (typeof AUTH_STATES)[number];
type ReportLine = {
  item: PaymentSourceCase;
  installment: PaymentInstallment;
  projectGroup: PaymentProjectGroup;
};

function invalid(message: string): never {
  throw new BadRequestException({
    code: 'PAYMENT_COLLECTION_REPORT_INVALID',
    message,
  });
}
function text(value: unknown, name: string, max = 250): string {
  if (value === undefined || value === null || value === '') return '';
  if (
    typeof value !== 'string' ||
    value.length > max ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in query values.
    /[\u0000-\u001f]/.test(value)
  )
    invalid(`${name} alanı geçersiz.`);
  return value;
}
function option(
  value: unknown,
  name: string,
  values: readonly string[],
  fallback: string,
): string {
  const selected = text(value, name, 64) || fallback;
  if (!values.includes(selected)) invalid(`${name} seçimi geçersiz.`);
  return selected;
}
function integer(
  value: unknown,
  name: string,
  fallback: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[1-9]\d{0,6}$/.test(String(value)) ||
    Number(value) > max
  )
    invalid(`${name} geçerli bir pozitif tam sayı olmalı.`);
  return Number(value);
}
function month(value: string, name: string): string {
  if (
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ||
    value < '1753-01' ||
    value > '9998-12'
  )
    invalid(`${name} 1753-01 ile 9998-12 arasında YYYY-MM biçiminde olmalı.`);
  return value;
}
function nextPeriod(value: string, offset: number): string {
  const ordinal =
    Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1 + offset;
  const result = `${String(Math.floor(ordinal / 12)).padStart(4, '0')}-${String((ordinal % 12) + 1).padStart(2, '0')}`;
  return month(result, 'Ay aralığı');
}

export function parseCollectionReportQuery(raw: Record<string, unknown>) {
  const fields = [
    'basis',
    'currency',
    'paymentKind',
    'projectGroup',
    'representative',
    'representativeState',
    'authorizationState',
    'invoiceOk',
    'startMonth',
    'months',
    'detailMonth',
    'detailScope',
    'agingBucket',
    'page',
    'pageSize',
    'refresh',
  ];
  if (Object.keys(raw).some((key) => !fields.includes(key)))
    invalid('Desteklenmeyen tahsilat raporu filtresi.');
  const startMonth = text(raw.startMonth, 'startMonth', 7);
  const detailMonth = text(raw.detailMonth, 'detailMonth', 7);
  const detailScope = option(
    raw.detailScope,
    'detailScope',
    ['month', 'overdue', 'period', 'undated'],
    'month',
  ) as CollectionDetailScope;
  const agingBucket = option(
    raw.agingBucket,
    'agingBucket',
    ['', ...AGING_KEYS],
    '',
  ) as CollectionAgingKey | '';
  if (agingBucket && detailScope !== 'overdue')
    invalid('Vade yaşı yalnız gecikmiş ödeme ayrıntılarında seçilebilir.');
  const months = integer(raw.months, 'months', 6, 24);
  const pageSize = integer(raw.pageSize, 'pageSize', 25, 100);
  if (![6, 12, 24].includes(months)) invalid('Ay sayısı 6, 12 veya 24 olmalı.');
  if (![25, 50, 100].includes(pageSize))
    invalid('Sayfa boyutu 25, 50 veya 100 olmalı.');
  if (startMonth) {
    month(startMonth, 'startMonth');
    nextPeriod(startMonth, months - 1);
  }
  if (detailMonth) month(detailMonth, 'detailMonth');
  const representative = text(raw.representative, 'representative');
  const representativeState = option(
    raw.representativeState,
    'representativeState',
    ['', 'unassigned', 'multiple'],
    '',
  ) as CollectionRepresentativeState;
  if (representative && representativeState)
    invalid('Satış temsilcisi ve temsilci durumu birlikte seçilemez.');
  return {
    basis: option(raw.basis, 'basis', ['original'], 'original') as 'original',
    currency: text(raw.currency, 'currency', 64) || undefined,
    paymentKind: option(
      raw.paymentKind,
      'paymentKind',
      [
        'all',
        'sale',
        'land',
        'vat',
        'transformer',
        'furniture',
        'deposit',
        'other',
      ],
      'sale',
    ) as PaymentKindFilter,
    projectGroup: option(
      raw.projectGroup,
      'projectGroup',
      ['', ...PROJECT_TYPES, 'UNKNOWN'],
      '',
    ) as PaymentProjectGroupFilter,
    representative,
    representativeState,
    invoiceOk: parseInvoiceOkFilter(raw.invoiceOk),
    authorizationState: option(
      raw.authorizationState,
      'authorizationState',
      AUTH_STATES,
      'blank',
    ) as AuthorizationState,
    startMonth: startMonth || undefined,
    months,
    detailMonth: detailMonth || undefined,
    detailScope,
    agingBucket,
    page: integer(raw.page, 'page', 1, 1_000_000),
    pageSize,
    refresh:
      option(raw.refresh, 'refresh', ['true', 'false'], 'false') === 'true',
  };
}

function matchesAuthorization(
  item: PaymentSourceCase,
  selected: AuthorizationState,
): boolean {
  const auth = item.authorization;
  switch (selected) {
    case 'all':
      return true;
    case 'coded':
      return auth.codes.length > 0;
    case 'blank':
      return (
        auth.status === 'matched' && auth.hasBlank && auth.codes.length === 0
      );
    case 'mixed':
      return (
        auth.status === 'matched' && auth.hasBlank && auth.codes.length > 0
      );
    case 'unmatched':
      return auth.status === 'unmatched';
    case 'multiple':
      return auth.codes.length > 1;
  }
}
function sumKnown(values: Array<number | null>): number | null {
  if (!values.length) return 0;
  let result: number | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (!Number.isFinite(value))
      throw new ServiceUnavailableException({
        code: 'PAYMENT_COLLECTION_AMOUNT_INVALID',
        message: 'Tahsilat raporunun kaynak tutarları doğrulanamadı.',
      });
    result = (result ?? 0) + value;
    if (!Number.isFinite(result))
      throw new ServiceUnavailableException({
        code: 'PAYMENT_COLLECTION_AMOUNT_INVALID',
        message: 'Tahsilat raporunun toplam tutarı doğrulanamadı.',
      });
  }
  return result;
}
function overdueAmount(row: PaymentInstallment, asOf: string): number | null {
  if (row.outstanding === 0) return 0;
  if (row.dueDate === null) return null;
  return row.dueDate < asOf ? row.outstanding : 0;
}
function totals(lines: ReportLine[], asOf: string): CollectionTotals {
  return {
    scheduled: sumKnown(lines.map(({ installment }) => installment.amount)),
    paidToDate: sumKnown(lines.map(({ installment }) => installment.paid)),
    // The source clamps each installment separately; an overpayment cannot
    // offset the outstanding amount of a different obligation.
    outstanding: sumKnown(
      lines.map(({ installment }) => installment.outstanding),
    ),
    overdue: sumKnown(
      lines.map(({ installment }) => overdueAmount(installment, asOf)),
    ),
    caseCount: new Set(lines.map(({ item }) => item.key)).size,
    installmentCount: lines.length,
    incompleteRows: lines.filter(
      ({ item, installment }) =>
        installment.amount === null ||
        installment.paid === null ||
        installment.outstanding === null ||
        installment.dueDate === null ||
        !item.identity.currency?.trim(),
    ).length,
  };
}

function performanceTotals(
  lines: ReportLine[],
  asOf: string,
  currency: string | null,
): CollectionPerformanceTotals {
  const result = totals(lines, asOf);
  // Signed adjustments or incomplete source rows cannot support a completion
  // ratio. An overpayment is retained above 100%, without clipping its value.
  const complete =
    !!currency?.trim() &&
    result.incompleteRows === 0 &&
    !lines.some(({ installment }) =>
      [installment.amount, installment.paid, installment.outstanding].some(
        (value) => value === null || value < 0,
      ),
    );
  const ratio =
    complete &&
    result.scheduled !== null &&
    result.scheduled > 0 &&
    result.paidToDate !== null
      ? Math.round((result.paidToDate / result.scheduled) * 10_000) / 100
      : null;
  return {
    ...result,
    completionPercent: ratio !== null && Number.isFinite(ratio) ? ratio : null,
  };
}

/** Keep exact nonblank source names; repeated names are not multiple ownership. */
function representativeNames(item: PaymentSourceCase): string[] {
  return [...new Set(item.representatives.filter((name) => name.trim()))];
}

function representativeGroup(
  item: PaymentSourceCase,
): Pick<
  CollectionRepresentativeBreakdown,
  'key' | 'representative' | 'representativeState'
> {
  const names = representativeNames(item);
  if (names.length === 1)
    return {
      key: `single:${names[0]}`,
      representative: names[0],
      representativeState: 'single',
    };
  const state = names.length ? 'multiple' : 'unassigned';
  return { key: state, representative: null, representativeState: state };
}

function isOverdue({ installment }: ReportLine, asOf: string): boolean {
  return (
    installment.dueDate !== null &&
    installment.dueDate < asOf &&
    (installment.outstanding === null || installment.outstanding > 0)
  );
}

function agingKey(line: ReportLine, asOf: string): CollectionAgingKey | null {
  if (!isOverdue(line, asOf)) return null;
  // Dates have already been validated. UTC calendar days avoid DST and timezone
  // shifts, and source overdueDays/status are not trusted for aging.
  const days =
    (Date.parse(`${asOf}T00:00:00.000Z`) -
      Date.parse(`${line.installment.dueDate!}T00:00:00.000Z`)) /
    86_400_000;
  return days <= 30
    ? '1_30'
    : days <= 60
      ? '31_60'
      : days <= 90
        ? '61_90'
        : '90_plus';
}

function agingTotals(
  lines: ReportLine[],
  asOf: string,
): CollectionAgingBucket[] {
  const buckets = new Map<CollectionAgingKey, ReportLine[]>(
    AGING_KEYS.map((key) => [key, []]),
  );
  for (const line of lines) {
    const key = agingKey(line, asOf);
    // Unknown balances keep their true due-date bucket and incomplete marker;
    // discarding them would hide unresolved overdue source rows.
    if (key) buckets.get(key)!.push(line);
  }
  return AGING_KEYS.map((key) => ({ key, ...totals(buckets.get(key)!, asOf) }));
}

function breakdown(
  lines: ReportLine[],
  asOf: string,
  currency: string | null,
  periods: string[],
  nextMonth: string,
): CollectionBreakdown {
  const selectedPeriods = new Set(periods);
  const monthly = new Map<string, ReportLine[]>();
  for (const line of lines) {
    const dueMonth = line.installment.dueDate?.slice(0, 7);
    if (!dueMonth) continue;
    const group = monthly.get(dueMonth);
    if (group) group.push(line);
    else monthly.set(dueMonth, [line]);
  }
  return {
    period: performanceTotals(
      lines.filter(({ installment }) =>
        selectedPeriods.has(installment.dueDate?.slice(0, 7) ?? ''),
      ),
      asOf,
      currency,
    ),
    overdue: totals(
      lines.filter((line) => isOverdue(line, asOf)),
      asOf,
    ),
    nextMonth: totals(monthly.get(nextMonth) ?? [], asOf),
    monthly: periods.map((month) => ({
      month,
      ...performanceTotals(monthly.get(month) ?? [], asOf, currency),
    })),
  };
}

function breakdownOrder(left: CollectionBreakdown, right: CollectionBreakdown) {
  return (
    Number(left.period.outstanding === null) -
      Number(right.period.outstanding === null) ||
    (right.period.outstanding ?? 0) - (left.period.outstanding ?? 0)
  );
}

function exactOutstanding(
  lines: ReportLine[],
  currency: string | null,
): number | null {
  if (
    !currency?.trim() ||
    lines.some(
      ({ installment }) =>
        installment.amount === null ||
        installment.paid === null ||
        installment.dueDate === null ||
        installment.outstanding === null ||
        !Number.isFinite(installment.outstanding) ||
        installment.outstanding < 0,
    )
  )
    return null;
  return sumKnown(lines.map(({ installment }) => installment.outstanding));
}

function sharePercent(amount: number | null, total: number | null) {
  return amount !== null && total !== null && total > 0
    ? Math.round((amount / total) * 10_000) / 100
    : null;
}

function overdueConcentration(
  lines: ReportLine[],
  currency: string | null,
): CollectionOverdueConcentration {
  const total = exactOutstanding(lines, currency);
  if (
    total === null ||
    lines.some(({ item }) => !item.identity.customerCode?.trim())
  )
    return {
      complete: false,
      customerGroupCount: null,
      top20GroupCount: null,
      top20Outstanding: null,
      top20SharePercent: null,
    };
  const groups = new Map<string, number>();
  for (const { item, installment } of lines) {
    const amount = installment.outstanding!;
    if (amount <= 0) continue;
    // Preserve exact source identity, including case and trailing spaces.
    const code = item.identity.customerCode!;
    groups.set(code, (groups.get(code) ?? 0) + amount);
  }
  const amounts = [...groups.values()].sort((left, right) => right - left);
  const selected = amounts.slice(0, 20);
  const top20Outstanding = sumKnown(selected)!;
  return {
    complete: true,
    customerGroupCount: amounts.length,
    top20GroupCount: selected.length,
    top20Outstanding,
    top20SharePercent: sharePercent(top20Outstanding, total),
  };
}

function projectInsights(
  rows: ReportLine[],
  overdue: ReportLine[],
  nextMonth: ReportLine[],
  currency: string | null,
): CollectionProjectInsight[] {
  const overdueTotal = exactOutstanding(overdue, currency);
  const nextMonthTotal = exactOutstanding(nextMonth, currency);
  return [...new Set(rows.map((row) => row.projectGroup))]
    .map((projectGroup) => {
      const overdueOutstanding = exactOutstanding(
        overdue.filter((row) => row.projectGroup === projectGroup),
        currency,
      );
      const nextMonthOutstanding = exactOutstanding(
        nextMonth.filter((row) => row.projectGroup === projectGroup),
        currency,
      );
      return {
        projectGroup,
        overdueOutstanding,
        nextMonthOutstanding,
        overdueSharePercent: sharePercent(overdueOutstanding, overdueTotal),
        nextMonthSharePercent: sharePercent(
          nextMonthOutstanding,
          nextMonthTotal,
        ),
      };
    })
    .sort(
      (left, right) =>
        Number(left.overdueOutstanding === null) -
          Number(right.overdueOutstanding === null) ||
        (right.overdueOutstanding ?? 0) - (left.overdueOutstanding ?? 0) ||
        left.projectGroup.localeCompare(right.projectGroup),
    );
}

/** Current LOGO due dates and allocations; the source due dates can be edited in LOGO. */
export function buildCollectionReport(
  snapshot: PaymentSourceSnapshot,
  raw: Record<string, unknown> = {},
): PaymentCollectionReport {
  const query = parseCollectionReportQuery(raw);
  requireInvoiceOkSource(snapshot, query.invoiceOk);
  paymentTrackingDate(snapshot.asOf, 'Kaynak değerlendirme tarihi');
  const nextMonth = nextPeriod(snapshot.asOf.slice(0, 7), 1);
  const startMonth = query.startMonth ?? nextMonth;
  const periods = Array.from({ length: query.months }, (_, index) =>
    nextPeriod(startMonth, index),
  );
  const lastMonth = periods.at(-1)!;
  const detailMonth = query.detailMonth ?? nextMonth;
  if (
    query.authorizationState !== 'all' &&
    snapshot.authorizationSource.status !== 'available'
  )
    throw new ServiceUnavailableException({
      code: 'PAYMENT_TRACKING_AUTHORIZATION_UNAVAILABLE',
      message:
        'Yetki kodu kaynağı şu anda okunamıyor. Rapor için yenileyin veya tüm kod durumlarını seçin.',
    });
  if (
    (query.representative || query.representativeState) &&
    snapshot.authorizationSource.status !== 'available'
  )
    throw new ServiceUnavailableException({
      code: 'PAYMENT_TRACKING_METADATA_UNAVAILABLE',
      message:
        'Satış temsilcisi kaynağı şu anda okunamıyor. Rapor için yenileyin veya temsilci filtresini kaldırın.',
    });

  const currencyCounts = new Map<string | null, number>();
  for (const item of snapshot.cases)
    currencyCounts.set(
      item.identity.currency,
      (currencyCounts.get(item.identity.currency) ?? 0) + item.installmentCount,
    );
  const currencies = [...currencyCounts]
    .map(([value, recordCount]) => ({
      value,
      label: value ?? 'Belirsiz / Unknown',
      recordCount,
    }))
    .sort(
      (left, right) =>
        right.recordCount - left.recordCount ||
        String(left.value).localeCompare(String(right.value)),
    );
  const currencyMode = query.currency === '__ALL__' ? 'all' : 'single';
  const selectedCurrency =
    currencyMode === 'all'
      ? null
      : query.currency === undefined
        ? (currencies[0]?.value ?? null)
        : query.currency === '__NULL__'
          ? null
          : query.currency;
  if (
    currencyMode === 'single' &&
    query.currency !== undefined &&
    !currencies.some((entry) => entry.value === selectedCurrency)
  )
    invalid('Seçilen para birimi kaynakta bulunmuyor.');
  const selectedCurrencies = currencies.filter(
    (entry) => currencyMode === 'all' || entry.value === selectedCurrency,
  );
  const projects = paymentProjectGroups(snapshot.cases);
  const cases = snapshot.cases
    .filter(
      (item) =>
        currencyMode === 'all' || item.identity.currency === selectedCurrency,
    )
    .map((item) => selectPaymentKind(item, query.paymentKind, snapshot.asOf))
    .filter((item): item is PaymentSourceCase => item !== null);
  const projectCounts = new Map<PaymentProjectGroup, number>();
  const representativeCounts = new Map<string, number>();
  for (const item of cases) {
    const project = projects.get(item.key) ?? 'UNKNOWN';
    projectCounts.set(project, (projectCounts.get(project) ?? 0) + 1);
    for (const representative of representativeNames(item))
      representativeCounts.set(
        representative,
        (representativeCounts.get(representative) ?? 0) + 1,
      );
  }
  const filtered = cases.filter(
    (item) =>
      (!query.projectGroup || projects.get(item.key) === query.projectGroup) &&
      (!query.representative ||
        representativeNames(item).includes(query.representative)) &&
      (!query.representativeState ||
        representativeGroup(item).representativeState ===
          query.representativeState) &&
      matchesAuthorization(item, query.authorizationState) &&
      matchesInvoiceOk(item, query.invoiceOk),
  );
  const lines: ReportLine[] = filtered.flatMap((item) =>
    item.installments.map((installment) => ({
      item,
      installment,
      projectGroup: projects.get(item.key) ?? 'UNKNOWN',
    })),
  );
  // Null dates are shown explicitly; malformed dates must never be assigned to
  // an invented month or silently omitted from the report partition.
  for (const { installment } of lines)
    if (installment.dueDate !== null)
      paymentTrackingDate(installment.dueDate, 'LOGO vadesi');
  const currentMonth = snapshot.asOf.slice(0, 7);
  const historicalPeriods = [
    ...new Set(
      lines.flatMap(({ installment }) => {
        const dueMonth = installment.dueDate?.slice(0, 7);
        return dueMonth && dueMonth < currentMonth ? [dueMonth] : [];
      }),
    ),
  ].sort();
  const byCurrency = selectedCurrencies.map(({ value: currency }) => {
    const rows = lines.filter(
      ({ item }) => item.identity.currency === currency,
    );
    const dated = rows.filter(
      ({ installment }) => installment.dueDate !== null,
    );
    const monthLines = new Map<string, ReportLine[]>();
    for (const line of dated) {
      const dueMonth = line.installment.dueDate!.slice(0, 7);
      const group = monthLines.get(dueMonth);
      if (group) group.push(line);
      else monthLines.set(dueMonth, [line]);
    }
    const inMonth = (value: string) => monthLines.get(value) ?? [];
    const overdue = dated.filter((line) => isOverdue(line, snapshot.asOf));
    const nextMonthRows = inMonth(nextMonth);
    const projectRows = new Map<PaymentProjectGroup, ReportLine[]>();
    const representativeRows = new Map<
      string,
      {
        identity: ReturnType<typeof representativeGroup>;
        rows: ReportLine[];
      }
    >();
    const representativeMetadataAvailable =
      snapshot.authorizationSource.status === 'available';
    // These two partitions assign each case to one project and one ownership
    // bucket. Multi-representative files must never be counted once per name.
    for (const row of rows) {
      const project = projectRows.get(row.projectGroup);
      if (project) project.push(row);
      else projectRows.set(row.projectGroup, [row]);
      if (representativeMetadataAvailable) {
        const identity = representativeGroup(row.item);
        const representative = representativeRows.get(identity.key);
        if (representative) representative.rows.push(row);
        else representativeRows.set(identity.key, { identity, rows: [row] });
      }
    }
    return {
      currency,
      summary: totals(rows, snapshot.asOf),
      period: performanceTotals(
        periods.flatMap((month) => inMonth(month)),
        snapshot.asOf,
        currency,
      ),
      overdue: totals(overdue, snapshot.asOf),
      aging: agingTotals(overdue, snapshot.asOf),
      currentMonthRemaining: totals(
        inMonth(currentMonth).filter(
          ({ installment }) => installment.dueDate! >= snapshot.asOf,
        ),
        snapshot.asOf,
      ),
      nextMonth: totals(nextMonthRows, snapshot.asOf),
      overdueConcentration: overdueConcentration(overdue, currency),
      projectInsights: projectInsights(rows, overdue, nextMonthRows, currency),
      projectBreakdown: [...projectRows]
        .map(([projectGroup, groupedRows]) => ({
          projectGroup,
          ...breakdown(
            groupedRows,
            snapshot.asOf,
            currency,
            periods,
            nextMonth,
          ),
        }))
        .sort(
          (left, right) =>
            breakdownOrder(left, right) ||
            left.projectGroup.localeCompare(right.projectGroup),
        ),
      representativeBreakdown: [...representativeRows.values()]
        .map(({ identity, rows: groupedRows }) => ({
          ...identity,
          ...breakdown(
            groupedRows,
            snapshot.asOf,
            currency,
            periods,
            nextMonth,
          ),
        }))
        .sort(
          (left, right) =>
            breakdownOrder(left, right) ||
            left.key.localeCompare(right.key, 'tr'),
        ),
      undated: totals(
        rows.filter(({ installment }) => installment.dueDate === null),
        snapshot.asOf,
      ),
      beforeWindow: totals(
        dated.filter(
          ({ installment }) => installment.dueDate!.slice(0, 7) < startMonth,
        ),
        snapshot.asOf,
      ),
      afterWindow: totals(
        dated.filter(
          ({ installment }) => installment.dueDate!.slice(0, 7) > lastMonth,
        ),
        snapshot.asOf,
      ),
      monthly: periods.map((month) => ({
        month,
        ...performanceTotals(inMonth(month), snapshot.asOf, currency),
      })),
      historical: historicalPeriods.map((month) => ({
        month,
        ...performanceTotals(inMonth(month), snapshot.asOf, currency),
      })),
    };
  });
  const detailGroups = new Map<string, ReportLine[]>();
  const selectedPeriods = new Set(periods);
  for (const line of lines) {
    const dueDate = line.installment.dueDate;
    let included: boolean;
    switch (query.detailScope) {
      case 'month':
        included = dueDate?.slice(0, 7) === detailMonth;
        break;
      case 'overdue':
        included =
          isOverdue(line, snapshot.asOf) &&
          (!query.agingBucket ||
            agingKey(line, snapshot.asOf) === query.agingBucket);
        break;
      case 'period':
        included = selectedPeriods.has(dueDate?.slice(0, 7) ?? '');
        break;
      case 'undated':
        included = dueDate === null;
        break;
    }
    if (!included) continue;
    const group = detailGroups.get(line.item.key);
    if (group) group.push(line);
    else detailGroups.set(line.item.key, [line]);
  }
  const detailRows: CollectionCaseMonth[] = [...detailGroups.values()]
    .map((group) => {
      const { item, projectGroup } = group[0];
      const dates = group
        .flatMap(({ installment }) =>
          installment.dueDate === null ? [] : [installment.dueDate],
        )
        .sort();
      return {
        key: item.key,
        customerCode: item.identity.customerCode,
        customerName: item.customerName,
        unitCode: item.identity.unitCode,
        unitName: item.unitName,
        currency: item.identity.currency,
        projectGroup,
        representatives: [...item.representatives],
        invoiceOk: item.invoiceOk,
        earliestDueDate: dates[0] ?? null,
        lastDueDate: dates.at(-1) ?? null,
        totals: totals(group, snapshot.asOf),
      };
    })
    .sort((left, right) => {
      if (left.currency !== right.currency) {
        if (left.currency === null) return 1;
        if (right.currency === null) return -1;
        return left.currency.localeCompare(right.currency, 'en');
      }
      if (left.totals.outstanding === null && right.totals.outstanding !== null)
        return 1;
      if (right.totals.outstanding === null && left.totals.outstanding !== null)
        return -1;
      return (
        (right.totals.outstanding ?? 0) - (left.totals.outstanding ?? 0) ||
        left.key.localeCompare(right.key)
      );
    });
  const totalPages = Math.max(1, Math.ceil(detailRows.length / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const { cases: _cases, ...source } = snapshot;
  void _cases;
  return {
    analyticsVersion: 1,
    source,
    basis: 'original',
    selectedCurrency,
    currencyMode,
    selectedPaymentKind: query.paymentKind,
    selectedProjectGroup: query.projectGroup,
    selectedRepresentative: query.representative,
    selectedRepresentativeState: query.representativeState,
    selectedAuthorizationState: query.authorizationState,
    selectedInvoiceOk: query.invoiceOk,
    invoiceOkOptions: invoiceOkFilterOptions(cases),
    startMonth,
    months: query.months,
    nextMonth,
    periods,
    historicalPeriods,
    currencies,
    projectGroups: [...PROJECT_TYPES, 'UNKNOWN' as const].map((value) => ({
      value,
      label: value === 'UNKNOWN' ? 'Belirsiz / Diğer' : PROJECT_LABELS[value],
      caseCount: projectCounts.get(value) ?? 0,
    })),
    representatives: [...representativeCounts]
      .map(([value, caseCount]) => ({ value, label: value, caseCount }))
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label, 'tr') ||
          left.value.localeCompare(right.value),
      ),
    byCurrency,
    detail: {
      scope: query.detailScope,
      agingBucket: query.agingBucket,
      month: detailMonth,
      rows: detailRows.slice(
        (page - 1) * query.pageSize,
        page * query.pageSize,
      ),
      page,
      pageSize: query.pageSize,
      total: detailRows.length,
      totalPages,
    },
  };
}

@Injectable()
export class PaymentCollectionReportService {
  constructor(private readonly source: PaymentTrackingSourceService) {}

  async report(
    raw: Record<string, unknown> = {},
  ): Promise<PaymentCollectionReport> {
    const query = parseCollectionReportQuery(raw);
    const snapshot = await this.source.snapshot(query.refresh);
    return buildCollectionReport(snapshot, raw);
  }
}
