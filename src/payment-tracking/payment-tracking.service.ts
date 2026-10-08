import {
  BadRequestException,
  Injectable,
  NotFoundException,
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
import { PaymentTrackingStoreService } from './payment-tracking-store.service';
import type {
  PaymentActor,
  PaymentKindFilter,
  PaymentProjectGroup,
  PaymentProjectGroupFilter,
  PaymentSourceCase,
  PaymentSourceSnapshot,
  PaymentTrackingAction,
  PaymentTrackingDetail,
  PaymentTrackingList,
  PaymentTrackingRow,
  PaymentTrackingState,
  PaymentFilterOption,
  PaymentTrackingSummary,
} from './payment-tracking.types';

const DAY = 86_400_000;
function invalid(message: string): never {
  throw new BadRequestException({ code: 'PAYMENT_TRACKING_INVALID', message });
}
function text(value: unknown, name: string, max = 200): string {
  if (value === undefined || value === null || value === '') return '';
  if (
    typeof value !== 'string' ||
    value.length > max ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 &&
        ![9, 10, 13].includes(character.charCodeAt(0)),
    )
  )
    return invalid(`${name} alanı geçersiz veya çok uzun.`);
  return value;
}
function option(
  value: unknown,
  name: string,
  options: readonly string[],
  fallback: string,
) {
  const result = text(value, name, 50) || fallback;
  if (!options.includes(result)) return invalid(`${name} seçimi geçersiz.`);
  return result;
}
function integer(value: unknown, name: string, fallback: number, max: number) {
  if (value === undefined || value === '') return fallback;
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^[1-9]\d{0,6}$/.test(String(value)) ||
    Number(value) > max
  )
    return invalid(`${name} geçerli bir pozitif sayı olmalı.`);
  return Number(value);
}
const DATE_FILTERS = ['due', 'followUp', 'invoice'] as const;
const NUMBER_FILTERS = ['balance', 'overdueAmount', 'overdueDays'] as const;
function rangeNumber(
  value: unknown,
  name: string,
  whole: boolean,
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' && typeof value !== 'string')
    return invalid(`${name} sayısal olmalı.`);
  const input = String(value);
  const format = whole
    ? /^(?:0|[1-9]\d{0,6})$/
    : /^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/;
  const result = Number(input);
  if (!format.test(input) || !Number.isFinite(result) || result < 0)
    return invalid(
      `${name} sıfır veya pozitif ${whole ? 'tam sayı' : 'sayı'} olmalı; ondalık ayırıcı olarak nokta kullanın.`,
    );
  return result;
}
export function parsePaymentQuery(query: Record<string, unknown>) {
  const keys = [
    'currency',
    'q',
    'project',
    'projectGroup',
    'scope',
    'assignee',
    'priority',
    'page',
    'pageSize',
    'sortBy',
    'sortDir',
    'refresh',
    'authorizationCode',
    'authorizationState',
    'invoiceOk',
    'representative',
    'broker',
    'customer',
    'unit',
    'paymentState',
    'paymentKind',
    'trackingRecord',
    'dataQuality',
    'deferral',
    ...DATE_FILTERS.flatMap((field) => [`${field}From`, `${field}To`]),
    ...NUMBER_FILTERS.flatMap((field) => [`${field}Min`, `${field}Max`]),
  ];
  if (Object.keys(query).some((key) => !keys.includes(key)))
    invalid('Desteklenmeyen liste filtresi.');
  const pageSize = integer(query.pageSize, 'pageSize', 25, 100);
  if (![25, 50, 100].includes(pageSize))
    invalid('Sayfa boyutu 25, 50 veya 100 olmalı.');
  const ranges: Partial<
    Record<
      | 'dueFrom'
      | 'dueTo'
      | 'followUpFrom'
      | 'followUpTo'
      | 'invoiceFrom'
      | 'invoiceTo',
      string
    >
  > = {};
  for (const field of DATE_FILTERS) {
    const from = text(query[`${field}From`], `${field}From`, 10);
    const to = text(query[`${field}To`], `${field}To`, 10);
    if (from) {
      paymentTrackingDate(from, `${field}From`);
      ranges[`${field}From`] = from;
    }
    if (to) {
      paymentTrackingDate(to, `${field}To`);
      ranges[`${field}To`] = to;
    }
    if (from && to && from > to)
      invalid(`${field}: başlangıç tarihi bitiş tarihinden sonra olamaz.`);
  }
  const numbers: Partial<
    Record<
      | 'balanceMin'
      | 'balanceMax'
      | 'overdueAmountMin'
      | 'overdueAmountMax'
      | 'overdueDaysMin'
      | 'overdueDaysMax',
      number
    >
  > = {};
  for (const field of NUMBER_FILTERS) {
    const min = rangeNumber(
      query[`${field}Min`],
      `${field}Min`,
      field === 'overdueDays',
    );
    const max = rangeNumber(
      query[`${field}Max`],
      `${field}Max`,
      field === 'overdueDays',
    );
    if (min !== undefined) numbers[`${field}Min`] = min;
    if (max !== undefined) numbers[`${field}Max`] = max;
    if (min !== undefined && max !== undefined && min > max)
      invalid(`${field}: en az değeri en çok değerinden büyük olamaz.`);
  }
  const currency = text(query.currency, 'currency', 64) || undefined;
  if (
    currency === '__ALL__' &&
    (
      [
        'balanceMin',
        'balanceMax',
        'overdueAmountMin',
        'overdueAmountMax',
      ] as const
    ).some((field) => numbers[field] !== undefined)
  )
    invalid(
      'Tutar filtreleri için tek bir para birimi seçin. Choose a single currency for amount filters.',
    );
  return {
    ...ranges,
    ...numbers,
    currency,
    q: text(query.q, 'q').trim().toLocaleLowerCase('tr'),
    project: text(query.project, 'project', 250),
    projectGroup: option(
      query.projectGroup,
      'projectGroup',
      ['', ...PROJECT_TYPES, 'UNKNOWN'],
      '',
    ) as PaymentProjectGroupFilter,
    assignee: text(query.assignee, 'assignee', 100) || 'all',
    priority: option(query.priority, 'priority', ['all', 'high'], 'all'),
    authorizationCode: text(query.authorizationCode, 'authorizationCode', 250),
    invoiceOk: parseInvoiceOkFilter(query.invoiceOk),
    authorizationState: option(
      query.authorizationState,
      'authorizationState',
      ['all', 'coded', 'blank', 'mixed', 'unmatched', 'multiple'],
      'all',
    ),
    representative: text(query.representative, 'representative', 250),
    broker: text(query.broker, 'broker', 250),
    customer: text(query.customer, 'customer', 250),
    unit: text(query.unit, 'unit', 250),
    paymentKind: option(
      query.paymentKind,
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
      'all',
    ) as PaymentKindFilter,
    paymentState: option(
      query.paymentState,
      'paymentState',
      ['all', 'unpaid', 'partial', 'paid', 'unknown'],
      'all',
    ),
    trackingRecord: option(
      query.trackingRecord,
      'trackingRecord',
      ['all', 'exists', 'none'],
      'all',
    ),
    deferral: option(
      query.deferral,
      'deferral',
      ['all', 'exists', 'none'],
      'all',
    ),
    dataQuality: option(
      query.dataQuality,
      'dataQuality',
      ['all', 'complete', 'incomplete'],
      'all',
    ),
    scope: option(
      query.scope,
      'scope',
      [
        'actionable',
        'overdue',
        'deferred',
        'today',
        'upcoming',
        'paid',
        'closed',
        'open',
        'all',
      ],
      'actionable',
    ),
    page: integer(query.page, 'page', 1, 1000000),
    pageSize,
    sortBy: option(
      query.sortBy,
      'sortBy',
      [
        'overdueDays',
        'outstanding',
        'effectiveDueDate',
        'customerName',
        'unitName',
        'amount',
        'paid',
        'overdueAmount',
        'oldestDueDate',
        'nextDueDate',
        'trackingOverdueDays',
      ],
      'overdueDays',
    ),
    sortDir: option(query.sortDir, 'sortDir', ['asc', 'desc'], 'desc'),
    refresh:
      option(query.refresh, 'refresh', ['true', 'false'], 'false') === 'true',
  };
}
export function trackingRow(
  source: PaymentSourceCase,
  tracking: PaymentTrackingState | null,
  asOf: string,
  fullyPaid = false,
  projectGroup: PaymentProjectGroup = 'UNKNOWN',
): PaymentTrackingRow {
  const { installments: _installments, ...item } = source;
  void _installments;
  // A local follow-up date cannot make a later source obligation due earlier.
  const effectiveDueDate =
    [source.oldestDueDate, tracking?.trackingDate]
      .filter((date): date is string => !!date)
      .sort()
      .at(-1) ?? null;
  let trackingStatus: PaymentTrackingRow['trackingStatus'] = 'unknown';
  if (source.outstanding !== null && source.outstanding > 0) {
    if (effectiveDueDate) {
      trackingStatus =
        effectiveDueDate < asOf
          ? 'overdue'
          : effectiveDueDate === asOf
            ? 'today'
            : tracking?.trackingDate &&
                tracking.trackingDate > asOf &&
                !!source.oldestDueDate &&
                tracking.trackingDate > source.oldestDueDate
              ? 'deferred'
              : 'upcoming';
    }
  } else if (source.outstanding === 0 && source.incompleteRows === 0)
    trackingStatus = 'paid';
  const trackingOverdueDays =
    trackingStatus === 'overdue' && effectiveDueDate
      ? Math.round((Date.parse(asOf) - Date.parse(effectiveDueDate)) / DAY)
      : 0;
  return {
    ...item,
    projectGroup,
    fullyPaid,
    tracking,
    effectiveDueDate,
    trackingStatus,
    trackingOverdueDays,
  };
}
function portfolioIdentity(item: PaymentSourceCase): string | null {
  const { customerCode, unitCode } = item.identity;
  // Missing identifiers must never combine unrelated customers or units.
  // Only the blank check trims; grouping retains the exact source codes.
  return customerCode?.trim() && unitCode?.trim()
    ? JSON.stringify([customerCode, unitCode])
    : null;
}
function closedPortfolios(cases: PaymentSourceCase[]): Map<string, boolean> {
  const closed = new Map<string, boolean>();
  for (const item of cases) {
    const key = portfolioIdentity(item);
    if (key === null) continue;
    const completeAndPaid =
      !!item.identity.currency?.trim() &&
      Number.isFinite(item.amount) &&
      Number.isFinite(item.paid) &&
      item.outstanding === 0 &&
      item.incompleteRows === 0;
    closed.set(key, (closed.get(key) ?? true) && completeAndPaid);
  }
  return closed;
}
function isPortfolioClosed(
  item: PaymentSourceCase,
  closed: Map<string, boolean>,
): boolean {
  const key = portfolioIdentity(item);
  return key !== null && closed.get(key) === true;
}
function sumKnown(
  rows: PaymentTrackingRow[],
  field: 'outstanding' | 'overdueAmount',
): number | null {
  const values = rows
    .map((row) => row[field])
    .filter((value): value is number => value !== null);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0)
    : rows.length
      ? null
      : 0;
}
function isActionable(row: PaymentTrackingRow) {
  return row.trackingStatus === 'overdue' || row.trackingStatus === 'today';
}
function summarizeRows(
  rows: PaymentTrackingRow[],
  includeMoney = true,
): PaymentTrackingSummary {
  const actionable = rows.filter(isActionable);
  return {
    closedCount: rows.filter((row) => row.fullyPaid).length,
    openCount: rows.filter((row) => (row.outstanding ?? 0) > 0).length,
    outstanding: includeMoney ? sumKnown(rows, 'outstanding') : null,
    overdueCount: rows.filter((row) => (row.overdueAmount ?? 0) > 0).length,
    overdueAmount: includeMoney ? sumKnown(rows, 'overdueAmount') : null,
    actionableCount: actionable.length,
    actionableAmount: includeMoney ? sumKnown(actionable, 'outstanding') : null,
    deferredCount: rows.filter((row) => row.trackingStatus === 'deferred')
      .length,
    todayCount: rows.filter((row) => row.trackingStatus === 'today').length,
    unassignedCount: rows.filter(
      (row) => (row.outstanding ?? 0) > 0 && !row.tracking?.assigneeId,
    ).length,
    incompleteRows: rows.reduce((sum, row) => sum + row.incompleteRows, 0),
  };
}
function rowsByCurrency(rows: PaymentTrackingRow[]) {
  const groups = new Map<string | null, PaymentTrackingRow[]>();
  for (const row of rows) {
    const currency = row.identity.currency;
    const group = groups.get(currency);
    if (group) group.push(row);
    else groups.set(currency, [row]);
  }
  return groups;
}
function dateInRange(value: string | null, from?: string, to?: string) {
  if (!from && !to) return true;
  return value !== null && (!from || value >= from) && (!to || value <= to);
}
function numberInRange(value: number | null, min?: number, max?: number) {
  if (min === undefined && max === undefined) return true;
  return (
    value !== null &&
    (min === undefined || value >= min) &&
    (max === undefined || value <= max)
  );
}
function filterOptions(
  rows: PaymentTrackingRow[],
  select: (row: PaymentTrackingRow) => { value: string; label: string }[],
): PaymentFilterOption[] {
  const options = new Map<string, PaymentFilterOption>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const { value, label } of select(row)) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const current = options.get(value);
      if (current) current.caseCount += 1;
      else options.set(value, { value, label, caseCount: 1 });
    }
  }
  return [...options.values()].sort(
    (a, b) =>
      a.label.localeCompare(b.label, 'tr') || a.value.localeCompare(b.value),
  );
}
function paymentState(row: PaymentTrackingRow) {
  if (
    row.incompleteRows > 0 ||
    row.amount === null ||
    row.paid === null ||
    row.outstanding === null
  )
    return 'unknown';
  if (row.outstanding === 0) return 'paid';
  if (row.outstanding > 0 && row.paid === 0) return 'unpaid';
  if (row.outstanding > 0 && row.paid > 0) return 'partial';
  return 'unknown';
}
export function paymentList(
  snapshot: PaymentSourceSnapshot,
  states: PaymentTrackingState[],
  actor: PaymentActor,
  raw: Record<string, unknown>,
): Omit<PaymentTrackingList, 'assignees'> {
  const query = parsePaymentQuery(raw);
  requireInvoiceOkSource(snapshot, query.invoiceOk);
  if (
    (query.authorizationCode || query.authorizationState !== 'all') &&
    snapshot.authorizationSource.status !== 'available'
  ) {
    throw new ServiceUnavailableException({
      code: 'PAYMENT_TRACKING_AUTHORIZATION_UNAVAILABLE',
      message:
        'Yetki Kodu kaynağı şu anda okunamıyor. Yenileyin veya Yetki Kodu ve kod durumu filtrelerini kaldırın.',
    });
  }
  if (
    (query.representative ||
      query.broker ||
      query.invoiceFrom ||
      query.invoiceTo) &&
    snapshot.authorizationSource.status !== 'available'
  ) {
    throw new ServiceUnavailableException({
      code: 'PAYMENT_TRACKING_METADATA_UNAVAILABLE',
      message:
        'Fatura vade bilgileri şu anda okunamıyor. Yenileyin veya satış temsilcisi, emlakçı ve fatura tarihi filtrelerini kaldırın.',
    });
  }
  const local = new Map(states.map((state) => [state.key, state]));
  // Closure always considers every currency and payment type in the snapshot,
  // before a list filter projects a smaller set of installments.
  const closed = closedPortfolios(snapshot.cases);
  const groups = paymentProjectGroups(snapshot.cases);
  const currenciesMap = new Map<string | null, number>();
  for (const item of snapshot.cases)
    currenciesMap.set(
      item.identity.currency,
      (currenciesMap.get(item.identity.currency) ?? 0) + item.installmentCount,
    );
  const currencies = [...currenciesMap]
    .map(([value, recordCount]) => ({
      value,
      recordCount,
      label: value ?? 'Belirsiz / Unknown',
    }))
    .sort(
      (a, b) =>
        b.recordCount - a.recordCount ||
        String(a.value).localeCompare(String(b.value)),
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
    !currencies.some((currency) => currency.value === selectedCurrency)
  )
    invalid('Seçilen para birimi kaynakta bulunmuyor.');
  const projectsMap = new Map<string, { code: string; name: string }>();
  const currencyRows = snapshot.cases
    .filter(
      (item) =>
        currencyMode === 'all' || item.identity.currency === selectedCurrency,
    )
    .map((item) => selectPaymentKind(item, query.paymentKind, snapshot.asOf))
    .filter((item): item is PaymentSourceCase => item !== null)
    .map((item) =>
      trackingRow(
        item,
        local.get(item.key) ?? null,
        snapshot.asOf,
        isPortfolioClosed(item, closed),
        groups.get(item.key) ?? 'UNKNOWN',
      ),
    );
  const groupCounts = new Map<PaymentProjectGroup, number>();
  for (const row of currencyRows)
    groupCounts.set(
      row.projectGroup,
      (groupCounts.get(row.projectGroup) ?? 0) + 1,
    );
  const projectGroups = [...PROJECT_TYPES, 'UNKNOWN' as const].map((value) => ({
    value,
    label: value === 'UNKNOWN' ? 'Belirsiz / Diğer' : PROJECT_LABELS[value],
    caseCount: groupCounts.get(value) ?? 0,
  }));
  for (const row of currencyRows)
    for (const project of row.projects) projectsMap.set(project.code, project);
  const codes = (values: string[]) =>
    values.map((value) => ({ value, label: value }));
  const options = {
    authorizationCodes: filterOptions(currencyRows, (row) =>
      codes(row.authorization.codes),
    ),
    representatives: filterOptions(currencyRows, (row) =>
      codes(row.representatives),
    ),
    brokers: filterOptions(currencyRows, (row) => codes(row.brokers)),
    customers: filterOptions(currencyRows, (row) =>
      row.identity.customerCode
        ? [
            {
              value: row.identity.customerCode,
              label: `${row.identity.customerCode} · ${row.customerName}`,
            },
          ]
        : [],
    ),
    units: filterOptions(currencyRows, (row) =>
      row.identity.unitCode
        ? [
            {
              value: row.identity.unitCode,
              label: `${row.identity.unitCode} · ${row.unitName}`,
            },
          ]
        : [],
    ),
  };
  const hasNumericRange = NUMBER_FILTERS.some(
    (field) =>
      query[`${field}Min`] !== undefined || query[`${field}Max`] !== undefined,
  );
  const base = currencyRows.filter((row) => {
    if (query.projectGroup && row.projectGroup !== query.projectGroup)
      return false;
    if (
      query.authorizationCode &&
      !row.authorization.codes.includes(query.authorizationCode)
    )
      return false;
    if (!matchesInvoiceOk(row, query.invoiceOk)) return false;
    const auth = row.authorization;
    if (query.authorizationState === 'coded' && !auth.codes.length)
      return false;
    if (
      query.authorizationState === 'blank' &&
      !(auth.status === 'matched' && auth.hasBlank && auth.codes.length === 0)
    )
      return false;
    if (
      query.authorizationState === 'mixed' &&
      !(auth.status === 'matched' && auth.hasBlank && auth.codes.length > 0)
    )
      return false;
    if (query.authorizationState === 'unmatched' && auth.status !== 'unmatched')
      return false;
    if (query.authorizationState === 'multiple' && auth.codes.length <= 1)
      return false;
    if (
      query.representative &&
      !row.representatives.includes(query.representative)
    )
      return false;
    if (query.broker && !row.brokers.includes(query.broker)) return false;
    if (query.customer && row.identity.customerCode !== query.customer)
      return false;
    if (query.unit && row.identity.unitCode !== query.unit) return false;
    if (!dateInRange(row.oldestDueDate, query.dueFrom, query.dueTo))
      return false;
    if (
      !dateInRange(row.effectiveDueDate, query.followUpFrom, query.followUpTo)
    )
      return false;
    if (
      (query.invoiceFrom || query.invoiceTo) &&
      !row.invoiceDates.some((date) =>
        dateInRange(date, query.invoiceFrom, query.invoiceTo),
      )
    )
      return false;
    if (hasNumericRange && row.incompleteRows > 0) return false;
    if (!numberInRange(row.outstanding, query.balanceMin, query.balanceMax))
      return false;
    if (
      !numberInRange(
        row.overdueAmount,
        query.overdueAmountMin,
        query.overdueAmountMax,
      )
    )
      return false;
    if (
      !numberInRange(
        row.overdueDays,
        query.overdueDaysMin,
        query.overdueDaysMax,
      )
    )
      return false;
    if (
      query.paymentState !== 'all' &&
      paymentState(row) !== query.paymentState
    )
      return false;
    if (query.trackingRecord === 'exists' && !row.tracking) return false;
    if (query.trackingRecord === 'none' && row.tracking) return false;
    if (query.deferral === 'exists' && !row.tracking?.trackingDate)
      return false;
    if (query.deferral === 'none' && row.tracking?.trackingDate) return false;
    if (query.dataQuality === 'complete' && row.incompleteRows > 0)
      return false;
    if (query.dataQuality === 'incomplete' && row.incompleteRows === 0)
      return false;
    if (
      query.project &&
      !row.projects.some((project) => project.code === query.project)
    )
      return false;
    if (query.priority === 'high' && row.tracking?.priority !== 'high')
      return false;
    const assignee = row.tracking?.assigneeId ?? null;
    if (query.assignee === 'me' && assignee !== actor.id) return false;
    if (query.assignee === 'unassigned' && assignee !== null) return false;
    if (
      !['all', 'me', 'unassigned'].includes(query.assignee) &&
      assignee !== query.assignee
    )
      return false;
    if (query.q) {
      const haystack = [
        row.identity.customerCode,
        row.identity.unitCode,
        ...row.customerNames,
        ...row.unitNames,
        ...row.authorization.codes,
        ...row.representatives,
        ...row.brokers,
        ...row.projects.flatMap((project) => [project.code, project.name]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr');
      if (!haystack.includes(query.q)) return false;
    }
    return true;
  });
  const filtered = base.filter((row) => {
    if (query.scope === 'all') return true;
    if (query.scope === 'closed') return row.fullyPaid;
    if (query.scope === 'actionable') return isActionable(row);
    if (query.scope === 'overdue') return (row.overdueAmount ?? 0) > 0;
    if (query.scope === 'open') return (row.outstanding ?? 0) > 0;
    return row.trackingStatus === query.scope;
  });
  filtered.sort((a, b) => {
    if (query.scope === 'all' && a.fullyPaid !== b.fullyPaid)
      return a.fullyPaid ? 1 : -1;
    // Monetary values from different currencies have no shared ordering.
    // Currency groups stay ascending even when amounts are sorted descending.
    if (
      currencyMode === 'all' &&
      ['amount', 'paid', 'outstanding', 'overdueAmount'].includes(
        query.sortBy,
      ) &&
      a.identity.currency !== b.identity.currency
    ) {
      if (a.identity.currency === null) return 1;
      if (b.identity.currency === null) return -1;
      return a.identity.currency.localeCompare(b.identity.currency, 'en');
    }
    const key = query.sortBy as
      | 'overdueDays'
      | 'outstanding'
      | 'effectiveDueDate'
      | 'customerName'
      | 'unitName'
      | 'amount'
      | 'paid'
      | 'overdueAmount'
      | 'oldestDueDate'
      | 'nextDueDate'
      | 'trackingOverdueDays';
    const left = a[key],
      right = b[key];
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const compared =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left ?? '').localeCompare(String(right ?? ''), 'tr');
    return (
      compared * (query.sortDir === 'asc' ? 1 : -1) ||
      a.key.localeCompare(b.key)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const sourceKeys = new Set(snapshot.cases.map((item) => item.key));
  const baseByCurrency = rowsByCurrency(base);
  const filteredByCurrency = rowsByCurrency(filtered);
  const currencyBreakdown = currencies.map(({ value: currency }) => ({
    currency,
    total: filteredByCurrency.get(currency)?.length ?? 0,
    summary: summarizeRows(baseByCurrency.get(currency) ?? []),
    filteredSummary: summarizeRows(filteredByCurrency.get(currency) ?? []),
  }));
  const { cases: _cases, ...source } = snapshot;
  void _cases;
  return {
    source,
    selectedCurrency,
    currencyMode,
    currencyBreakdown,
    selectedPaymentKind: query.paymentKind,
    selectedProjectGroup: query.projectGroup,
    selectedInvoiceOk: query.invoiceOk,
    invoiceOkOptions: invoiceOkFilterOptions(currencyRows),
    projectGroups,
    currencies,
    projects: [...projectsMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'tr'),
    ),
    filterOptions: options,
    // State navigation retains its portfolio counts; displayed amounts follow
    // every active filter, including state, across the complete result set.
    summary: summarizeRows(base, currencyMode === 'single'),
    filteredSummary: summarizeRows(filtered, currencyMode === 'single'),
    orphanedTrackingCount: states.filter((state) => !sourceKeys.has(state.key))
      .length,
    rows: filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
    page,
    pageSize: query.pageSize,
    total: filtered.length,
    totalPages,
  };
}
export function parseTrackingAction(input: unknown): PaymentTrackingAction {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid('İşlem bilgisi gerekli.');
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) =>
        ![
          'type',
          'expectedVersion',
          'body',
          'trackingDate',
          'assigneeId',
          'priority',
          'channel',
        ].includes(key),
    )
  )
    invalid('Desteklenmeyen işlem alanı.');
  const type = option(
    body.type,
    'type',
    ['defer', 'reset', 'note', 'assign', 'priority', 'contact'],
    '',
  ) as PaymentTrackingAction['type'];
  if (
    typeof body.expectedVersion !== 'number' ||
    !Number.isInteger(body.expectedVersion) ||
    body.expectedVersion < 0 ||
    body.expectedVersion > 2147483646
  )
    invalid('Geçerli kayıt sürümü gerekli.');
  const result: PaymentTrackingAction = {
    type,
    expectedVersion: body.expectedVersion,
    body: text(body.body, 'body', 2000).trim(),
  };
  if (['defer', 'reset', 'note', 'contact'].includes(type) && !result.body)
    invalid('İşlem açıklaması veya not gerekli.');
  if (type === 'defer') {
    result.trackingDate = text(body.trackingDate, 'trackingDate', 10);
    paymentTrackingDate(result.trackingDate, 'Takip tarihi');
  }
  if (type === 'assign') {
    if (
      body.assigneeId !== null &&
      (typeof body.assigneeId !== 'string' ||
        !body.assigneeId ||
        body.assigneeId.length > 100)
    )
      invalid('Sorumlu kişi seçin veya atamayı kaldırın.');
    result.assigneeId = body.assigneeId;
  }
  if (type === 'priority')
    result.priority = option(
      body.priority,
      'priority',
      ['normal', 'high'],
      '',
    ) as 'normal' | 'high';
  if (type === 'contact')
    result.channel = option(
      body.channel,
      'channel',
      ['email', 'whatsapp', 'phone'],
      '',
    ) as 'email' | 'whatsapp' | 'phone';
  return result;
}

@Injectable()
export class PaymentTrackingService {
  constructor(
    private readonly source: PaymentTrackingSourceService,
    private readonly store: PaymentTrackingStoreService,
  ) {}

  async list(
    actor: PaymentActor,
    raw: Record<string, unknown>,
  ): Promise<PaymentTrackingList> {
    const query = parsePaymentQuery(raw);
    // Logo and workflow storage are independent. Overlap them while keeping
    // workflow reads sequential and their tracking state current.
    const [sourceRead, workflowRead] = await Promise.allSettled([
      this.source.snapshot(query.refresh),
      this.listWorkflow(query.refresh),
    ]);
    if (sourceRead.status === 'rejected') throw sourceRead.reason;
    if (workflowRead.status === 'rejected') throw workflowRead.reason;
    const snapshot = sourceRead.value;
    const { states, assignees } = workflowRead.value;
    return { ...paymentList(snapshot, states, actor, raw), assignees };
  }

  private async listWorkflow(forceFresh = false) {
    const states = await this.store.getMany();
    const assignees = await this.store.assignables(forceFresh);
    return { states, assignees };
  }

  private key(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) invalid('Geçersiz takip dosyası.');
  }
  async detail(
    key: string,
    raw: Record<string, unknown> = {},
  ): Promise<PaymentTrackingDetail> {
    this.key(key);
    if (Object.keys(raw).some((name) => name !== 'refresh'))
      invalid('Desteklenmeyen detay filtresi.');
    const refresh =
      option(raw.refresh, 'refresh', ['true', 'false'], 'false') === 'true';
    const snapshot = await this.source.snapshot(refresh);
    const item = snapshot.cases.find((item) => item.key === key);
    if (!item)
      throw new NotFoundException({
        code: 'PAYMENT_SOURCE_NOT_FOUND',
        message:
          'Bu müşteri/daire dosyası güncel kaynakta bulunamadı. Önceki takip kayıtları korunuyor.',
      });
    return this.describe(snapshot, item, refresh);
  }

  private async detailWorkflow(
    key: string,
    portfolioKeys: string[],
    forceFresh: boolean,
  ) {
    const states = await this.store.getMany(portfolioKeys);
    const history = await this.store.history(key);
    const assignees = await this.store.assignables(forceFresh);
    return { states, history, assignees };
  }

  private async describe(
    snapshot: PaymentSourceSnapshot,
    item: PaymentSourceCase,
    forceFresh = false,
  ): Promise<PaymentTrackingDetail> {
    const identity = portfolioIdentity(item);
    const cases =
      identity === null
        ? [item]
        : snapshot.cases.filter(
            (other) => portfolioIdentity(other) === identity,
          );
    const [workflowRead, contactRead] = await Promise.allSettled([
      this.detailWorkflow(
        item.key,
        cases.map((entry) => entry.key),
        forceFresh,
      ),
      this.source.contact(item.identity.customerCode),
    ]);
    if (workflowRead.status === 'rejected') throw workflowRead.reason;
    if (contactRead.status === 'rejected') throw contactRead.reason;
    const { states, history, assignees } = workflowRead.value;
    const local = new Map(states.map((state) => [state.key, state]));
    const fullyPaid = isPortfolioClosed(item, closedPortfolios(cases));
    const groups = paymentProjectGroups(cases);
    const contact = contactRead.value;
    const { cases: _cases, ...source } = snapshot;
    void _cases;
    return {
      source,
      item: trackingRow(
        item,
        local.get(item.key) ?? null,
        snapshot.asOf,
        fullyPaid,
        groups.get(item.key) ?? 'UNKNOWN',
      ),
      installments: item.installments,
      portfolio: {
        fullyPaid,
        cases: cases.map((entry) =>
          trackingRow(
            entry,
            local.get(entry.key) ?? null,
            snapshot.asOf,
            fullyPaid,
            groups.get(entry.key) ?? 'UNKNOWN',
          ),
        ),
        installments: cases.flatMap((entry) =>
          entry.installments.map((installment) => ({
            ...installment,
            caseKey: entry.key,
            currency: entry.identity.currency,
          })),
        ),
      },
      history: history.items,
      historyHasMore: history.hasMore,
      assignees,
      contact,
    };
  }
  async action(
    key: string,
    input: unknown,
    actor: PaymentActor,
  ): Promise<PaymentTrackingDetail> {
    this.key(key);
    const action = parseTrackingAction(input);
    // Re-read the source before a write; a paid/changed obligation must not be deferred from an old screen.
    const snapshot = await this.source.snapshot(true);
    const item = snapshot.cases.find((item) => item.key === key);
    if (!item)
      throw new NotFoundException({
        code: 'PAYMENT_SOURCE_NOT_FOUND',
        message: 'Dosya güncel kaynakta bulunamadı; işlem kaydedilmedi.',
      });
    if (!item.canTrack)
      invalid(
        item.trackingIssue || 'Kaynak kimliği takip kaydı için yeterli değil.',
      );
    if (action.type === 'defer') {
      if (
        item.outstanding === null ||
        item.outstanding <= 0 ||
        !item.oldestDueDate
      )
        invalid('Açık bakiyesi ve vadesi belli bir dosya ertelenebilir.');
      if (
        !action.trackingDate ||
        action.trackingDate <= snapshot.asOf ||
        action.trackingDate <= item.oldestDueDate
      )
        invalid('Yeni takip tarihi bugünden ve orijinal vadeden sonra olmalı.');
    }
    if (action.type === 'reset' && !(await this.store.get(key))?.trackingDate)
      invalid('Bu dosyada kaldırılacak bir erteleme yok.');
    await this.store.apply({
      key,
      sourceIdentity: item.identity,
      actor,
      ...action,
    });
    return this.describe(snapshot, item, true);
  }
}
