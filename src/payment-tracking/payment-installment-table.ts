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
    currency.length > 32
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
  const rows = eligible
    .filter((item) => (item.identity.currency ?? '__NULL__') === currency)
    .flatMap((item) =>
      item.installments
        .filter((line) => line.paymentKind === 'sale')
        .map((line) => ({
          ...line,
          id: `${item.key}:${line.sequence}`,
          caseKey: item.key,
          customerCode: item.identity.customerCode,
          customerName: item.customerName,
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
    pageSize = 50,
    totalPages = Math.max(1, Math.ceil(total / pageSize)),
    page = Math.min(requestedPage, totalPages);
  const sum = (field: 'amount' | 'paid' | 'outstanding') =>
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
