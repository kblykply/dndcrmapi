import { buildInstallmentTable } from './payment-installment-table';
import type { PaymentSourceSnapshot } from './payment-tracking.types';

function snapshot(): PaymentSourceSnapshot {
  return {
    authorizationSource: { status: 'available' },
    cases: [
      {
        key: 'a',
        identity: { currency: 'GBP', customerCode: 'C1', unitCode: 'LJ-A1' },
        customerName: 'Alice',
        unitName: 'Unit 1',
        projects: [],
        invoiceOk: { status: 'matched', values: ['DND'], hasBlank: false },
        authorization: { status: 'matched', hasBlank: true, codes: [] },
        installments: [
          {
            sequence: 1,
            paymentKind: 'sale',
            dueDate: '2026-10-01',
            amount: 100,
            paid: 20,
            outstanding: 80,
            status: 'overdue',
          },
          {
            sequence: 2,
            paymentKind: 'sale',
            dueDate: '2026-10-01',
            amount: 50,
            paid: 50,
            outstanding: 0,
            status: 'paid',
          },
          {
            sequence: 3,
            paymentKind: 'sale',
            dueDate: null,
            amount: null,
            paid: 0,
            outstanding: null,
            status: 'unknown',
          },
          {
            sequence: 4,
            paymentKind: 'vat',
            dueDate: '2026-10-01',
            amount: 20,
            paid: 0,
            outstanding: 20,
            status: 'overdue',
          },
        ],
      },
      {
        key: 'b',
        identity: { currency: 'EUR', customerCode: 'C2', unitCode: 'LJ-A2' },
        customerName: 'Bob',
        unitName: 'Unit 2',
        projects: [],
        invoiceOk: { status: 'matched', values: ['DND'], hasBlank: false },
        authorization: { status: 'matched', hasBlank: true, codes: [] },
        installments: [
          {
            sequence: 1,
            paymentKind: 'sale',
            dueDate: '2026-11-01',
            amount: 10000,
            paid: 0,
            outstanding: 10000,
            status: 'upcoming',
          },
        ],
      },
    ],
  } as unknown as PaymentSourceSnapshot;
}

describe('installment table', () => {
  it('keeps installments on the same date separate and preserves unknown dates and amounts', () => {
    const result = buildInstallmentTable(snapshot());
    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.id)).toEqual(['a:1', 'a:2', 'a:3']);
    expect(result.totals).toEqual({
      amount: null,
      paid: 70,
      outstanding: null,
    });
    expect(result.source).not.toHaveProperty('cases');
  });
  it('filters individual open and paid installments and never combines currencies', () => {
    expect(
      buildInstallmentTable(snapshot(), { status: 'open' }).totals.outstanding,
    ).toBe(80);
    expect(
      buildInstallmentTable(snapshot(), { status: 'paid' }).rows[0].sequence,
    ).toBe(2);
    expect(
      buildInstallmentTable(snapshot(), { currency: 'EUR' }).totals.outstanding,
    ).toBe(10000);
    expect(
      buildInstallmentTable(snapshot(), {
        search: 'unit 1',
        sort: 'amount',
        direction: 'desc',
      }).rows.map((row) => row.sequence),
    ).toEqual([1, 2, 3]);
  });
  it('paginates with stable identifiers and totals for all filtered rows', () => {
    const data = snapshot();
    data.cases[0].installments = Array.from({ length: 51 }, (_, i) => ({
      ...data.cases[0].installments[0],
      sequence: i + 1,
    }));
    const result = buildInstallmentTable(data, { page: 2 });
    expect(result.total).toBe(51);
    expect(result.rows).toHaveLength(1);
    expect(result.totals.outstanding).toBe(4080);
  });
  it('rejects invalid scopes and unavailable invoice metadata', () => {
    expect(() => buildInstallmentTable(snapshot(), { page: -1 })).toThrow();
    expect(() =>
      buildInstallmentTable(snapshot(), { sort: 'password' }),
    ).toThrow();
    const data = snapshot();
    data.authorizationSource.status = 'unavailable';
    expect(() => buildInstallmentTable(data)).toThrow();
  });
});
