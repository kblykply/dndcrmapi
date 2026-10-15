import { buildInstallmentTable } from './payment-installment-table';
import type { PaymentSourceSnapshot } from './payment-tracking.types';

function snapshot(): PaymentSourceSnapshot {
  return {
    asOf: '2026-10-14',
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
  it('groups all installments by year and month before pagination, preserving undated rows', () => {
    const data = snapshot();
    data.cases[0].installments.push({
      ...data.cases[0].installments[0],
      sequence: 5,
      dueDate: '2027-01-01',
    });
    const result = buildInstallmentTable(data);
    expect(result.years.map((group) => group.year)).toEqual([
      '2026',
      '2027',
      'undated',
    ]);
    expect(result.years[0].count).toBe(2);
    expect(result.years[0].months[0]).toMatchObject({
      month: '2026-10',
      count: 2,
      amount: 150,
      paid: 70,
      outstanding: 80,
    });
    expect(result.years[2].months).toEqual([]);
    expect(
      buildInstallmentTable(data, { year: '2027', month: '2027-01' }).rows.map(
        (row) => row.sequence,
      ),
    ).toEqual([5]);
    expect(
      buildInstallmentTable(data, { year: 'undated' }).rows.map(
        (row) => row.sequence,
      ),
    ).toEqual([3]);
    expect(() =>
      buildInstallmentTable(data, { year: '2026', month: '2027-01' }),
    ).toThrow();
  });
  it('shows all currencies as separate year groups and does not add their money together', () => {
    const result = buildInstallmentTable(snapshot(), { currency: '__ALL__' });
    expect(result.total).toBe(4);
    expect(
      result.years
        .filter((group) => group.year === '2026')
        .map((group) => group.currency)
        .sort(),
    ).toEqual(['EUR', 'GBP']);
    expect(result.totals).toEqual({
      amount: null,
      paid: null,
      outstanding: null,
    });
    expect(
      result.years.find((group) => group.currency === 'EUR')?.outstanding,
    ).toBe(10000);
  });
  it('overview excludes the entire current month, includes all older years, and remains independent of drilling and pagination', () => {
    const data = snapshot();
    data.cases[0].installments = [
      {
        ...data.cases[0].installments[0],
        sequence: 1,
        dueDate: '2024-01-01',
        amount: 100,
        paid: 80,
        outstanding: 20,
      },
      {
        ...data.cases[0].installments[0],
        sequence: 2,
        dueDate: '2026-09-30',
        amount: 200,
        paid: 50,
        outstanding: 150,
      },
      {
        ...data.cases[0].installments[0],
        sequence: 3,
        dueDate: '2026-10-01',
        amount: 300,
        paid: 10,
        outstanding: 290,
      },
      {
        ...data.cases[0].installments[0],
        sequence: 4,
        dueDate: '2027-01-01',
        amount: 400,
        paid: 0,
        outstanding: 400,
      },
    ];
    const result = buildInstallmentTable(data, {
      year: '2027',
      month: '2027-01',
      page: 2,
    });
    expect(result.previousMonthEnd).toBe('2026-09-30');
    expect(result.overview[0].throughPreviousMonth).toEqual({
      count: 2,
      amount: 300,
      paid: 130,
      outstanding: 170,
    });
    expect(result.overview[0].overall).toEqual({
      count: 4,
      amount: 1000,
      paid: 140,
      outstanding: 860,
    });
    data.asOf = '2027-01-01';
    expect(buildInstallmentTable(data).previousMonthEnd).toBe('2026-12-31');
  });
  it('uses DND and strictly blank authorization codes for rows, years and overview totals', () => {
    const data = snapshot();
    const baseline = buildInstallmentTable(data, { currency: '__ALL__' });
    const excluded = [
      { invoiceOk: { status: 'matched', values: ['OTHER'], hasBlank: false } },
      {
        invoiceOk: {
          status: 'matched',
          values: ['DND', 'OTHER'],
          hasBlank: false,
        },
      },
      {
        authorization: {
          status: 'matched',
          codes: ['INTERNAL'],
          hasBlank: false,
        },
      },
      {
        authorization: {
          status: 'matched',
          codes: ['INTERNAL'],
          hasBlank: true,
        },
      },
      { authorization: { status: 'unmatched', codes: [], hasBlank: true } },
    ];
    for (const [index, overrides] of excluded.entries()) {
      data.cases.push({
        ...structuredClone(data.cases[0]),
        key: `excluded-${index}`,
        ...overrides,
      } as (typeof data.cases)[number]);
    }
    const result = buildInstallmentTable(data, { currency: '__ALL__' });
    expect(result.rows).toEqual(baseline.rows);
    expect(result.years).toEqual(baseline.years);
    expect(result.overview).toEqual(baseline.overview);
  });
  it('exports the complete filtered result from one snapshot instead of the current page', () => {
    const data = snapshot();
    data.cases[0].installments = Array.from({ length: 123 }, (_, i) => ({
      ...data.cases[0].installments[0],
      sequence: i + 1,
    }));
    const paged = buildInstallmentTable(data, { page: 2 });
    const exported = buildInstallmentTable(
      data,
      { page: 2 },
      { allRows: true },
    );
    expect(paged.rows).toHaveLength(50);
    expect(exported.rows).toHaveLength(123);
    expect(exported.page).toBe(1);
    expect(exported.totalPages).toBe(1);
    expect(exported.totals).toEqual(paged.totals);
    expect(
      buildInstallmentTable(
        data,
        { currency: 'EUR' },
        { allRows: true },
      ).rows.every((row) => row.currency === 'EUR'),
    ).toBe(true);
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
