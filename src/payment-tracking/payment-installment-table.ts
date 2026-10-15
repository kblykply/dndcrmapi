import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  matchesInvoiceOk,
  requireInvoiceOkSource,
} from './payment-tracking-invoice-ok';
import { paymentProjectGroups } from './payment-tracking-project';
import type { PaymentSourceSnapshot } from './payment-tracking.types';

export function buildInstallmentTable(
  snapshot: PaymentSourceSnapshot,
  raw: Record<string, unknown> = {},
  options: { allRows?: boolean } = {},
) {
  requireInvoiceOkSource(snapshot, 'value:DND');
  if (snapshot.authorizationSource.status !== 'available')
    throw new ServiceUnavailableException(
      'Payment authorization source unavailable',
    );
  const currency = String(raw.currency || 'GBP');
  const search = String(raw.search || '')
    .trim()
    .toLocaleLowerCase('tr-TR');
  const status = String(raw.status || 'all');
  const sort = String(raw.sort || 'dueDate');
  const direction = raw.direction === 'desc' ? -1 : 1;
  const requestedPage = Number(raw.page || 1);
  const year = String(raw.year || '');
  const month = String(raw.month || '');
  if (
    !['all', 'open', 'overdue', 'paid'].includes(status) ||
    ![
      'dueDate',
      'customerName',
      'unitCode',
      'amount',
      'paid',
      'outstanding',
    ].includes(sort) ||
    !Number.isSafeInteger(requestedPage) ||
    requestedPage < 1 ||
    search.length > 200 ||
    currency.length > 32 ||
    (year !== '' && year !== 'undated' && !/^\d{4}$/.test(year)) ||
    (month !== '' &&
      (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.slice(0, 4) !== year))
  )
    throw new BadRequestException('Invalid installment table filters');
  const projects = paymentProjectGroups(snapshot.cases);
  const eligible = snapshot.cases.filter(
    (item) =>
      matchesInvoiceOk(item, 'value:DND') &&
      item.authorization.status === 'matched' &&
      item.authorization.hasBlank &&
      item.authorization.codes.length === 0,
  );
  const currencies = [
    ...new Set(eligible.map((item) => item.identity.currency)),
  ];
  const matchingRows = eligible
    .filter(
      (item) =>
        currency === '__ALL__' ||
        (item.identity.currency ?? '__NULL__') === currency,
    )
    .flatMap((item) =>
      item.installments
        .filter((line) => line.paymentKind === 'sale')
        .map((line) => ({
          ...line,
          id: `${item.key}:${line.sequence}`,
          caseKey: item.key,
          customerCode: item.identity.customerCode,
          customerName: item.customerName,
          representatives: item.representatives ?? [],
          brokers: item.brokers ?? [],
          unitCode: item.identity.unitCode,
          unitName: item.unitName,
          currency: item.identity.currency,
          projectGroup: projects.get(item.key) ?? 'UNKNOWN',
        })),
    )
    .filter(
      (row) =>
        (!search ||
          [row.customerName, row.customerCode, row.unitCode, row.unitName].some(
            (value) => value?.toLocaleLowerCase('tr-TR').includes(search),
          )) &&
        (status === 'all' ||
          (status === 'open' &&
            row.outstanding !== null &&
            row.outstanding > 0) ||
          (status === 'paid' && row.outstanding === 0) ||
          (status === 'overdue' && row.status === 'overdue')),
    );
  type Row = (typeof matchingRows)[number];
  const totalsFor = (rows: Row[]) => {
    const sum = (field: 'amount' | 'paid' | 'outstanding') =>
      rows.some((row) => row[field] === null)
        ? null
        : rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
    return {
      count: rows.length,
      amount: sum('amount'),
      paid: sum('paid'),
      outstanding: sum('outstanding'),
    };
  };
  const currentMonthStart = `${snapshot.asOf.slice(0, 7)}-01`;
  const previousMonthEnd = new Date(
    Date.parse(`${currentMonthStart}T00:00:00Z`) - 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const overview = [...new Set(matchingRows.map((row) => row.currency))].map(
    (currency) => {
      const all = matchingRows.filter((row) => row.currency === currency);
      return {
        currency,
        overall: totalsFor(all),
        throughPreviousMonth: totalsFor(
          all.filter(
            (row) => row.dueDate !== null && row.dueDate < currentMonthStart,
          ),
        ),
        undated: totalsFor(all.filter((row) => row.dueDate === null)),
      };
    },
  );
  const grouped = new Map<string, Row[]>();
  for (const row of matchingRows) {
    const key = JSON.stringify([
      row.dueDate?.slice(0, 4) ?? 'undated',
      row.currency,
    ]);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const years = [...grouped]
    .sort(([a], [b]) =>
      a.includes('undated')
        ? 1
        : b.includes('undated')
          ? -1
          : a.localeCompare(b),
    )
    .map(([key, entries]) => ({
      year: JSON.parse(key)[0] as string,
      currency: JSON.parse(key)[1] as string | null,
      ...totalsFor(entries),
      months: [
        ...new Set(
          entries.flatMap((row) =>
            row.dueDate ? [row.dueDate.slice(0, 7)] : [],
          ),
        ),
      ]
        .sort()
        .map((month) => ({
          month,
          ...totalsFor(entries.filter((row) => row.dueDate?.startsWith(month))),
        })),
    }));
  const rows = matchingRows.filter(
    (row) =>
      (!year || (row.dueDate?.slice(0, 4) ?? 'undated') === year) &&
      (!month || row.dueDate?.startsWith(month)),
  );
  rows.sort((a, b) => {
    const left = a[sort as keyof typeof a],
      right = b[sort as keyof typeof b];
    if (left === null || right === null)
      return left === right ? a.id.localeCompare(b.id) : left === null ? 1 : -1;
    const compared =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'tr');
    return compared * direction || a.id.localeCompare(b.id);
  });
  const total = rows.length,
    pageSize = options.allRows ? Math.max(1, rows.length) : 50,
    totalPages = Math.max(1, Math.ceil(total / pageSize)),
    page = options.allRows ? 1 : Math.min(requestedPage, totalPages);
  const sum = (field: 'amount' | 'paid' | 'outstanding') =>
    new Set(rows.map((row) => row.currency)).size > 1 ||
    rows.some((row) => row[field] === null)
      ? null
      : rows.reduce((value, row) => value + (row[field] ?? 0), 0);
  const { cases: ignored, ...source } = snapshot;
  void ignored;
  return {
    source,
    currency,
    search,
    status,
    sort,
    direction: direction === 1 ? 'asc' : 'desc',
    currencies,
    year,
    month,
    years,
    overview,
    previousMonthEnd,
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    totalPages,
    totals: {
      amount: sum('amount'),
      paid: sum('paid'),
      outstanding: sum('outstanding'),
    },
  };
}
