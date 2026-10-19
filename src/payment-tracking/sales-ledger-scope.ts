import { ServiceUnavailableException } from '@nestjs/common';
import {
  matchesInvoiceOk,
  requireInvoiceOkSource,
} from './payment-tracking-invoice-ok';
import type { PaymentSourceSnapshot } from './payment-tracking.types';
export const normalizeSalesCode = (code: string) => code.trim().toUpperCase();
export function salesLedgerSnapshot(
  snapshot: PaymentSourceSnapshot,
  actorId: string | null,
  mappings: { code: string; userId: string }[],
): PaymentSourceSnapshot {
  requireInvoiceOkSource(snapshot, 'value:DND');
  if (snapshot.authorizationSource.status !== 'available')
    throw new ServiceUnavailableException('Satışçı kaynağı doğrulanamıyor.');
  const owners = new Map<string, string | null>();
  for (const mapping of mappings) {
    const code = normalizeSalesCode(mapping.code);
    const existing = owners.get(code);
    owners.set(
      code,
      existing === undefined || existing === mapping.userId
        ? mapping.userId
        : null,
    );
  }
  const cases = snapshot.cases.filter((item) => {
    const codes = [
      ...new Set(item.representatives.map(normalizeSalesCode).filter(Boolean)),
    ];
    return (
      (actorId === null ||
        (codes.length > 0 &&
          codes.every((code) => owners.get(code) === actorId))) &&
      matchesInvoiceOk(item, 'value:DND') &&
      item.authorization.status === 'matched' &&
      item.authorization.hasBlank &&
      item.authorization.codes.length === 0
    );
  });
  return {
    ...snapshot,
    cases,
    recordCount: cases.reduce((sum, item) => sum + item.installments.length, 0),
    audit: snapshot.audit
      ? {
          ...snapshot.audit,
          reviewCaseCount: cases.filter(
            (item) => item.sourceReview?.status === 'review_required',
          ).length,
        }
      : undefined,
    authorizationSource: {
      ...snapshot.authorizationSource,
      matchedCases: cases.length,
      unmatchedCases: 0,
      multipleCodeCases: 0,
    },
  };
}
