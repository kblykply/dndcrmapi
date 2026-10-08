import { ServiceUnavailableException } from '@nestjs/common';
import type {
  PaymentInstallment,
  PaymentKind,
  PaymentKindFilter,
  PaymentSourceCase,
} from './payment-tracking.types';

/** Observed Logo project codes classify a payment line, never the entire customer case. */
export function paymentKindForProject(projectCode: string | null): PaymentKind {
  const code = projectCode?.trim().toLocaleUpperCase('tr-TR') ?? '';
  if (code === 'TRAFO') return 'transformer';
  if (code === 'KDV') return 'vat';
  if (code === 'ESYA' || code === 'EŞYA') return 'furniture';
  if (code === 'DEPOZİTO ELEKTRİK' || code === 'DEPOZITO ELEKTRIK')
    return 'deposit';
  if (/^GK-ARSA\d+$/.test(code)) return 'land';
  if (/^(?:LJP2?|LJ|LV|S)-[A-Z]\d+[A-Z]?(?:-[A-Z]\d+[A-Z]?)*$/.test(code))
    return 'sale';
  // Blank, new or ambiguous codes (including bare LJ and MO) stay visible under Other/All.
  return 'other';
}

function sumKnown(values: Array<number | null>): number | null {
  let total: number | null = null;
  for (const value of values) if (value !== null) total = (total ?? 0) + value;
  if (total !== null && !Number.isFinite(total))
    throw new ServiceUnavailableException({
      code: 'PAYMENT_TRACKING_SOURCE_AMOUNT_INVALID',
      message: 'Ödeme türünün toplam tutarı doğrulanamadı.',
    });
  return total;
}

function timedAmount(row: PaymentInstallment, status: 'overdue' | 'today') {
  if (row.outstanding === null || (row.outstanding > 0 && row.dueDate === null))
    return null;
  return row.status === status ? row.outstanding : 0;
}

/** A read-only projection; keys, workflow and the full source snapshot never change. */
export function selectPaymentKind(
  item: PaymentSourceCase,
  kind: PaymentKindFilter,
  asOf: string,
): PaymentSourceCase | null {
  if (kind === 'all') return item;
  const installments = item.installments.filter(
    (row) => row.paymentKind === kind,
  );
  if (!installments.length) return null;
  const projectCodes = new Set(installments.map((row) => row.projectCode));
  const openDates = installments
    .filter(
      (row) =>
        row.outstanding !== null && row.outstanding > 0 && row.dueDate !== null,
    )
    .map((row) => row.dueDate!)
    .sort();
  return {
    ...item,
    projects: item.projects.filter((project) => projectCodes.has(project.code)),
    installments,
    installmentCount: installments.length,
    incompleteRows: installments.filter(
      (row) =>
        row.amount === null ||
        row.paid === null ||
        row.dueDate === null ||
        !item.identity.currency?.trim(),
    ).length,
    amount: sumKnown(installments.map((row) => row.amount)),
    paid: sumKnown(installments.map((row) => row.paid)),
    outstanding: sumKnown(installments.map((row) => row.outstanding)),
    overdueAmount: sumKnown(
      installments.map((row) => timedAmount(row, 'overdue')),
    ),
    overdueCount: installments.filter((row) => row.status === 'overdue').length,
    dueTodayAmount: sumKnown(
      installments.map((row) => timedAmount(row, 'today')),
    ),
    oldestDueDate: openDates[0] ?? null,
    nextDueDate: openDates.find((date) => date >= asOf) ?? null,
    overdueDays: installments.reduce(
      (days, row) => Math.max(days, row.overdueDays),
      0,
    ),
  };
}
