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
  PaymentIdentity,
  PaymentKind,
  PaymentSourceCase,
  PaymentSourceSnapshot,
  PaymentTrackingState,
} from './payment-tracking.types';

const actor = { id: 'portfolio-accountant', role: 'ACCOUNTING' };
const asOf = '2026-10-02';

function item(
  identityPatch: Partial<PaymentIdentity> = {},
  outstanding = 0,
  paymentKind: PaymentKind = 'sale',
  patch: Partial<PaymentSourceCase> = {},
): PaymentSourceCase {
  const identity = {
    customerCode: 'CUSTOMER-1',
    unitCode: 'UNIT-1',
    currency: 'GBP',
    ...identityPatch,
  };
  const dueDate = outstanding > 0 ? '2026-10-01' : null;
  return {
    key: paymentTrackingCaseKey(identity),
    identity,
    customerName: 'Synthetic portfolio',
    unitName: 'Synthetic unit',
    customerNames: ['Synthetic portfolio'],
    unitNames: ['Synthetic unit'],
    projects: [{ code: paymentKind, name: paymentKind }],
    representatives: [],
    brokers: [],
    invoiceDates: [],
    authorization: { codes: [], hasBlank: true, status: 'matched' },
    installmentCount: 1,
    incompleteRows: 0,
    amount: 100,
    paid: 100 - outstanding,
    outstanding,
    overdueAmount: outstanding,
    overdueCount: outstanding > 0 ? 1 : 0,
    dueTodayAmount: 0,
    oldestDueDate: dueDate,
    nextDueDate: null,
    overdueDays: outstanding > 0 ? 1 : 0,
    canTrack: true,
    trackingIssue: null,
    installments: [
      {
        sequence: 1,
        projectCode: paymentKind,
        paymentKind,
        dueDate: '2026-10-01',
        amount: 100,
        paid: 100 - outstanding,
        outstanding,
        overdueDays: outstanding > 0 ? 1 : 0,
        status: outstanding > 0 ? 'overdue' : 'paid',
      },
    ],
    ...patch,
  };
}
function snapshot(cases: PaymentSourceCase[]): PaymentSourceSnapshot {
  return {
    database: 'LOGO_DND',
    view: 'L_223_ODEME_PLANI',
    asOf,
    generatedAt: `${asOf}T10:00:00.000Z`,
    recordCount: cases.reduce((sum, row) => sum + row.installmentCount, 0),
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
function list(cases: PaymentSourceCase[], query: Record<string, unknown> = {}) {
  return paymentList(snapshot(cases), [], actor, {
    currency: 'GBP',
    scope: 'all',
    ...query,
  });
}
function state(row: PaymentSourceCase, version = 1): PaymentTrackingState {
  return {
    key: row.key,
    sourceIdentity: row.identity,
    trackingDate: null,
    assigneeId: null,
    assigneeName: null,
    priority: 'normal',
    version,
    updatedAt: `${asOf}T10:00:00.000Z`,
    updatedByName: 'Synthetic',
  };
}
function setup(cases: PaymentSourceCase[]) {
  const source = {
    snapshot: jest.fn().mockResolvedValue(snapshot(cases)),
    contact: jest.fn().mockResolvedValue({
      email: null,
      phone: null,
      source: null,
      status: 'missing',
    }),
  };
  const store = {
    getMany: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    history: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    assignables: jest.fn().mockResolvedValue([actor]),
    apply: jest.fn().mockResolvedValue(null),
  };
  return {
    source,
    store,
    service: new PaymentTrackingService(
      source as unknown as PaymentTrackingSourceService,
      store as unknown as PaymentTrackingStoreService,
    ),
  };
}

describe('Payment portfolio closure across currencies and kinds', () => {
  it('keeps the actionable default and preserves paid as the selected-currency payment status', () => {
    expect(parsePaymentQuery({}).scope).toBe('actionable');
    expect(parsePaymentQuery({ scope: 'closed' }).scope).toBe('closed');
    const cases = [item(), item({ currency: 'TL' }, 80, 'vat')];
    const result = list(cases, { paymentKind: 'sale', scope: 'paid' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      outstanding: 0,
      trackingStatus: 'paid',
      fullyPaid: false,
    });
    expect(result.summary.closedCount).toBe(0);
    expect(result.filteredSummary.closedCount).toBe(0);
    expect(list(cases, { paymentKind: 'sale', scope: 'closed' }).total).toBe(0);
    expect(
      list(cases, { paymentKind: 'sale', scope: 'all' }).rows[0].fullyPaid,
    ).toBe(false);
  });

  it('does not call a paid sale closed while VAT in the same currency remains unpaid', () => {
    const sale = item();
    const vat = item({}, 50, 'vat');
    const mixed = item({}, 50, 'sale', {
      amount: 200,
      paid: 150,
      projects: [...sale.projects, ...vat.projects],
      installments: [
        sale.installments[0],
        { ...vat.installments[0], sequence: 2 },
      ],
      installmentCount: 2,
    });
    const result = list([mixed], { paymentKind: 'sale', scope: 'paid' });
    expect(result.rows[0]).toMatchObject({
      amount: 100,
      paid: 100,
      outstanding: 0,
      fullyPaid: false,
    });
    expect(list([mixed], { scope: 'closed' }).total).toBe(0);
    expect(list([mixed], { paymentKind: 'vat' }).rows[0].outstanding).toBe(50);
  });

  it('marks all siblings closed only when every currency and kind is complete and paid', () => {
    const gbp = item();
    const tl = item({ currency: 'TL' }, 0, 'vat');
    const unrelatedDebt = item({ unitCode: 'OTHER-UNIT', currency: 'TL' }, 90);
    const cases = [gbp, tl, unrelatedDebt];
    for (const [currency, paymentKind] of [
      ['GBP', 'sale'],
      ['TL', 'vat'],
    ]) {
      const result = list(cases, { currency, paymentKind, scope: 'closed' });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].fullyPaid).toBe(true);
      expect(result.summary.closedCount).toBe(1);
      expect(result.filteredSummary.closedCount).toBe(1);
    }
    expect(
      list(cases, { currency: 'TL', scope: 'all' }).rows.map(
        (row) => row.fullyPaid,
      ),
    ).toEqual([false, true]);
  });

  it.each([
    { customerCode: null },
    { customerCode: '' },
    { customerCode: '  ' },
    { unitCode: null },
    { unitCode: '' },
    { unitCode: '\t' },
    { currency: null },
    { currency: '' },
    { currency: '  ' },
  ])('never treats incomplete identity as closed: %j', (identityPatch) => {
    const row = item(identityPatch);
    const result = list([row], {
      currency: row.identity.currency ?? '__NULL__',
    });
    expect(result.rows[0].fullyPaid).toBe(false);
    expect(result.summary.closedCount).toBe(0);
  });

  it.each([
    { amount: null },
    { paid: null },
    { outstanding: null },
    { incompleteRows: 1 },
    { amount: NaN },
    { paid: Infinity },
  ])(
    'unknown financial information in any sibling prevents closure: %j',
    (patch) => {
      const cases = [item(), item({ currency: 'TL' }, 0, 'other', patch)];
      expect(list(cases).rows[0].fullyPaid).toBe(false);
      expect(list(cases, { scope: 'closed' }).total).toBe(0);
    },
  );

  it('an unknown-currency sibling prevents known-currency closure', () => {
    const cases = [item(), item({ currency: null })];
    expect(list(cases).rows[0].fullyPaid).toBe(false);
  });

  it('matches exact code pairs without merging names, partial codes or delimited collisions', () => {
    const selected = item({ customerCode: 'A|B', unitCode: 'C' });
    const others = [
      item({ customerCode: 'A', unitCode: 'B|C' }, 90),
      item({ customerCode: 'a|b', unitCode: 'C' }, 90),
      item({ customerCode: 'A|B ', unitCode: 'C' }, 90),
      item({ customerCode: 'A|B', unitCode: 'C ' }, 90),
    ];
    expect(
      list([selected, ...others], { customer: 'A|B', unit: 'C' }).rows[0]
        .fullyPaid,
    ).toBe(true);
  });

  it.each(['asc', 'desc'])(
    'places closed cases last for scope all and sorts within both groups (%s)',
    (sortDir) => {
      const cases = [
        item({ customerCode: 'C1' }, 0, 'sale', { customerName: 'A' }),
        item({ customerCode: 'C2' }, 50, 'sale', { customerName: 'Z' }),
        item({ customerCode: 'C3' }, 0, 'sale', { customerName: 'B' }),
        item({ customerCode: 'C4' }, 50, 'sale', { customerName: 'Y' }),
      ];
      const result = list(cases, { sortBy: 'customerName', sortDir });
      expect(result.rows.map((row) => row.customerName)).toEqual(
        sortDir === 'asc' ? ['Y', 'Z', 'A', 'B'] : ['Z', 'Y', 'B', 'A'],
      );
      expect(result.summary.closedCount).toBe(2);
      expect(result.filteredSummary.closedCount).toBe(2);
      const closed = list(cases, {
        scope: 'closed',
        sortBy: 'customerName',
        sortDir,
      });
      expect(closed.total).toBe(2);
      expect(closed.filteredSummary.closedCount).toBe(2);
    },
  );

  it('counts visible currency cases across all pages without counting other currencies twice', () => {
    const cases = Array.from({ length: 30 }, (_, index) => [
      item({ customerCode: `C-${index}` }),
      item({ customerCode: `C-${index}`, currency: 'TL' }, 0, 'vat'),
    ]).flat();
    const result = list(cases, { scope: 'closed', page: 2 });
    expect(result.rows).toHaveLength(5);
    expect(result.total).toBe(30);
    expect(result.summary.closedCount).toBe(30);
    expect(result.filteredSummary.closedCount).toBe(30);
  });
});

describe('Payment detail all-currency portfolio', () => {
  it('returns all matching kinds/currencies with one state batch and one contact while preserving selected history and duplicate rows', async () => {
    const selected = item();
    selected.installments = [
      selected.installments[0],
      { ...selected.installments[0], sequence: 2 },
    ];
    selected.installmentCount = 2;
    selected.amount = 200;
    selected.paid = 200;
    const tl = item({ currency: 'TL' }, 80, 'vat');
    const usd = item({ currency: 'USD' }, 20, 'transformer');
    const excluded = [
      item({ unitCode: 'OTHER-UNIT' }, 70),
      item({ customerCode: 'OTHER-CUSTOMER' }, 70),
      item({ customerCode: 'customer-1' }, 70),
      item({ unitCode: 'UNIT-1 ' }, 70),
    ];
    const cases = [selected, tl, usd, ...excluded];
    const before = structuredClone(cases);
    const { service, source, store } = setup(cases);
    const states = [state(selected, 2), state(tl, 7)];
    store.getMany.mockResolvedValue(states);
    const history = [{ id: 'selected-currency-event' }];
    store.history.mockResolvedValue({ items: history, hasMore: true });
    const result = await service.detail(selected.key);
    expect(result.item.key).toBe(selected.key);
    expect(result.item.tracking?.version).toBe(2);
    expect(result.item.fullyPaid).toBe(false);
    expect(result.installments).toEqual(selected.installments);
    expect(result.portfolio.fullyPaid).toBe(false);
    expect(result.portfolio.cases.map((row) => row.key)).toEqual([
      selected.key,
      tl.key,
      usd.key,
    ]);
    expect(
      result.portfolio.cases.map((row) => row.tracking?.version ?? null),
    ).toEqual([2, 7, null]);
    expect(
      result.portfolio.installments.map((row) => [
        row.caseKey,
        row.currency,
        row.paymentKind,
      ]),
    ).toEqual([
      [selected.key, 'GBP', 'sale'],
      [selected.key, 'GBP', 'sale'],
      [tl.key, 'TL', 'vat'],
      [usd.key, 'USD', 'transformer'],
    ]);
    expect(store.getMany).toHaveBeenCalledTimes(1);
    expect(store.getMany).toHaveBeenCalledWith([selected.key, tl.key, usd.key]);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.history).toHaveBeenCalledTimes(1);
    expect(store.history).toHaveBeenCalledWith(selected.key);
    expect(result.history).toEqual(history);
    expect(result.historyHasMore).toBe(true);
    expect(source.contact).toHaveBeenCalledTimes(1);
    expect(source.contact).toHaveBeenCalledWith(selected.identity.customerCode);
    expect(cases).toEqual(before);
    list(cases, { paymentKind: 'sale', scope: 'closed' });
    expect(cases).toEqual(before);
  });

  it.each([
    { customerCode: null },
    { customerCode: '  ' },
    { unitCode: null },
    { unitCode: '' },
  ])(
    'does not join missing-identity cases even when their other code matches: %j',
    async (identityPatch) => {
      const selected = item(identityPatch);
      const sibling = item({ ...identityPatch, currency: 'TL' });
      const { service, store } = setup([selected, sibling]);
      const result = await service.detail(selected.key);
      expect(result.portfolio.cases.map((row) => row.key)).toEqual([
        selected.key,
      ]);
      expect(result.portfolio.fullyPaid).toBe(false);
      expect(result.portfolio.installments).toHaveLength(1);
      expect(store.getMany).toHaveBeenCalledWith([selected.key]);
    },
  );

  it('preserves the action key/version and sibling workflow while returning the complete portfolio', async () => {
    const selected = item();
    const sibling = item({ currency: 'TL' }, 50, 'vat');
    const { service, source, store } = setup([selected, sibling]);
    const siblingState = state(sibling, 8);
    store.apply.mockImplementation(() => {
      store.getMany.mockResolvedValue([state(selected, 4), siblingState]);
      return Promise.resolve(state(selected, 4));
    });
    const action = {
      type: 'note',
      expectedVersion: 3,
      body: 'Selected GBP note',
    };
    const result = await service.action(selected.key, action, actor);
    expect(store.apply).toHaveBeenCalledTimes(1);
    expect(store.apply).toHaveBeenCalledWith({
      ...action,
      key: selected.key,
      sourceIdentity: selected.identity,
      actor,
    });
    expect(source.snapshot).toHaveBeenCalledWith(true);
    expect(store.assignables).toHaveBeenCalledWith(true);
    expect(store.history).toHaveBeenCalledWith(selected.key);
    expect(result.item.tracking?.version).toBe(4);
    expect(result.portfolio.cases.map((row) => row.tracking?.version)).toEqual([
      4, 8,
    ]);
    expect(result.portfolio.cases[1].tracking).toEqual(siblingState);
    expect(result.portfolio.fullyPaid).toBe(false);
    expect(result.portfolio.installments).toHaveLength(2);
    expect(source.contact).toHaveBeenCalledTimes(1);
  });

  it('does not allow deferral of the paid selected currency because a different currency has debt', async () => {
    const selected = item();
    const { service, store } = setup([selected, item({ currency: 'TL' }, 50)]);
    await expect(
      service.action(
        selected.key,
        {
          type: 'defer',
          expectedVersion: 0,
          body: 'Cannot defer GBP',
          trackingDate: '2026-11-01',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.apply).not.toHaveBeenCalled();
  });
});
