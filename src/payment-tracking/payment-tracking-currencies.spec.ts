import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import {
  parsePaymentQuery,
  paymentList,
  PaymentTrackingService,
} from './payment-tracking.service';
import {
  paymentTrackingCaseKey,
  PaymentTrackingSourceService,
} from './payment-tracking-source.service';
import { PaymentTrackingStoreService } from './payment-tracking-store.service';
import type {
  PaymentKind,
  PaymentSourceCase,
  PaymentSourceSnapshot,
  PaymentTrackingState,
} from './payment-tracking.types';

const actor = { id: 'currency-accountant', role: 'ACCOUNTING' };
const moneyFields = [
  'outstanding',
  'overdueAmount',
  'actionableAmount',
] as const;
const amountFilters = [
  'balanceMin',
  'balanceMax',
  'overdueAmountMin',
  'overdueAmountMax',
] as const;
const asOf = '2026-10-02';
function item(
  index: number,
  currency: string | null,
  outstanding = 80,
  options: {
    kind?: PaymentKind;
    paid?: number;
    dueDate?: string;
    patch?: Partial<PaymentSourceCase>;
  } = {},
): PaymentSourceCase {
  const identity = {
    customerCode: `C-${index}`,
    unitCode: `LJ-A${index}`,
    currency,
  };
  const kind = options.kind ?? 'sale';
  const projectCode =
    kind === 'sale' ? identity.unitCode : kind === 'vat' ? 'KDV' : 'TRAFO';
  const paid = options.paid ?? 20;
  const dueDate = options.dueDate ?? '2026-09-01';
  const overdue = outstanding > 0 && dueDate < asOf;
  const overdueDays = overdue
    ? Math.round((Date.parse(asOf) - Date.parse(dueDate)) / 86_400_000)
    : 0;
  return {
    key: paymentTrackingCaseKey(identity),
    identity,
    customerName: `Customer ${index}`,
    customerNames: [`Customer ${index}`],
    unitName: identity.unitCode,
    unitNames: [identity.unitCode],
    projects: [{ code: projectCode, name: projectCode }],
    representatives: ['REP-1'],
    brokers: ['BROKER-1'],
    invoiceDates: ['2026-08-01'],
    authorization: { codes: [], hasBlank: true, status: 'matched' },
    installmentCount: 1,
    incompleteRows: currency === null ? 1 : 0,
    amount: outstanding + paid,
    paid,
    outstanding,
    overdueAmount: overdue ? outstanding : 0,
    overdueCount: overdue ? 1 : 0,
    dueTodayAmount: dueDate === asOf ? outstanding : 0,
    oldestDueDate: outstanding > 0 ? dueDate : null,
    nextDueDate: dueDate >= asOf && outstanding > 0 ? dueDate : null,
    overdueDays,
    canTrack: currency !== null,
    trackingIssue: null,
    installments: [
      {
        sequence: 1,
        projectCode,
        paymentKind: kind,
        dueDate,
        amount: outstanding + paid,
        paid,
        outstanding,
        overdueDays,
        status:
          outstanding === 0
            ? 'paid'
            : overdue
              ? 'overdue'
              : dueDate === asOf
                ? 'today'
                : 'upcoming',
      },
    ],
    ...options.patch,
  };
}
function snapshot(cases: PaymentSourceCase[]): PaymentSourceSnapshot {
  return {
    database: 'LOGO_DND',
    view: 'L_223_ODEME_PLANI',
    asOf,
    generatedAt: `${asOf}T12:00:00.000Z`,
    recordCount: cases.reduce((sum, entry) => sum + entry.installmentCount, 0),
    cases,
    authorizationSource: {
      view: 'L_223_FATURA_VADE',
      status: 'available',
      matchedCases: cases.length,
      unmatchedCases: 0,
      multipleCodeCases: 0,
      message: null,
    },
  };
}
function state(
  row: PaymentSourceCase,
  changes: Partial<PaymentTrackingState> = {},
): PaymentTrackingState {
  return {
    key: row.key,
    sourceIdentity: row.identity,
    trackingDate: null,
    assigneeId: null,
    assigneeName: null,
    priority: 'normal',
    version: 3,
    updatedAt: `${asOf}T11:00:00.000Z`,
    updatedByName: 'Synthetic',
    ...changes,
  };
}
function list(
  cases: PaymentSourceCase[],
  query: Record<string, unknown> = {},
  states: PaymentTrackingState[] = [],
) {
  return paymentList(snapshot(cases), states, actor, {
    currency: '__ALL__',
    scope: 'all',
    ...query,
  });
}
function portfolio() {
  const cases = [
    item(1, 'GBP'),
    item(2, 'GBP', 120),
    item(1, 'TL', 300, { kind: 'vat' }),
    item(3, 'EUR', 50, { kind: 'transformer', dueDate: '2026-11-01' }),
    item(4, 'EUR', 0),
    item(5, null, 0, {
      patch: {
        amount: null,
        paid: null,
        outstanding: null,
        overdueAmount: null,
        incompleteRows: 2,
      },
    }),
  ];
  return { cases, states: [state(cases[1], { trackingDate: '2026-11-01' })] };
}

describe('Payment all-currency request validation', () => {
  it('accepts explicit all and unknown tokens while retaining the empty/default single selection', () => {
    expect(parsePaymentQuery({}).currency).toBeUndefined();
    expect(parsePaymentQuery({ currency: '' }).currency).toBeUndefined();
    expect(parsePaymentQuery({ currency: '__ALL__' }).currency).toBe('__ALL__');
    expect(parsePaymentQuery({ currency: '__NULL__' }).currency).toBe(
      '__NULL__',
    );
  });

  it.each(amountFilters)(
    'rejects all-currency %s, including zero, in the parser and direct list',
    (field) => {
      for (const value of [0, '0', '100.25']) {
        const query = { currency: '__ALL__', [field]: value };
        expect(() => parsePaymentQuery(query)).toThrow(
          'Choose a single currency for amount filters',
        );
        expect(() => list([item(1, 'GBP')], query)).toThrow(
          BadRequestException,
        );
      }
    },
  );

  it('rejects conflicting all-currency amount filters before either source or workflow reads', async () => {
    const source = { snapshot: jest.fn() };
    const store = { getMany: jest.fn(), assignables: jest.fn() };
    const service = new PaymentTrackingService(
      source as unknown as PaymentTrackingSourceService,
      store as unknown as PaymentTrackingStoreService,
    );
    await expect(
      service.list(actor, { currency: '__ALL__', balanceMin: '0' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(source.snapshot).not.toHaveBeenCalled();
    expect(store.getMany).not.toHaveBeenCalled();
  });

  it('ignores empty amount filters and allows date, day-count and single-currency amount ranges', () => {
    expect(
      parsePaymentQuery({
        currency: '__ALL__',
        balanceMin: '',
        balanceMax: null,
        overdueDaysMin: '0',
        overdueDaysMax: '50',
        dueFrom: '2026-01-01',
      }),
    ).toMatchObject({
      currency: '__ALL__',
      overdueDaysMin: 0,
      overdueDaysMax: 50,
      dueFrom: '2026-01-01',
    });
    for (const currency of ['GBP', '__NULL__'])
      expect(
        parsePaymentQuery({ currency, balanceMin: '0', balanceMax: '100' }),
      ).toMatchObject({ balanceMin: 0, balanceMax: 100 });
    const { cases } = portfolio();
    const ranged = list(cases, { overdueDaysMin: '30', overdueDaysMax: '40' });
    expect(ranged.rows.map((row) => row.identity.currency).sort()).toEqual([
      'GBP',
      'GBP',
      'TL',
    ]);
    expect(ranged.filteredSummary.incompleteRows).toBe(0);
  });
});

describe('Payment currency breakdown and compatibility', () => {
  it('counts all selected cases while never creating a cross-currency money total', () => {
    const { cases, states } = portfolio();
    const result = list(cases, { scope: 'actionable' }, states);
    expect(result.currencyMode).toBe('all');
    expect(result.selectedCurrency).toBeNull();
    expect(result.total).toBe(2);
    expect(result.summary).toMatchObject({
      openCount: 4,
      closedCount: 1,
      overdueCount: 3,
      actionableCount: 2,
      deferredCount: 1,
      incompleteRows: 2,
    });
    expect(result.filteredSummary).toMatchObject({
      openCount: 2,
      closedCount: 0,
      actionableCount: 2,
      incompleteRows: 0,
    });
    for (const field of moneyFields) {
      expect(result.summary[field]).toBeNull();
      expect(result.filteredSummary[field]).toBeNull();
    }
    const gbp = result.currencyBreakdown.find((row) => row.currency === 'GBP')!;
    expect(gbp.total).toBe(1);
    expect(gbp.summary).toMatchObject({
      outstanding: 200,
      overdueAmount: 200,
      actionableAmount: 80,
      deferredCount: 1,
    });
    expect(gbp.filteredSummary).toMatchObject({
      outstanding: 80,
      overdueAmount: 80,
      actionableAmount: 80,
    });
    const tl = result.currencyBreakdown.find((row) => row.currency === 'TL')!;
    expect(tl).toMatchObject({
      total: 1,
      summary: { outstanding: 300 },
      filteredSummary: { outstanding: 300 },
    });
    const eur = result.currencyBreakdown.find((row) => row.currency === 'EUR')!;
    expect(eur).toMatchObject({
      total: 0,
      summary: { outstanding: 50, closedCount: 1 },
      filteredSummary: { outstanding: 0 },
    });
    const unknown = result.currencyBreakdown.find(
      (row) => row.currency === null,
    )!;
    expect(unknown).toMatchObject({
      total: 0,
      summary: { outstanding: null, incompleteRows: 2 },
      filteredSummary: { outstanding: 0 },
    });
  });

  it.each([
    {},
    { scope: 'actionable' },
    { scope: 'deferred' },
    { scope: 'closed' },
    { scope: 'paid' },
    { scope: 'overdue' },
    { paymentKind: 'vat' },
    {
      projectGroup: 'LA_JOYA',
      paymentKind: 'sale',
      authorizationState: 'blank',
    },
    { customer: 'C-1' },
    { representative: 'REP-1', broker: 'BROKER-1', invoiceFrom: '2026-08-01' },
    { project: 'KDV' },
    { overdueDaysMin: '1' },
    { q: 'absent' },
  ])(
    'matches the union and separate-currency summaries for intersection %j',
    (query) => {
      const { cases, states } = portfolio();
      const all = list(cases, query, states);
      const singleKeys: string[] = [];
      for (const currency of all.currencies) {
        const single = list(
          cases,
          { ...query, currency: currency.value ?? '__NULL__' },
          states,
        );
        const breakdown = all.currencyBreakdown.find(
          (row) => row.currency === currency.value,
        )!;
        expect(breakdown.total).toBe(single.total);
        expect(breakdown.summary).toEqual(single.summary);
        expect(breakdown.filteredSummary).toEqual(single.filteredSummary);
        singleKeys.push(...single.rows.map((row) => row.key));
      }
      expect(all.rows.map((row) => row.key).sort()).toEqual(singleKeys.sort());
      expect(new Set(singleKeys).size).toBe(all.total);
      expect(
        all.currencyBreakdown.reduce((sum, row) => sum + row.total, 0),
      ).toBe(all.total);
      expect(all.currencyBreakdown.map((row) => row.currency)).toEqual(
        all.currencies.map((row) => row.value),
      );
      for (const field of [
        'openCount',
        'closedCount',
        'overdueCount',
        'actionableCount',
        'deferredCount',
        'todayCount',
        'unassignedCount',
        'incompleteRows',
      ] as const) {
        expect(all.summary[field]).toBe(
          all.currencyBreakdown.reduce(
            (sum, entry) => sum + entry.summary[field],
            0,
          ),
        );
        expect(all.filteredSummary[field]).toBe(
          all.currencyBreakdown.reduce(
            (sum, entry) => sum + entry.filteredSummary[field],
            0,
          ),
        );
      }
    },
  );

  it('preserves default-by-source-count, explicit single, and unknown-currency modes', () => {
    const cases = [
      item(1, 'GBP', 80, { patch: { installmentCount: 3 } }),
      item(2, 'EUR', 20),
      item(3, null, 10),
    ];
    for (const raw of [{}, { currency: '' }, { currency: 'GBP' }]) {
      const single = paymentList(snapshot(cases), [], actor, {
        scope: 'all',
        ...raw,
      });
      expect(single.currencyMode).toBe('single');
      expect(single.selectedCurrency).toBe('GBP');
      expect(single.summary.outstanding).toBe(80);
      expect(
        single.currencyBreakdown.find((row) => row.currency === 'GBP')?.summary,
      ).toEqual(single.summary);
      expect(
        single.currencyBreakdown
          .filter((row) => row.currency !== 'GBP')
          .every((row) => row.total === 0 && row.summary.outstanding === 0),
      ).toBe(true);
    }
    const unknown = list(cases, { currency: '__NULL__' });
    expect(unknown.currencyMode).toBe('single');
    expect(unknown.selectedCurrency).toBeNull();
    expect(unknown.rows.map((row) => row.identity.currency)).toEqual([null]);
    expect(unknown.summary.outstanding).toBe(10);
    expect(() => list(cases, { currency: 'gbp' })).toThrow(BadRequestException);
  });

  it('returns money null in all mode even for empty results or a source with just one currency', () => {
    for (const result of [
      list([]),
      list([item(1, 'GBP')]),
      list([item(1, 'GBP')], { q: 'absent' }),
    ])
      for (const field of moneyFields) {
        expect(result.summary[field]).toBeNull();
        expect(result.filteredSummary[field]).toBeNull();
      }
    expect(list([]).currencyBreakdown).toEqual([]);
    const noMatch = list([item(1, 'GBP')], { q: 'absent' });
    expect(noMatch.currencyBreakdown).toHaveLength(1);
    expect(noMatch.currencyBreakdown[0]).toMatchObject({
      currency: 'GBP',
      total: 0,
      summary: { outstanding: 0 },
    });
  });

  it('keeps per-currency totals independent of pagination and requested amount sorting', () => {
    const cases = Array.from({ length: 60 }, (_, index) =>
      item(index, index % 2 ? 'GBP' : 'TL', 100),
    );
    const reference = list(cases);
    for (const page of [1, 2, 3]) {
      const result = list(cases, {
        page,
        sortBy: 'outstanding',
        sortDir: 'desc',
      });
      expect(result.rows).toHaveLength(page === 3 ? 10 : 25);
      expect(result.total).toBe(60);
      expect(result.currencyBreakdown).toEqual(reference.currencyBreakdown);
      for (const currency of ['GBP', 'TL'])
        expect(
          result.currencyBreakdown.find((row) => row.currency === currency),
        ).toMatchObject({
          total: 30,
          summary: { outstanding: 3000 },
          filteredSummary: { outstanding: 3000 },
        });
    }
  });

  it('projects kinds without losing global closure, sibling identity, duplicates, orphan counts or source immutability', () => {
    const sale = item(1, 'GBP', 0);
    const tl = item(1, 'TL', 300, { kind: 'vat' });
    const duplicated = item(2, 'GBP');
    duplicated.installments = [
      duplicated.installments[0],
      { ...duplicated.installments[0], sequence: 2 },
    ];
    duplicated.installmentCount = 2;
    duplicated.amount = 200;
    duplicated.paid = 40;
    duplicated.outstanding = 160;
    duplicated.overdueAmount = 160;
    duplicated.overdueCount = 2;
    const cases = [sale, tl, duplicated];
    const states = [state(tl), state(item(99, 'GBP'))];
    const before = structuredClone({ cases, states });
    const result = list(cases, { paymentKind: 'sale' }, states);
    expect(result.total).toBe(2);
    expect(result.rows.find((row) => row.key === sale.key)?.fullyPaid).toBe(
      false,
    );
    expect(result.summary.closedCount).toBe(0);
    expect(
      result.currencyBreakdown.find((row) => row.currency === 'GBP'),
    ).toMatchObject({ total: 2, filteredSummary: { outstanding: 160 } });
    expect(
      result.currencyBreakdown.find((row) => row.currency === 'TL'),
    ).toMatchObject({ total: 0, filteredSummary: { outstanding: 0 } });
    expect(result.orphanedTrackingCount).toBe(1);
    expect(
      result.projectGroups.find((row) => row.value === 'LA_JOYA')?.caseCount,
    ).toBe(2);
    expect({ cases, states }).toEqual(before);
  });
});

describe('All-currency monetary sort safety', () => {
  it.each(['amount', 'paid', 'outstanding', 'overdueAmount'] as const)(
    'sorts %s only within a fixed ascending currency group, after global closed-last priority',
    (sortBy) => {
      const gbp1 = item(1, 'GBP', 100, { paid: 10 });
      const gbp2 = item(2, 'GBP', 50, { paid: 20 });
      const tl1 = item(3, 'TL', 1, { paid: 30 });
      const tl2 = item(4, 'TL', 2, { paid: 40 });
      const unknown = item(5, null, 500);
      const closed = item(6, 'GBP', 0);
      const missing = item(7, 'GBP', 80, {
        patch: { [sortBy]: null, incompleteRows: 1 },
      });
      const cases = [tl2, closed, missing, gbp1, unknown, tl1, gbp2];
      for (const sortDir of ['asc', 'desc']) {
        const gbpAsc = sortBy === 'paid' ? [gbp1, gbp2] : [gbp2, gbp1];
        const gbp = sortDir === 'asc' ? gbpAsc : [...gbpAsc].reverse();
        const tl = sortDir === 'asc' ? [tl1, tl2] : [tl2, tl1];
        const result = list(cases, { sortBy, sortDir });
        expect(result.rows.map((row) => row.key)).toEqual(
          [...gbp, missing, ...tl, unknown, closed].map((row) => row.key),
        );
      }
    },
  );

  it('keeps non-monetary sorting global and preserves ordinary single-currency sorting', () => {
    const cases = [item(2, 'GBP', 100), item(1, 'TL', 5), item(3, 'GBP', 20)];
    expect(
      list(cases, { sortBy: 'customerName', sortDir: 'asc' }).rows.map(
        (row) => row.customerName,
      ),
    ).toEqual(['Customer 1', 'Customer 2', 'Customer 3']);
    expect(
      list(cases, {
        currency: 'GBP',
        sortBy: 'outstanding',
        sortDir: 'asc',
      }).rows.map((row) => row.outstanding),
    ).toEqual([20, 100]);
  });
});
