import { Prisma } from '@prisma/client';
const D = Prisma.Decimal;
type Numeric = string | number | Prisma.Decimal;
export const decimal = (v: Numeric) => new D(v);
export const money = (v: Numeric) =>
  decimal(v).toDecimalPlaces(2, D.ROUND_HALF_UP).toNumber();
export function claimTotals(claim: {
  taxRate: Numeric;
  adjustment: Numeric;
  deduction: Numeric;
  lines: { acceptedQty: Numeric; previousQty: Numeric; unitPrice: Numeric }[];
}) {
  // Sum unrounded extensions, then round each document-level amount to cents.
  const gross = claim.lines.reduce(
    (n, l) => n.plus(decimal(l.acceptedQty).times(l.unitPrice)),
    new D(0),
  );
  const base = gross.plus(claim.adjustment).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const tax = base
    .times(claim.taxRate)
    .div(100)
    .toDecimalPlaces(2, D.ROUND_HALF_UP);
  return {
    gross: money(gross),
    adjustment: money(claim.adjustment),
    base: money(base),
    tax: money(tax),
    deduction: money(claim.deduction),
    net: money(base.plus(tax).minus(claim.deduction)),
  };
}
export function budgetTotals(
  items: {
    quantity: Numeric;
    unitPrice: Numeric;
    sourceAmount: Numeric;
    completedQty: Numeric | null;
    paid: Numeric | null;
  }[],
) {
  const total = items.reduce(
    (n, l) => n.plus(decimal(l.quantity).times(l.unitPrice)),
    new D(0),
  );
  const source = items.reduce((n, l) => n.plus(l.sourceAmount), new D(0));
  const knownPaid = items.filter((l) => l.paid !== null);
  return {
    calculated: money(total),
    source: money(source),
    difference: money(total.minus(source)),
    knownPaid: money(knownPaid.reduce((n, l) => n.plus(l.paid!), new D(0))),
    paid:
      knownPaid.length === items.length && items.length
        ? money(knownPaid.reduce((n, l) => n.plus(l.paid!), new D(0)))
        : null,
    paidCoverage: knownPaid.length,
    itemCount: items.length,
  };
}
export function progressTotals(
  entries: { status: string; quality: string; trade: { weight: Numeric } }[],
) {
  const weight = entries.reduce((n, e) => n + Number(e.trade.weight), 0);
  const progress = entries.reduce(
    (n, e) => n + (e.status === 'DONE' ? Number(e.trade.weight) : 0),
    0,
  );
  const quality = entries.reduce(
    (n, e) =>
      n +
      Number(e.trade.weight) *
        (e.quality === 'SUITABLE' ? 1 : e.quality === 'PARTIAL' ? 0.5 : 0),
    0,
  );
  return {
    progress: weight ? Math.round((progress / weight) * 10000) / 100 : null,
    quality: weight ? Math.round((quality / weight) * 10000) / 100 : null,
    done: entries.filter((e) => e.status === 'DONE').length,
    checked: entries.filter((e) => e.quality !== 'UNCHECKED').length,
    defects: entries.filter((e) =>
      ['PARTIAL', 'UNSUITABLE'].includes(e.quality),
    ).length,
    total: entries.length,
  };
}
