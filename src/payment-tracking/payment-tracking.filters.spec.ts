import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { parsePaymentQuery, paymentList } from './payment-tracking.service';
import { paymentTrackingCaseKey } from './payment-tracking-source.service';
import type {
  PaymentIdentity,
  PaymentSourceCase,
  PaymentSourceSnapshot,
  PaymentTrackingState,
} from './payment-tracking.types';

const asOf = '2026-09-29';
const actor = { id: 'synthetic-accountant', role: 'ACCOUNTING' };

describe('Fatura OK payment-list scope', () => {
  const invoiceOk = (values: string[], hasBlank = false) => ({
    status: 'matched' as const,
    values,
    hasBlank,
  });
  const rows = () => [
    item(1, { invoiceOk: invoiceOk(['DND']) }),
    item(2, { invoiceOk: invoiceOk(['GÜL']) }),
    item(3, { invoiceOk: invoiceOk(['DND', 'KOZANSOY']) }),
    item(4, { invoiceOk: invoiceOk([], true) }),
    item(5, {
      invoiceOk: { status: 'unmatched', values: [], hasBlank: false },
    }),
  ];
  it('preserves all by default and filters full summaries before paging', () => {
    expect(parsePaymentQuery({}).invoiceOk).toBe('all');
    const all = list(rows());
    expect(all.selectedInvoiceOk).toBe('all');
    expect(all.total).toBe(5);
    expect(all.filteredSummary.outstanding).toBe(400);
    for (const [invoiceOk, customer] of [
      ['value:DND', 'C-1'],
      ['value:GÜL', 'C-2'],
      ['mixed', 'C-3'],
      ['blank', 'C-4'],
      ['unknown', 'C-5'],
    ]) {
      const result = list(rows(), { invoiceOk });
      expect(result.selectedInvoiceOk).toBe(invoiceOk);
      expect(keys(result)).toEqual([customer]);
      expect(result.filteredSummary.outstanding).toBe(80);
      expect(result.currencyBreakdown[0].filteredSummary.outstanding).toBe(80);
    }
    const many = Array.from({ length: 31 }, (_, index) =>
      item(index + 10, { invoiceOk: invoiceOk(['DND']) }),
    );
    const paged = list([...many, ...rows().slice(1)], {
      invoiceOk: 'value:DND',
      pageSize: 25,
    });
    expect(paged.rows).toHaveLength(25);
    expect(paged.total).toBe(31);
    expect(paged.filteredSummary.outstanding).toBe(2480);
  });
  it('combines with existing filters and never sums different currencies', () => {
    const gbp = item(1, {
      invoiceOk: invoiceOk(['DND']),
      authorization: { status: 'matched', codes: [], hasBlank: true },
    });
    const eur = item(
      2,
      {
        invoiceOk: invoiceOk(['DND']),
        authorization: { status: 'matched', codes: [], hasBlank: true },
      },
      { currency: 'EUR' },
    );
    const result = list([gbp, eur, ...rows()], {
      invoiceOk: 'value:DND',
      authorizationState: 'blank',
      currency: '__ALL__',
      representative: 'REP-1',
    });
    expect(result.total).toBe(2);
    expect(result.filteredSummary.outstanding).toBeNull();
    expect(
      result.currencyBreakdown.map((part) => part.filteredSummary.outstanding),
    ).toEqual([80, 80]);
  });
  it('fails selected filters when metadata is unreadable and retains all-mode source rows', () => {
    const data = snapshot(rows(), true);
    expect(() =>
      paymentList(data, [], actor, { invoiceOk: 'value:DND' }),
    ).toThrow(ServiceUnavailableException);
    expect(
      paymentList(data, [], actor, { scope: 'all', invoiceOk: 'all' }).total,
    ).toBe(5);
    expect(() => list([item(1)], { invoiceOk: 'unknown' })).toThrow(
      ServiceUnavailableException,
    );
  });
});

function item(
  index: number,
  changes: Partial<PaymentSourceCase> = {},
  identityChanges: Partial<PaymentIdentity> = {},
): PaymentSourceCase {
  const identity: PaymentIdentity = {
    customerCode: `C-${index}`,
    unitCode: `U-${index}`,
    currency: 'GBP',
    ...identityChanges,
  };
  return {
    key: paymentTrackingCaseKey(identity),
    identity,
    customerName: `Synthetic ${index}`,
    unitName: `Unit ${index}`,
    customerNames: [`Synthetic ${index}`],
    unitNames: [`Unit ${index}`],
    projects: [{ code: 'P-1', name: 'Synthetic project' }],
    representatives: ['REP-1'],
    brokers: ['BROKER-1'],
    invoiceDates: ['2026-08-01'],
    authorization: { codes: ['AUTH-1'], status: 'matched', hasBlank: false },
    installmentCount: 1,
    incompleteRows: 0,
    amount: 100,
    paid: 20,
    outstanding: 80,
    overdueAmount: 80,
    overdueCount: 1,
    dueTodayAmount: 0,
    oldestDueDate: '2026-09-01',
    nextDueDate: null,
    overdueDays: 28,
    canTrack: true,
    trackingIssue: null,
    installments: [
      {
        sequence: 1,
        projectCode: 'P-1',
        paymentKind: 'sale',
        dueDate: '2026-09-01',
        amount: 100,
        paid: 20,
        outstanding: 80,
        overdueDays: 28,
        status: 'overdue',
      },
    ],
    ...changes,
  };
}

function snapshot(
  cases: PaymentSourceCase[],
  unavailable = false,
): PaymentSourceSnapshot {
  return {
    database: 'LOGO_DND',
    view: 'L_223_ODEME_PLANI',
    generatedAt: `${asOf}T09:00:00.000Z`,
    asOf,
    recordCount: cases.reduce((sum, row) => sum + row.installmentCount, 0),
    cases,
    authorizationSource: {
      view: 'L_223_FATURA_VADE',
      status: unavailable ? 'unavailable' : 'available',
      matchedCases: cases.filter(
        (row) => row.authorization.status === 'matched',
      ).length,
      unmatchedCases: cases.filter(
        (row) => row.authorization.status === 'unmatched',
      ).length,
      multipleCodeCases: cases.filter(
        (row) => row.authorization.codes.length > 1,
      ).length,
      message: unavailable
        ? 'Synthetic authorization source unavailable'
        : null,
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
    version: 1,
    updatedAt: `${asOf}T08:00:00.000Z`,
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
    scope: 'all',
    currency: 'GBP',
    ...query,
  });
}

function keys(result: ReturnType<typeof paymentList>) {
  return result.rows.map((row) => row.identity.customerCode).sort();
}

function mixedPaymentCase(index = 1): PaymentSourceCase {
  return item(index, {
    projects: [
      { code: 'U-1', name: 'Unit project' },
      { code: 'KDV', name: 'VAT' },
      { code: 'TRAFO', name: 'Transformer' },
    ],
    installmentCount: 3,
    amount: 1400,
    paid: 500,
    outstanding: 900,
    overdueAmount: 700,
    overdueCount: 2,
    oldestDueDate: '2026-08-01',
    nextDueDate: '2026-10-10',
    overdueDays: 59,
    installments: [
      {
        sequence: 1,
        projectCode: 'U-1',
        paymentKind: 'sale',
        dueDate: '2026-09-10',
        amount: 1000,
        paid: 400,
        outstanding: 600,
        overdueDays: 19,
        status: 'overdue',
      },
      {
        sequence: 2,
        projectCode: 'KDV',
        paymentKind: 'vat',
        dueDate: '2026-08-01',
        amount: 100,
        paid: 0,
        outstanding: 100,
        overdueDays: 59,
        status: 'overdue',
      },
      {
        sequence: 3,
        projectCode: 'TRAFO',
        paymentKind: 'transformer',
        dueDate: '2026-10-10',
        amount: 300,
        paid: 100,
        outstanding: 200,
        overdueDays: 0,
        status: 'upcoming',
      },
    ],
  });
}

describe('Payment kind selection', () => {
  it('defaults to the complete portfolio and validates supported payment kinds', () => {
    expect(parsePaymentQuery({}).paymentKind).toBe('all');
    for (const paymentKind of [
      'all',
      'sale',
      'land',
      'vat',
      'transformer',
      'furniture',
      'deposit',
      'other',
    ]) {
      expect(parsePaymentQuery({ paymentKind }).paymentKind).toBe(paymentKind);
    }
    for (const paymentKind of ['sales', 'VAT', ['sale'], 1, 'sale,vat']) {
      expect(() => parsePaymentQuery({ paymentKind })).toThrow(
        BadRequestException,
      );
    }
    const result = list([mixedPaymentCase()]);
    expect(result.selectedPaymentKind).toBe('all');
    expect(result.rows[0]).toMatchObject({
      amount: 1400,
      paid: 500,
      outstanding: 900,
      overdueAmount: 700,
    });
  });

  it.each([
    {
      paymentKind: 'sale',
      amount: 1000,
      paid: 400,
      outstanding: 600,
      overdueAmount: 600,
      oldestDueDate: '2026-09-10',
      project: 'U-1',
    },
    {
      paymentKind: 'vat',
      amount: 100,
      paid: 0,
      outstanding: 100,
      overdueAmount: 100,
      oldestDueDate: '2026-08-01',
      project: 'KDV',
    },
    {
      paymentKind: 'transformer',
      amount: 300,
      paid: 100,
      outstanding: 200,
      overdueAmount: 0,
      oldestDueDate: '2026-10-10',
      project: 'TRAFO',
    },
  ])(
    'calculates $paymentKind totals, aging and projects without excluded installment amounts',
    ({ paymentKind, project, ...totals }) => {
      const source = snapshot([mixedPaymentCase()]);
      const before = structuredClone(source);
      const result = paymentList(source, [], actor, {
        scope: 'all',
        paymentKind,
      });
      expect(result.selectedPaymentKind).toBe(paymentKind);
      expect(result.rows[0]).toMatchObject({
        ...totals,
        installmentCount: 1,
        key: source.cases[0].key,
        identity: source.cases[0].identity,
      });
      expect(result.summary.outstanding).toBe(totals.outstanding);
      expect(result.filteredSummary.overdueAmount).toBe(totals.overdueAmount);
      expect(result.projects.map((entry) => entry.code)).toEqual([project]);
      expect(source).toEqual(before);
    },
  );

  it('applies balance, due date and project filters to the selected installments', () => {
    const cases = [mixedPaymentCase()];
    expect(
      list(cases, {
        paymentKind: 'sale',
        balanceMin: '600',
        balanceMax: '600',
        dueFrom: '2026-09-10',
        dueTo: '2026-09-10',
      }).total,
    ).toBe(1);
    expect(list(cases, { paymentKind: 'sale', project: 'KDV' }).total).toBe(0);
    expect(
      list(cases, { paymentKind: 'sale', dueTo: '2026-08-01' }).total,
    ).toBe(0);
    expect(
      list(cases, { paymentKind: 'transformer', scope: 'overdue' }).total,
    ).toBe(0);
  });

  it('does not inherit incompleteness from excluded kinds or coerce selected unknown amounts to zero', () => {
    const mixed = mixedPaymentCase();
    mixed.incompleteRows = 1;
    mixed.installments[1] = {
      ...mixed.installments[1],
      amount: null,
      dueDate: null,
      outstanding: null,
      status: 'unknown',
    };
    const sale = list([mixed], {
      paymentKind: 'sale',
      dataQuality: 'complete',
    });
    expect(sale.rows[0]).toMatchObject({
      incompleteRows: 0,
      amount: 1000,
      outstanding: 600,
    });
    expect(sale.filteredSummary.incompleteRows).toBe(0);
    const vat = list([mixed], {
      paymentKind: 'vat',
      dataQuality: 'incomplete',
    });
    expect(vat.rows[0]).toMatchObject({
      incompleteRows: 1,
      amount: null,
      outstanding: null,
      overdueAmount: null,
      trackingStatus: 'unknown',
    });
    expect(vat.filteredSummary.outstanding).toBeNull();
    expect(list([mixed], { paymentKind: 'vat', balanceMin: '0' }).total).toBe(
      0,
    );
  });

  it('shows a paid sale even when another payment kind remains open and retains whole-case workflow identity', () => {
    const mixed = mixedPaymentCase();
    mixed.installments[0] = {
      ...mixed.installments[0],
      paid: 1000,
      outstanding: 0,
      overdueDays: 0,
      status: 'paid',
    };
    const tracking = state(mixed, {
      trackingDate: '2026-10-20',
      priority: 'high',
    });
    const before = structuredClone(tracking);
    const sale = list(
      [mixed],
      { paymentKind: 'sale', paymentState: 'paid', scope: 'paid' },
      [tracking],
    );
    expect(sale.rows[0]).toMatchObject({
      key: mixed.key,
      amount: 1000,
      paid: 1000,
      outstanding: 0,
      overdueAmount: 0,
      trackingStatus: 'paid',
      tracking,
    });
    expect(sale.filteredSummary).toMatchObject({
      openCount: 0,
      outstanding: 0,
      overdueCount: 0,
      deferredCount: 0,
    });
    expect(
      list([mixed], { paymentKind: 'vat', scope: 'deferred' }, [tracking])
        .rows[0],
    ).toMatchObject({
      key: mixed.key,
      outstanding: 100,
      trackingStatus: 'deferred',
      tracking,
    });
    expect(tracking).toEqual(before);
  });

  it('keeps available currencies and orphan detection tied to the whole source', () => {
    const sale = mixedPaymentCase();
    const vatOnly = item(2, {
      projects: [{ code: 'KDV', name: 'VAT' }],
      installments: [
        { ...item(2).installments[0], projectCode: 'KDV', paymentKind: 'vat' },
      ],
    });
    const eurVat = item(
      3,
      {
        installments: [
          {
            ...item(3).installments[0],
            projectCode: 'KDV',
            paymentKind: 'vat',
          },
        ],
      },
      { currency: 'EUR' },
    );
    const states = [state(vatOnly), state(item(99))];
    const result = list(
      [sale, vatOnly, eurVat],
      { paymentKind: 'sale' },
      states,
    );
    expect(result.rows.map((row) => row.key)).toEqual([sale.key]);
    expect(result.currencies.map((currency) => currency.value)).toEqual([
      'GBP',
      'EUR',
    ]);
    expect(result.source.recordCount).toBe(5);
    expect(result.orphanedTrackingCount).toBe(1);
    const noEurSales = list(
      [sale, vatOnly, eurVat],
      { paymentKind: 'sale', currency: 'EUR' },
      states,
    );
    expect(noEurSales.total).toBe(0);
    expect(noEurSales.summary.outstanding).toBe(0);
    expect(noEurSales.orphanedTrackingCount).toBe(1);
  });

  it('retains case-level authorization, representative and invoice metadata when a kind is selected', () => {
    const mixed = mixedPaymentCase();
    const result = list([mixed], {
      paymentKind: 'sale',
      authorizationCode: 'AUTH-1',
      representative: 'REP-1',
      broker: 'BROKER-1',
      invoiceFrom: '2026-08-01',
      invoiceTo: '2026-08-01',
    });
    expect(result.rows[0]).toMatchObject({
      amount: 1000,
      outstanding: 600,
      authorization: mixed.authorization,
      representatives: mixed.representatives,
      invoiceDates: mixed.invoiceDates,
    });
  });
});

describe('Payment tracking expanded filters keep full source case accounting', () => {
  it('selects a case by its oldest open due date without slicing later installments or altering its key/totals', () => {
    const full = item(1, {
      installmentCount: 2,
      amount: 1000,
      paid: 20,
      outstanding: 980,
      nextDueDate: '2027-01-01',
      installments: [
        {
          sequence: 1,
          projectCode: 'P-1',
          paymentKind: 'sale',
          dueDate: '2026-09-01',
          amount: 100,
          paid: 20,
          outstanding: 80,
          overdueDays: 28,
          status: 'overdue',
        },
        {
          sequence: 2,
          projectCode: 'P-1',
          paymentKind: 'sale',
          dueDate: '2027-01-01',
          amount: 900,
          paid: 0,
          outstanding: 900,
          overdueDays: 0,
          status: 'upcoming',
        },
      ],
    });
    const source = snapshot([full]);
    const tracking = [state(full, { trackingDate: '2026-10-10' })];
    const beforeSource = structuredClone(source);
    const beforeTracking = structuredClone(tracking);
    const result = paymentList(source, tracking, actor, {
      scope: 'all',
      dueFrom: '2026-09-01',
      dueTo: '2026-09-01',
      balanceMin: '980',
      balanceMax: '980',
    });
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      key: full.key,
      installmentCount: 2,
      amount: 1000,
      paid: 20,
      outstanding: 980,
      overdueAmount: 80,
      oldestDueDate: '2026-09-01',
      trackingStatus: 'deferred',
      effectiveDueDate: '2026-10-10',
    });
    expect(result.summary).toMatchObject({
      outstanding: 980,
      overdueAmount: 80,
      deferredCount: 1,
    });
    expect(
      paymentList(source, tracking, actor, {
        scope: 'all',
        dueFrom: '2027-01-01',
      }).total,
    ).toBe(0);
    expect(source).toEqual(beforeSource);
    expect(tracking).toEqual(beforeTracking);
    expect(full.key).toBe(paymentTrackingCaseKey(full.identity));
  });

  it('combines exact case attribute membership with AND across fields and ANY within stored values', () => {
    const cases = [
      item(1, {
        representatives: ['REP-1', 'REP-2'],
        brokers: ['BROKER-1', 'BROKER-2'],
        authorization: {
          codes: ['AUTH-1', 'AUTH-2'],
          status: 'matched',
          hasBlank: false,
        },
      }),
      item(2, { brokers: ['BROKER-2'] }),
      item(3, { representatives: ['REP-2'] }),
    ];
    const result = list(cases, {
      authorizationCode: 'AUTH-2',
      representative: 'REP-2',
      broker: 'BROKER-2',
      customer: 'C-1',
      unit: 'U-1',
    });
    expect(keys(result)).toEqual(['C-1']);
    expect(result.summary.outstanding).toBe(80);
    for (const query of [
      { authorizationCode: 'auth-2' },
      { representative: 'REP' },
      { broker: 'broker-2' },
      { customer: 'C-' },
      { unit: 'u-1' },
    ]) {
      expect(list(cases, query).total).toBe(0);
    }
  });

  it('keeps blank, mixed, multiple and unmatched authorization states distinct', () => {
    const cases = [
      item(1),
      item(2, {
        authorization: { codes: [], status: 'matched', hasBlank: true },
      }),
      item(3, {
        authorization: { codes: ['AUTH-1'], status: 'matched', hasBlank: true },
      }),
      item(4, {
        authorization: {
          codes: ['AUTH-1', 'AUTH-2'],
          status: 'matched',
          hasBlank: false,
        },
      }),
      item(5, {
        authorization: { codes: [], status: 'unmatched', hasBlank: false },
      }),
    ];
    expect(keys(list(cases, { authorizationState: 'coded' }))).toEqual([
      'C-1',
      'C-3',
      'C-4',
    ]);
    expect(keys(list(cases, { authorizationState: 'blank' }))).toEqual(['C-2']);
    expect(keys(list(cases, { authorizationState: 'mixed' }))).toEqual(['C-3']);
    expect(keys(list(cases, { authorizationState: 'multiple' }))).toEqual([
      'C-4',
    ]);
    expect(keys(list(cases, { authorizationState: 'unmatched' }))).toEqual([
      'C-5',
    ]);
    expect(
      list(cases, { authorizationState: 'blank', authorizationCode: 'AUTH-1' })
        .total,
    ).toBe(0);
  });

  it('retains visible authorization failure metadata without filters but rejects every active authorization filter', () => {
    const source = snapshot(
      [
        item(1, {
          authorization: { codes: [], status: 'unavailable', hasBlank: false },
        }),
      ],
      true,
    );
    const unfiltered = paymentList(source, [], actor, {
      scope: 'all',
      authorizationState: 'all',
    });
    expect(unfiltered.total).toBe(1);
    expect(unfiltered.source.authorizationSource).toMatchObject({
      status: 'unavailable',
      message: 'Synthetic authorization source unavailable',
    });
    for (const query of [
      { authorizationCode: 'AUTH-1' },
      ...['coded', 'blank', 'mixed', 'multiple', 'unmatched'].map(
        (authorizationState) => ({ authorizationState }),
      ),
    ]) {
      expect(() =>
        paymentList(source, [], actor, { scope: 'all', ...query }),
      ).toThrow(ServiceUnavailableException);
    }
  });

  it.each([
    { representative: 'REP-1' },
    { broker: 'BROKER-1' },
    { invoiceFrom: '2026-01-01' },
    { invoiceTo: '2026-12-31' },
  ])(
    'rejects active invoice metadata filters when the Logo vade source is unavailable: %s',
    (query) => {
      const source = snapshot(
        [item(1, { representatives: [], brokers: [], invoiceDates: [] })],
        true,
      );
      expect(() =>
        paymentList(source, [], actor, { scope: 'all', ...query }),
      ).toThrow(ServiceUnavailableException);
      try {
        paymentList(source, [], actor, { scope: 'all', ...query });
      } catch (error) {
        expect(
          (error as ServiceUnavailableException).getResponse(),
        ).toMatchObject({
          code: 'PAYMENT_TRACKING_METADATA_UNAVAILABLE',
        });
      }
      expect(
        paymentList(source, [], actor, {
          scope: 'all',
          customer: 'C-1',
          dueFrom: '2026-01-01',
        }).total,
      ).toBe(1);
    },
  );

  it('applies both invoice bounds to the same invoice date, with inclusive endpoints', () => {
    const cases = [
      item(1, { invoiceDates: ['2026-01-01', '2026-12-01'] }),
      item(2, { invoiceDates: ['2026-06-15'] }),
      item(3, { invoiceDates: [] }),
    ];
    expect(
      keys(list(cases, { invoiceFrom: '2026-06-01', invoiceTo: '2026-07-01' })),
    ).toEqual(['C-2']);
    expect(
      keys(list(cases, { invoiceFrom: '2026-12-01', invoiceTo: '2026-12-01' })),
    ).toEqual(['C-1']);
  });

  it('filters original and effective follow-up date independently and does not invent dates for paid cases', () => {
    const cases = [
      item(1),
      item(2),
      item(3, {
        outstanding: 0,
        oldestDueDate: null,
        overdueAmount: 0,
        overdueCount: 0,
      }),
    ];
    const states = [state(cases[0], { trackingDate: '2026-10-10' })];
    expect(
      keys(
        list(
          cases,
          {
            dueFrom: '2026-09-01',
            dueTo: '2026-09-01',
            followUpFrom: '2026-10-10',
            followUpTo: '2026-10-10',
          },
          states,
        ),
      ),
    ).toEqual(['C-1']);
    expect(keys(list(cases, { followUpTo: '2026-09-01' }, states))).toEqual([
      'C-2',
    ]);
  });

  it('uses source overdue days even when a future local follow-up suppresses tracking overdue days', () => {
    const full = item(1);
    const result = list(
      [full],
      { overdueDaysMin: '28', overdueDaysMax: '28' },
      [state(full, { trackingDate: '2026-10-01' })],
    );
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      overdueDays: 28,
      trackingOverdueDays: 0,
      trackingStatus: 'deferred',
    });
    expect(list([full], { overdueDaysMax: '27' }).total).toBe(0);
  });

  it('distinguishes numeric zero from no bound and excludes null or incomplete monetary/day values', () => {
    const cases = [
      item(1, {
        amount: 100,
        paid: 100,
        outstanding: 0,
        overdueAmount: 0,
        overdueCount: 0,
        overdueDays: 0,
        oldestDueDate: null,
      }),
      item(2),
      item(3, {
        outstanding: null,
        overdueAmount: null,
        incompleteRows: 1,
        oldestDueDate: null,
        overdueDays: 0,
      }),
      item(4, {
        outstanding: 0,
        overdueAmount: 0,
        incompleteRows: 1,
        overdueDays: 0,
      }),
    ];
    expect(list(cases).total).toBe(4);
    expect(keys(list(cases, { balanceMax: '0' }))).toEqual(['C-1']);
    expect(keys(list(cases, { balanceMin: 0, balanceMax: 0 }))).toEqual([
      'C-1',
    ]);
    expect(
      keys(list(cases, { overdueAmountMin: '0', overdueAmountMax: '0' })),
    ).toEqual(['C-1']);
    expect(
      keys(list(cases, { overdueDaysMin: '0', overdueDaysMax: '0' })),
    ).toEqual(['C-1']);
    expect(
      keys(
        list(cases, {
          balanceMin: '80',
          balanceMax: '80',
          overdueAmountMin: '80',
          overdueAmountMax: '80',
        }),
      ),
    ).toEqual(['C-2']);
  });

  it('excludes incomplete known subtotals from every bound so a partial amount cannot satisfy an upper limit', () => {
    const cases = [item(1), item(2, { incompleteRows: 1 })];
    for (const query of [
      { balanceMin: '0' },
      { balanceMax: '1000' },
      { overdueAmountMin: '0' },
      { overdueAmountMax: '1000' },
      { overdueDaysMin: '0' },
      { overdueDaysMax: '1000' },
    ]) {
      expect(keys(list(cases, query))).toEqual(['C-1']);
    }
  });

  it('separates payment state and source completeness without treating an unknown zero as paid', () => {
    const cases = [
      item(1, { paid: 0, outstanding: 100 }),
      item(2),
      item(3, {
        paid: 100,
        outstanding: 0,
        overdueAmount: 0,
        oldestDueDate: null,
      }),
      item(4, { paid: null, outstanding: null, incompleteRows: 1 }),
      item(5, { paid: 100, outstanding: 0, incompleteRows: 1 }),
    ];
    expect(keys(list(cases, { paymentState: 'unpaid' }))).toEqual(['C-1']);
    expect(keys(list(cases, { paymentState: 'partial' }))).toEqual(['C-2']);
    expect(keys(list(cases, { paymentState: 'paid' }))).toEqual(['C-3']);
    expect(keys(list(cases, { paymentState: 'unknown' }))).toEqual([
      'C-4',
      'C-5',
    ]);
    expect(keys(list(cases, { dataQuality: 'complete' }))).toEqual([
      'C-1',
      'C-2',
      'C-3',
    ]);
    expect(keys(list(cases, { dataQuality: 'incomplete' }))).toEqual([
      'C-4',
      'C-5',
    ]);
    expect(keys(list(cases, { scope: 'open' }))).toEqual(['C-1', 'C-2']);
  });

  it('distinguishes any tracking record from a saved deferral, including a past deferral', () => {
    const cases = [item(1), item(2), item(3)];
    const states = [
      state(cases[1]),
      state(cases[2], { trackingDate: '2026-09-20' }),
    ];
    expect(keys(list(cases, { trackingRecord: 'none' }, states))).toEqual([
      'C-1',
    ]);
    expect(
      keys(list(cases, { trackingRecord: 'exists', deferral: 'none' }, states)),
    ).toEqual(['C-2']);
    expect(keys(list(cases, { deferral: 'exists' }, states))).toEqual(['C-3']);
    expect(
      list(cases, { scope: 'deferred', deferral: 'exists' }, states).total,
    ).toBe(0);
  });

  it('applies new filters before portfolio summaries and page slicing while queue scope remains independent', () => {
    const gbp = Array.from({ length: 31 }, (_, index) => item(index + 1));
    const cases = [
      ...gbp,
      item(50, { representatives: ['OTHER'] }),
      item(51, { outstanding: 9000 }, { currency: 'EUR' }),
    ];
    const states = [state(gbp[0], { trackingDate: '2026-10-01' })];
    const result = list(
      cases,
      {
        representative: 'REP-1',
        balanceMin: '80',
        balanceMax: '80',
        page: '2',
        pageSize: '25',
      },
      states,
    );
    expect(result).toMatchObject({ total: 31, page: 2, totalPages: 2 });
    expect(result.rows).toHaveLength(6);
    expect(result.summary).toMatchObject({
      openCount: 31,
      outstanding: 2480,
      overdueAmount: 2480,
      overdueCount: 31,
      actionableCount: 30,
      deferredCount: 1,
    });
    const deferred = list(
      cases,
      { representative: 'REP-1', scope: 'deferred' },
      states,
    );
    expect(deferred.total).toBe(1);
    expect(deferred.summary).toEqual(result.summary);
  });

  it('counts filter options per case without duplicate source values or other currencies inflating them', () => {
    const cases = [
      item(1, {
        representatives: ['REP-1', 'REP-1', 'REP-2'],
        brokers: ['BROKER-1', 'BROKER-1'],
        authorization: {
          codes: ['AUTH-1', 'AUTH-1'],
          status: 'matched',
          hasBlank: false,
        },
        installmentCount: 3,
      }),
      item(2),
      item(3, {}, { currency: 'EUR' }),
    ];
    const result = list(cases);
    expect(
      result.filterOptions.representatives.find(
        (option) => option.value === 'REP-1',
      )?.caseCount,
    ).toBe(2);
    expect(
      result.filterOptions.representatives.find(
        (option) => option.value === 'REP-2',
      )?.caseCount,
    ).toBe(1);
    expect(
      result.filterOptions.brokers.find((option) => option.value === 'BROKER-1')
        ?.caseCount,
    ).toBe(2);
    expect(
      result.filterOptions.authorizationCodes.find(
        (option) => option.value === 'AUTH-1',
      )?.caseCount,
    ).toBe(2);
    expect(
      result.filterOptions.customers.map((option) => option.value).sort(),
    ).toEqual(['C-1', 'C-2']);
    expect(
      result.filterOptions.units.map((option) => option.value).sort(),
    ).toEqual(['U-1', 'U-2']);
  });
});

describe('Payment tracking filteredSummary covers the selected rows across all pages', () => {
  function portfolio() {
    const cases = [
      item(1),
      item(2, { amount: 520, paid: 20, outstanding: 500, overdueAmount: 120 }),
      item(3, {
        amount: 40,
        paid: 0,
        outstanding: 40,
        overdueAmount: 0,
        dueTodayAmount: 40,
        overdueCount: 0,
        overdueDays: 0,
        oldestDueDate: asOf,
      }),
      item(4, {
        amount: 100,
        paid: 100,
        outstanding: 0,
        overdueAmount: 0,
        overdueCount: 0,
        overdueDays: 0,
        oldestDueDate: null,
      }),
      item(5, {
        amount: 60,
        paid: 0,
        outstanding: 60,
        overdueAmount: 0,
        overdueCount: 0,
        overdueDays: 0,
        oldestDueDate: '2026-11-01',
      }),
    ];
    return { cases, states: [state(cases[1], { trackingDate: '2026-10-10' })] };
  }

  it.each([
    {
      scope: 'all',
      total: 5,
      openCount: 4,
      outstanding: 680,
      overdueCount: 2,
      overdueAmount: 200,
      actionableCount: 2,
      actionableAmount: 120,
      deferredCount: 1,
      todayCount: 1,
    },
    {
      scope: 'open',
      total: 4,
      openCount: 4,
      outstanding: 680,
      overdueCount: 2,
      overdueAmount: 200,
      actionableCount: 2,
      actionableAmount: 120,
      deferredCount: 1,
      todayCount: 1,
    },
    {
      scope: 'overdue',
      total: 2,
      openCount: 2,
      outstanding: 580,
      overdueCount: 2,
      overdueAmount: 200,
      actionableCount: 1,
      actionableAmount: 80,
      deferredCount: 1,
      todayCount: 0,
    },
    {
      scope: 'deferred',
      total: 1,
      openCount: 1,
      outstanding: 500,
      overdueCount: 1,
      overdueAmount: 120,
      actionableCount: 0,
      actionableAmount: 0,
      deferredCount: 1,
      todayCount: 0,
    },
    {
      scope: 'actionable',
      total: 2,
      openCount: 2,
      outstanding: 120,
      overdueCount: 1,
      overdueAmount: 80,
      actionableCount: 2,
      actionableAmount: 120,
      deferredCount: 0,
      todayCount: 1,
    },
    {
      scope: 'today',
      total: 1,
      openCount: 1,
      outstanding: 40,
      overdueCount: 0,
      overdueAmount: 0,
      actionableCount: 1,
      actionableAmount: 40,
      deferredCount: 0,
      todayCount: 1,
    },
    {
      scope: 'upcoming',
      total: 1,
      openCount: 1,
      outstanding: 60,
      overdueCount: 0,
      overdueAmount: 0,
      actionableCount: 0,
      actionableAmount: 0,
      deferredCount: 0,
      todayCount: 0,
    },
    {
      scope: 'paid',
      total: 1,
      openCount: 0,
      outstanding: 0,
      overdueCount: 0,
      overdueAmount: 0,
      actionableCount: 0,
      actionableAmount: 0,
      deferredCount: 0,
      todayCount: 0,
    },
  ])(
    'uses scope=$scope for filteredSummary without changing the original portfolio summary',
    ({ scope, total, ...expected }) => {
      const { cases, states } = portfolio();
      const result = list(cases, { scope }, states);
      expect(result.total).toBe(total);
      expect(result.filteredSummary).toEqual({
        ...expected,
        closedCount: ['all', 'paid'].includes(scope) ? 1 : 0,
        unassignedCount: expected.openCount,
        incompleteRows: 0,
      });
      expect(result.summary).toEqual({
        closedCount: 1,
        openCount: 4,
        outstanding: 680,
        overdueCount: 2,
        overdueAmount: 200,
        actionableCount: 2,
        actionableAmount: 120,
        deferredCount: 1,
        todayCount: 1,
        unassignedCount: 4,
        incompleteRows: 0,
      });
      expect(cases[1]).toMatchObject({
        outstanding: 500,
        overdueAmount: 120,
        overdueDays: 28,
      });
      expect(states[0].trackingDate).toBe('2026-10-10');
    },
  );

  it('combines blank authorization, project, assignee, dates and amounts before applying the selected scope', () => {
    const blank = { codes: [], status: 'matched' as const, hasBlank: true };
    const cases = [
      item(1, { authorization: blank, overdueAmount: 60 }),
      item(2, { authorization: blank, outstanding: 90, overdueAmount: 70 }),
      item(3),
      item(4, {
        authorization: blank,
        projects: [{ code: 'P-2', name: 'Other project' }],
      }),
      item(5, { authorization: blank }),
      item(6, { authorization: blank, oldestDueDate: '2026-08-01' }),
      item(7, { authorization: blank, outstanding: 800 }),
      item(8, { authorization: blank, overdueAmount: 20 }),
    ];
    const states = cases.map((row) =>
      state(row, {
        assigneeId: row.key === cases[4].key ? 'other-accountant' : actor.id,
        assigneeName: 'Synthetic',
        trackingDate: row.key === cases[1].key ? '2026-10-10' : null,
      }),
    );
    const result = list(
      cases,
      {
        scope: 'deferred',
        authorizationState: 'blank',
        project: 'P-1',
        assignee: 'me',
        dueFrom: '2026-09-01',
        dueTo: '2026-09-29',
        balanceMin: '50',
        balanceMax: '100',
        overdueAmountMin: '50',
        overdueAmountMax: '100',
      },
      states,
    );
    expect(keys(result)).toEqual(['C-2']);
    expect(result.summary).toMatchObject({
      openCount: 2,
      outstanding: 170,
      overdueCount: 2,
      overdueAmount: 130,
      actionableCount: 1,
      deferredCount: 1,
      unassignedCount: 0,
    });
    expect(result.filteredSummary).toEqual({
      closedCount: 0,
      openCount: 1,
      outstanding: 90,
      overdueCount: 1,
      overdueAmount: 70,
      actionableCount: 0,
      actionableAmount: 0,
      deferredCount: 1,
      todayCount: 0,
      unassignedCount: 0,
      incompleteRows: 0,
    });
  });

  it('keeps the entire filtered overdue total stable on every page and sort direction', () => {
    const blank = { codes: [], status: 'matched' as const, hasBlank: true };
    const overdueCases = Array.from({ length: 60 }, (_, index) =>
      item(index + 1, { authorization: blank, overdueAmount: 30 }),
    );
    const today = item(61, {
      authorization: blank,
      amount: 40,
      paid: 0,
      outstanding: 40,
      overdueAmount: 0,
      overdueCount: 0,
      overdueDays: 0,
      oldestDueDate: asOf,
      dueTodayAmount: 40,
    });
    const cases = [...overdueCases, today];
    const states = overdueCases
      .slice(0, 10)
      .map((row) => state(row, { trackingDate: '2026-10-10' }));
    const pageKeys = new Set<string>();
    for (const sortDir of ['asc', 'desc']) {
      for (const [page, expectedRows] of [
        [1, 25],
        [2, 25],
        [3, 10],
      ]) {
        const result = list(
          cases,
          {
            authorizationState: 'blank',
            scope: 'overdue',
            page,
            pageSize: 25,
            sortBy: 'customerName',
            sortDir,
          },
          states,
        );
        expect(result).toMatchObject({ total: 60, totalPages: 3, page });
        expect(result.rows).toHaveLength(expectedRows);
        expect(result.filteredSummary).toEqual({
          closedCount: 0,
          openCount: 60,
          outstanding: 4800,
          overdueCount: 60,
          overdueAmount: 1800,
          actionableCount: 50,
          actionableAmount: 4000,
          deferredCount: 10,
          todayCount: 0,
          unassignedCount: 60,
          incompleteRows: 0,
        });
        expect(result.summary).toMatchObject({
          outstanding: 4840,
          overdueAmount: 1800,
          todayCount: 1,
          openCount: 61,
        });
        if (sortDir === 'asc')
          for (const row of result.rows) pageKeys.add(row.key);
      }
    }
    expect(pageKeys.size).toBe(60);
  });

  it('isolates both summary objects to the selected currency, including explicitly unknown currency', () => {
    const cases = [
      item(1),
      item(2, { outstanding: 500, overdueAmount: 120 }),
      item(3, { outstanding: 9000, overdueAmount: 4000 }, { currency: 'EUR' }),
      item(4, { outstanding: 400, overdueAmount: 200 }, { currency: null }),
    ];
    const states = [state(cases[1], { trackingDate: '2026-10-10' })];
    const gbp = list(cases, { scope: 'actionable', currency: 'GBP' }, states);
    expect(gbp.filteredSummary).toMatchObject({
      outstanding: 80,
      overdueAmount: 80,
      openCount: 1,
    });
    expect(gbp.summary).toMatchObject({
      outstanding: 580,
      overdueAmount: 200,
      openCount: 2,
    });
    const eur = list(cases, { scope: 'overdue', currency: 'EUR' }, states);
    expect(eur.filteredSummary).toMatchObject({
      outstanding: 9000,
      overdueAmount: 4000,
      openCount: 1,
    });
    expect(eur.filteredSummary).toEqual(eur.summary);
    const unknownCurrency = list(
      cases,
      { scope: 'overdue', currency: '__NULL__' },
      states,
    );
    expect(unknownCurrency.filteredSummary).toMatchObject({
      outstanding: 400,
      overdueAmount: 200,
      openCount: 1,
    });
    expect(unknownCurrency.rows.map((row) => row.identity.currency)).toEqual([
      null,
    ]);
  });

  it('preserves null-only totals and flags incomplete known subtotals within the filtered scope', () => {
    const cases = [
      item(1, {
        amount: null,
        paid: null,
        outstanding: null,
        overdueAmount: null,
        incompleteRows: 2,
        oldestDueDate: null,
      }),
      item(2, {
        amount: 75,
        paid: 25,
        outstanding: 50,
        overdueAmount: 20,
        incompleteRows: 3,
      }),
      item(3),
    ];
    const unknown = list(cases, { customer: 'C-1', dataQuality: 'incomplete' });
    expect(unknown.total).toBe(1);
    expect(unknown.filteredSummary).toMatchObject({
      outstanding: null,
      overdueAmount: null,
      openCount: 0,
      incompleteRows: 2,
    });
    const mixed = list(cases, { dataQuality: 'incomplete' });
    expect(mixed.total).toBe(2);
    expect(mixed.filteredSummary).toMatchObject({
      outstanding: 50,
      overdueAmount: 20,
      openCount: 1,
      incompleteRows: 5,
    });
    const overdue = list(cases, {
      dataQuality: 'incomplete',
      scope: 'overdue',
    });
    expect(overdue.total).toBe(1);
    expect(overdue.filteredSummary).toMatchObject({
      outstanding: 50,
      overdueAmount: 20,
      openCount: 1,
      incompleteRows: 3,
    });
    expect(overdue.summary).toMatchObject({
      outstanding: 50,
      overdueAmount: 20,
      openCount: 1,
      incompleteRows: 5,
    });
  });

  it('returns zero totals for an empty selected scope while preserving nonempty portfolio KPIs', () => {
    const cases = [item(1, { incompleteRows: 2 })];
    const result = list(cases, { scope: 'paid' });
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.filteredSummary).toEqual({
      closedCount: 0,
      openCount: 0,
      outstanding: 0,
      overdueCount: 0,
      overdueAmount: 0,
      actionableCount: 0,
      actionableAmount: 0,
      deferredCount: 0,
      todayCount: 0,
      unassignedCount: 0,
      incompleteRows: 0,
    });
    expect(result.summary).toMatchObject({
      outstanding: 80,
      overdueAmount: 80,
      openCount: 1,
      incompleteRows: 2,
    });
    const noCaseMatches = list(cases, { customer: 'ABSENT' });
    expect(noCaseMatches.filteredSummary).toEqual(result.filteredSummary);
    expect(noCaseMatches.summary).toEqual(result.filteredSummary);
  });
});

describe('Payment tracking range validation and sorting', () => {
  it.each([
    ['balanceMin', '1e2'],
    ['balanceMax', '0x10'],
    ['overdueAmountMin', '1,25'],
    ['overdueAmountMax', 'NaN'],
    ['balanceMin', Infinity],
    ['balanceMax', NaN],
    ['balanceMin', {}],
    ['balanceMax', ['0']],
    ['balanceMin', true],
    ['balanceMin', '-1'],
    ['overdueDaysMin', '1.5'],
    ['overdueDaysMax', '1e2'],
    ['dueFrom', '2026-02-30'],
    ['followUpTo', '2026-13-01'],
    ['invoiceFrom', '2026-01-01T00:00:00Z'],
    ['authorizationState', 'unavailable'],
    ['paymentState', 'settled'],
    ['trackingRecord', 'yes'],
    ['deferral', 'future'],
    ['dataQuality', 'known'],
    ['representative', ['REP-1']],
    ['customer', {}],
    ['authorizationCode', ['AUTH-1', 'AUTH-2']],
  ])('rejects invalid %s = %j', (field, value) => {
    expect(() => parsePaymentQuery({ [field]: value })).toThrow(
      BadRequestException,
    );
  });

  it.each([
    { balanceMin: '2', balanceMax: '1' },
    { overdueAmountMin: '2', overdueAmountMax: '1' },
    { overdueDaysMin: '2', overdueDaysMax: '1' },
    { dueFrom: '2026-10-01', dueTo: '2026-09-01' },
    { followUpFrom: '2026-10-01', followUpTo: '2026-09-01' },
    { invoiceFrom: '2026-10-01', invoiceTo: '2026-09-01' },
  ])('rejects reversed range %j', (query) => {
    expect(() => parsePaymentQuery(query)).toThrow(BadRequestException);
  });

  it('accepts zero and decimal monetary bounds without numeric coercion into different values', () => {
    expect(
      parsePaymentQuery({
        balanceMin: '0',
        balanceMax: '80.25',
        overdueAmountMin: 0,
        overdueAmountMax: 80.25,
        overdueDaysMin: 0,
        overdueDaysMax: '28',
      }),
    ).toMatchObject({
      balanceMin: 0,
      balanceMax: 80.25,
      overdueAmountMin: 0,
      overdueAmountMax: 80.25,
      overdueDaysMin: 0,
      overdueDaysMax: 28,
    });
  });

  it('keeps absent or cleared bounds separate from an explicit zero', () => {
    const cases = [item(1), item(2, { outstanding: null, incompleteRows: 1 })];
    expect(list(cases, { balanceMax: undefined }).total).toBe(2);
    expect(list(cases, { balanceMax: null }).total).toBe(2);
    expect(list(cases, { balanceMax: '' }).total).toBe(2);
    expect(list(cases, { balanceMax: '0' }).total).toBe(0);
  });

  it.each(['amount', 'paid', 'overdueAmount', 'oldestDueDate', 'nextDueDate'])(
    'sorts nullable %s values last in both directions and preserves key ties',
    (sortBy) => {
      const numeric = ['amount', 'paid', 'overdueAmount'].includes(sortBy);
      const cases = [
        item(1, { [sortBy]: null }),
        item(2, { [sortBy]: numeric ? 20 : '2026-09-01' }),
        item(3, { [sortBy]: numeric ? 10 : '2026-08-01' }),
        item(4, { [sortBy]: numeric ? 20 : '2026-09-01' }),
      ];
      for (const sortDir of ['asc', 'desc']) {
        const result = list(cases, { sortBy, sortDir });
        expect(result.rows.at(-1)?.key).toBe(cases[0].key);
        const tiedKeys = result.rows
          .filter((row) => row.key === cases[1].key || row.key === cases[3].key)
          .map((row) => row.key);
        expect(tiedKeys).toEqual([cases[1].key, cases[3].key].sort());
        expect(result.rows[sortDir === 'asc' ? 0 : 2].key).toBe(cases[2].key);
      }
    },
  );

  it('sorts unit names and local overdue days independently of original source aging', () => {
    const cases = [
      item(1, { unitName: 'Zeta' }),
      item(2, { unitName: 'Alpha' }),
    ];
    const states = [state(cases[0], { trackingDate: '2026-09-28' })];
    expect(
      list(cases, { sortBy: 'unitName', sortDir: 'asc' }, states).rows[0].key,
    ).toBe(cases[1].key);
    expect(
      list(
        cases,
        { sortBy: 'trackingOverdueDays', sortDir: 'asc' },
        states,
      ).rows.map((row) => row.trackingOverdueDays),
    ).toEqual([1, 28]);
  });
});
