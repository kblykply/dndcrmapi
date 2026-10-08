import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  PaymentFilterOption,
  PaymentSourceCase,
  PaymentSourceSnapshot,
} from './payment-tracking.types';

const STATES = ['all', 'blank', 'mixed', 'unknown'];
const VALUE_PREFIX = 'value:';

/** Preserve raw special codes, including case and trailing spaces. */
export function parseInvoiceOkFilter(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'all';
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    // eslint-disable-next-line no-control-regex -- Query values must not contain controls.
    /[\u0000-\u001f]/.test(value) ||
    (!STATES.includes(value) &&
      !(
        value.startsWith(VALUE_PREFIX) &&
        value.slice(VALUE_PREFIX.length).trim()
      ))
  ) {
    throw new BadRequestException({
      code: 'PAYMENT_INVOICE_OK_INVALID',
      message: 'Fatura OK filtresi geçersiz.',
    });
  }
  return value;
}

/** A partition of whole cases. Never attribute a mixed case's full debt to one code. */
export function invoiceOkToken(
  item: Pick<PaymentSourceCase, 'invoiceOk'>,
): string {
  const field = item.invoiceOk;
  if (!field || field.status !== 'matched') return 'unknown';
  const values = [...new Set(field.values)];
  if (values.length + Number(field.hasBlank) > 1) return 'mixed';
  if (values.length === 1) return `${VALUE_PREFIX}${values[0]}`;
  return field.hasBlank ? 'blank' : 'unknown';
}

export function matchesInvoiceOk(
  item: Pick<PaymentSourceCase, 'invoiceOk'>,
  filter: string,
): boolean {
  return filter === 'all' || invoiceOkToken(item) === filter;
}

export function requireInvoiceOkSource(
  snapshot: PaymentSourceSnapshot,
  filter: string,
): void {
  if (filter === 'all') return;
  if (
    snapshot.authorizationSource.status !== 'available' ||
    snapshot.cases.some(
      (item) => !item.invoiceOk || item.invoiceOk.status === 'unavailable',
    )
  ) {
    throw new ServiceUnavailableException({
      code: 'PAYMENT_TRACKING_METADATA_UNAVAILABLE',
      message:
        'Fatura OK kaynağı şu anda okunamıyor. Yenileyin veya Fatura OK filtresinde Tümü seçin.',
    });
  }
}

export function invoiceOkFilterOptions(
  cases: Array<Pick<PaymentSourceCase, 'invoiceOk'>>,
): PaymentFilterOption[] {
  const counts = new Map<string, number>();
  const codes = new Set<string>();
  for (const item of cases) {
    const token = invoiceOkToken(item);
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (item.invoiceOk?.status === 'matched')
      for (const value of item.invoiceOk.values) codes.add(value);
  }
  const options = [...codes]
    .sort((a, b) => a.localeCompare(b, 'tr') || a.localeCompare(b))
    .map((label) => ({
      value: `${VALUE_PREFIX}${label}`,
      label,
      caseCount: counts.get(`${VALUE_PREFIX}${label}`) ?? 0,
    }));
  for (const [value, label] of [
    ['blank', 'Boş'],
    ['mixed', 'Karma'],
    ['unknown', 'Eşleşmeyen / Bilinmiyor'],
  ])
    options.push({ value, label, caseCount: counts.get(value) ?? 0 });
  return options;
}
