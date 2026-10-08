import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PaymentCollectionReportController } from './payment-collection-report.controller';
import {
  buildCollectionReport,
  parseCollectionReportQuery,
  PaymentCollectionReportService,
} from './payment-collection-report.service';
import { PaymentTrackingGuard } from './payment-tracking.guard';
import {
  paymentTrackingCaseKey,
  PaymentTrackingSourceService,
} from './payment-tracking-source.service';
import type {
  PaymentIdentity,
  PaymentInstallment,
  PaymentSourceCase,
  PaymentSourceSnapshot,
} from './payment-tracking.types';

function line(
  dueDate: string | null,
  amount: number | null = 100,
  paid: number | null = 0,
  patch: Partial<PaymentInstallment> = {},
): PaymentInstallment {
  const outstanding =
    amount === null || paid === null ? null : Math.max(amount - paid, 0);
  return {
    sequence: 1,
    projectCode: 'LJ-A1',
    paymentKind: 'sale',
    dueDate,
    amount,
    paid,
    outstanding,
    overdueDays: 0,
    status: outstanding === 0 ? 'paid' : 'upcoming',
    ...patch,
  };
}
function sourceCase(
  index: number,
  installments: PaymentInstallment[],
  identityPatch: Partial<PaymentIdentity> = {},
  patch: Partial<PaymentSourceCase> = {},
): PaymentSourceCase {
  const identity = {
    customerCode: `C-${index}`,
    unitCode: `LJ-A${index}`,
    currency: 'GBP',
    ...identityPatch,
  };
  return {
    key: paymentTrackingCaseKey(identity),
    identity,
    customerName: `Customer ${index}`,
    unitName: `Unit ${index}`,
    customerNames: [`Customer ${index}`],
    unitNames: [`Unit ${index}`],
    projects: [],
    representatives: [],
    brokers: [],
    invoiceDates: [],
    authorization: { codes: [], status: 'matched', hasBlank: true },
    installmentCount: installments.length,
    incompleteRows: 0,
    // Deliberately unrelated case aggregates prove monthly totals use only
    // the matching original installment lines, never the whole case balance.
    amount: 999999,
    paid: 999998,
    outstanding: 1,
    overdueAmount: 1,
    overdueCount: 1,
    dueTodayAmount: 0,
    oldestDueDate: null,
    nextDueDate: null,
    overdueDays: 0,
    canTrack: true,
    trackingIssue: null,
    installments,
    ...patch,
  };
}
function snapshot(
  cases: PaymentSourceCase[],
  asOf = '2026-10-02',
): PaymentSourceSnapshot {
  return {
    database: 'LOGO_DND',
    view: 'L_223_ODEME_PLANI',
    generatedAt: `${asOf}T09:00:00.000Z`,
    asOf,
    recordCount: cases.reduce((sum, item) => sum + item.installmentCount, 0),
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

describe('Fatura OK collection-report scope', () => {
  const invoiceOk = (values: string[], hasBlank = false) => ({
    status: 'matched' as const,
    values,
    hasBlank,
  });
  const data = () =>
    snapshot([
      sourceCase(
        1,
        [line('2026-09-10', 100, 20), line('2026-11-10', 200, 50)],
        {},
        { representatives: ['REP-1'], invoiceOk: invoiceOk(['DND']) },
      ),
      sourceCase(
        2,
        [line('2026-09-10', 300, 0), line('2026-11-10', 400, 0)],
        {},
        { representatives: ['REP-2'], invoiceOk: invoiceOk(['GÜL']) },
      ),
      sourceCase(
        3,
        [line('2026-11-10', 900, 0)],
        {},
        { invoiceOk: invoiceOk(['DND', 'KOZANSOY']) },
      ),
      sourceCase(
        4,
        [line('2026-11-10', 500, 0)],
        {},
        { invoiceOk: invoiceOk([], true) },
      ),
    ]);
  it('uses one filtered scope for history, charts, totals, concentration and monthly detail', () => {
    const original = data();
    const result = buildCollectionReport(original, { invoiceOk: 'value:DND' });
    expect(result.selectedInvoiceOk).toBe('value:DND');
    const part = result.byCurrency[0];
    expect(part.summary.outstanding).toBe(230);
    expect(part.overdue.outstanding).toBe(80);
    expect(part.historical[0].outstanding).toBe(80);
    expect(part.nextMonth.outstanding).toBe(150);
    expect(part.monthly[0].outstanding).toBe(150);
    expect(part.period.outstanding).toBe(150);
    expect(part.overdueConcentration.top20Outstanding).toBe(80);
    expect(
      part.projectBreakdown.reduce(
        (sum, row) => sum + (row.period.outstanding ?? 0),
        0,
      ),
    ).toBe(150);
    expect(
      part.representativeBreakdown.filter((row) => row.period.caseCount > 0),
    ).toHaveLength(1);
    expect(result.detail.total).toBe(1);
    expect(result.detail.rows[0]).toMatchObject({
      invoiceOk: invoiceOk(['DND']),
      totals: { outstanding: 150 },
    });
    expect(
      buildCollectionReport(original).byCurrency[0].summary.outstanding,
    ).toBe(2330);
    expect(original).toEqual(data());
  });
  it('keeps mixed and blank independent and combines authorization/project/representative/currency filters', () => {
    const original = data();
    expect(
      buildCollectionReport(original, { invoiceOk: 'mixed' }).byCurrency[0]
        .nextMonth.outstanding,
    ).toBe(900);
    expect(
      buildCollectionReport(original, { invoiceOk: 'blank' }).byCurrency[0]
        .nextMonth.outstanding,
    ).toBe(500);
    expect(
      buildCollectionReport(original, { invoiceOk: 'value:KOZANSOY' }).detail
        .total,
    ).toBe(0);
    expect(
      buildCollectionReport(original, {
        invoiceOk: 'value:DND',
        representative: 'REP-2',
      }).detail.total,
    ).toBe(0);
    const result = buildCollectionReport(original, {
      invoiceOk: 'value:DND',
      representative: 'REP-1',
      projectGroup: 'LA_JOYA',
      authorizationState: 'blank',
      currency: 'GBP',
    });
    expect(result.detail.total).toBe(1);
  });
  it('rejects bad filters and never returns a false empty report on unavailable metadata', () => {
    expect(parseCollectionReportQuery({}).invoiceOk).toBe('all');
    expect(() =>
      parseCollectionReportQuery({ invoiceOk: ['value:DND'] }),
    ).toThrow(BadRequestException);
    const original = data();
    original.authorizationSource.status = 'unavailable';
    expect(() =>
      buildCollectionReport(original, {
        invoiceOk: 'value:DND',
        authorizationState: 'all',
      }),
    ).toThrow(ServiceUnavailableException);
    expect(
      buildCollectionReport(original, {
        invoiceOk: 'all',
        authorizationState: 'all',
      }).detail.total,
    ).toBe(4);
  });
});

describe('Collection report original due-date financial model', () => {
  it('partitions each installment once across monthly, past, future and undated buckets', () => {
    const data = snapshot([
      sourceCase(1, [
        line('2026-09-01', 100, 20),
        line('2026-10-01', 100, 50),
        line('2026-10-02', 100, 0),
        line('2026-11-15', 200, 50),
        line('2027-05-01', 300, 100),
        line(null, 40, 0),
      ]),
    ]);
    const original = structuredClone(data);
    const report = buildCollectionReport(data, {
      startMonth: '2026-10',
      months: '6',
    });
    const currency = report.byCurrency[0];
    expect(currency.summary).toEqual({
      scheduled: 840,
      paidToDate: 220,
      outstanding: 620,
      overdue: 130,
      caseCount: 1,
      installmentCount: 6,
      incompleteRows: 1,
    });
    expect(currency.beforeWindow.outstanding).toBe(80);
    expect(currency.monthly[0]).toMatchObject({
      month: '2026-10',
      scheduled: 200,
      paidToDate: 50,
      outstanding: 150,
      overdue: 50,
      caseCount: 1,
      installmentCount: 2,
    });
    const {
      month: _month,
      completionPercent: _rate,
      ...nextMonthTotals
    } = currency.monthly[1];
    void _month;
    void _rate;
    expect(currency.nextMonth).toEqual(nextMonthTotals);
    expect(currency.afterWindow.outstanding).toBe(200);
    expect(currency.undated).toMatchObject({ outstanding: 40, overdue: null });
    const partition = [
      currency.beforeWindow,
      ...currency.monthly,
      currency.afterWindow,
      currency.undated,
    ];
    for (const field of [
      'scheduled',
      'paidToDate',
      'outstanding',
      'installmentCount',
    ] as const)
      expect(
        partition.reduce((sum, entry) => sum + (entry[field] ?? 0), 0),
      ).toBe(currency.summary[field]);
    expect(report.detail).toMatchObject({ month: '2026-11', total: 1 });
    expect(report.detail.rows[0]).toMatchObject({
      key: data.cases[0].key,
      earliestDueDate: '2026-11-15',
      lastDueDate: '2026-11-15',
      totals: { scheduled: 200, paidToDate: 50, outstanding: 150 },
    });
    expect(report.source).not.toHaveProperty('cases');
    expect(data).toEqual(original);
  });

  it('keeps overpaid allocations and duplicate lines without netting obligations', () => {
    const duplicate = line('2026-11-10', 100, 20);
    const report = buildCollectionReport(
      snapshot([
        sourceCase(1, [
          line('2026-11-01', 100, 150),
          duplicate,
          { ...duplicate },
        ]),
      ]),
    );
    expect(report.byCurrency[0].nextMonth).toMatchObject({
      scheduled: 300,
      paidToDate: 190,
      outstanding: 160,
      overdue: 0,
      installmentCount: 3,
      caseCount: 1,
    });
    expect(report.detail.rows[0].totals.installmentCount).toBe(3);
  });

  it('retains paid and future obligations without describing allocations as dated receipts', () => {
    const report = buildCollectionReport(
      snapshot([
        sourceCase(1, [
          line('2026-09-10', 100, 100),
          line('2026-11-10', 100, 100),
        ]),
      ]),
    );
    expect(report.byCurrency[0].summary).toMatchObject({
      paidToDate: 200,
      outstanding: 0,
      installmentCount: 2,
    });
    expect(report.byCurrency[0].overdue).toMatchObject({
      paidToDate: 0,
      caseCount: 0,
      installmentCount: 0,
    });
    expect(report.byCurrency[0].nextMonth).toMatchObject({
      paidToDate: 100,
      outstanding: 0,
      caseCount: 1,
    });
  });

  it('preserves known subtotals and explicitly counts unknown money, dates and currency', () => {
    const report = buildCollectionReport(
      snapshot([
        sourceCase(1, [
          line('2026-09-01', null, null),
          line('2026-09-02', 100, 20),
          line('2026-11-01', null, null),
          line(null, 50, null),
        ]),
        sourceCase(2, [line('2026-11-01', null, null)], { currency: null }),
      ]),
      { currency: '__ALL__' },
    );
    const known = report.byCurrency.find((entry) => entry.currency === 'GBP')!;
    const unknown = report.byCurrency.find((entry) => entry.currency === null)!;
    expect(known.summary).toEqual({
      scheduled: 150,
      paidToDate: 20,
      outstanding: 80,
      overdue: 80,
      caseCount: 1,
      installmentCount: 4,
      incompleteRows: 3,
    });
    expect(known.overdue).toMatchObject({
      outstanding: 80,
      installmentCount: 2,
      incompleteRows: 1,
    });
    expect(known.nextMonth).toMatchObject({
      scheduled: null,
      paidToDate: null,
      outstanding: null,
      overdue: 0,
      incompleteRows: 1,
    });
    expect(known.undated).toMatchObject({
      scheduled: 50,
      paidToDate: null,
      outstanding: null,
      overdue: null,
      incompleteRows: 1,
    });
    expect(unknown.summary).toMatchObject({
      scheduled: null,
      outstanding: null,
      incompleteRows: 1,
    });
    expect(unknown.beforeWindow).toEqual({
      scheduled: 0,
      paidToDate: 0,
      outstanding: 0,
      overdue: 0,
      caseCount: 0,
      installmentCount: 0,
      incompleteRows: 0,
    });
    expect(report).not.toHaveProperty('summary');
    expect(report.currencyMode).toBe('all');
    expect(report.selectedCurrency).toBeNull();
  });

  it('includes only strictly past positive or unknown remaining amounts in the overdue bucket', () => {
    const report = buildCollectionReport(
      snapshot([
        sourceCase(1, [
          line('2026-10-01', 100, 20),
          line('2026-10-01', 100, 100),
          line('2026-10-01', null, null),
          line('2026-10-02', 100, 0),
          line('2026-10-03', 100, 0),
          line(null, 100, 0),
        ]),
      ]),
      { startMonth: '2026-10' },
    );
    expect(report.byCurrency[0].overdue).toEqual({
      scheduled: 100,
      paidToDate: 20,
      outstanding: 80,
      overdue: 80,
      caseCount: 1,
      installmentCount: 2,
      incompleteRows: 1,
    });
    expect(report.byCurrency[0].monthly[0]).toMatchObject({
      installmentCount: 5,
      outstanding: 280,
      overdue: 80,
    });
  });

  it('uses civil month boundaries across years, leap February and DST dates', () => {
    const report = buildCollectionReport(
      snapshot(
        [
          sourceCase(1, [
            line('2023-12-31', 10),
            line('2024-01-01', 20),
            line('2024-02-29', 30),
            line('2024-03-31', 40),
            line('2024-04-01', 50),
          ]),
        ],
        '2023-12-31',
      ),
      { startMonth: '2023-12', months: '6', detailMonth: '2024-03' },
    );
    expect(report.periods).toEqual([
      '2023-12',
      '2024-01',
      '2024-02',
      '2024-03',
      '2024-04',
      '2024-05',
    ]);
    expect(report.nextMonth).toBe('2024-01');
    expect(
      report.byCurrency[0].monthly.map((entry) => entry.outstanding),
    ).toEqual([10, 20, 30, 40, 50, 0]);
    expect(report.byCurrency[0].overdue.installmentCount).toBe(0);
    expect(report.detail.rows[0].earliestDueDate).toBe('2024-03-31');
  });

  it('keeps next month anchored to source date and allows detail outside the displayed window', () => {
    const data = snapshot([
      sourceCase(1, [line('2026-11-01', 100), line('2027-11-01', 200)]),
    ]);
    const report = buildCollectionReport(data, {
      startMonth: '2025-01',
      months: '6',
      detailMonth: '2027-11',
    });
    expect(report.nextMonth).toBe('2026-11');
    expect(report.byCurrency[0].nextMonth.outstanding).toBe(100);
    expect(report.byCurrency[0].afterWindow.outstanding).toBe(300);
    expect(report.detail.rows[0].totals.outstanding).toBe(200);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects nonfinite financial source value %s',
    (amount) => {
      expect(() =>
        buildCollectionReport(
          snapshot([sourceCase(1, [line('2026-11-01', amount)])]),
        ),
      ).toThrow(ServiceUnavailableException);
    },
  );

  it('rejects malformed nonnull source due dates instead of silently dropping them', () => {
    expect(() =>
      buildCollectionReport(snapshot([sourceCase(1, [line('2026-02-30')])])),
    ).toThrow(BadRequestException);
  });
});

describe('Collection report filters and detail pagination', () => {
  it('defaults to six future calendar months from the source date across year rollover', () => {
    const data = snapshot(
      [
        sourceCase(1, [
          line('2026-11-01', 100, 100),
          line('2026-12-31', 200),
          line('2027-01-01', 300),
          line('2027-06-30', 400),
          line('2027-07-01', 500),
        ]),
      ],
      '2026-12-31',
    );
    const original = structuredClone(data);
    const report = buildCollectionReport(data);
    expect(report.startMonth).toBe('2027-01');
    expect(report.months).toBe(6);
    expect(report.periods).toEqual([
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
    ]);
    expect(report.detail.month).toBe('2027-01');
    expect(report.byCurrency[0].beforeWindow.outstanding).toBe(200);
    expect(report.byCurrency[0].afterWindow.outstanding).toBe(500);
    expect(report.byCurrency[0].nextMonth.outstanding).toBe(300);
    expect(report.historicalPeriods).toEqual(['2026-11']);
    expect(data).toEqual(original);
  });

  it.each([6, 12, 24])(
    'honors an explicit start month and %s-month window independently of future defaults',
    (months) => {
      const data = snapshot([
        sourceCase(1, [
          line('2026-09-01'),
          line('2026-11-01'),
          line('2028-01-01'),
        ]),
      ]);
      const defaults = buildCollectionReport(data);
      const report = buildCollectionReport(data, {
        startMonth: '2025-01',
        months,
      });
      expect(report.startMonth).toBe('2025-01');
      expect(report.months).toBe(months);
      expect(report.periods).toHaveLength(months);
      expect(report.periods[0]).toBe('2025-01');
      expect(report.periods.at(-1)).toBe(
        months === 6 ? '2025-06' : months === 12 ? '2025-12' : '2026-12',
      );
      expect(report.byCurrency[0].summary).toEqual(
        defaults.byCurrency[0].summary,
      );
      expect(report.byCurrency[0].historical).toEqual(
        defaults.byCurrency[0].historical,
      );
      expect(report.byCurrency[0].nextMonth).toEqual(
        defaults.byCurrency[0].nextMonth,
      );
      expect(
        buildCollectionReport(data, { startMonth: '2025-01' }).months,
      ).toBe(6);
      expect(buildCollectionReport(data, { months }).startMonth).toBe(
        '2026-11',
      );
    },
  );

  it('defaults to the source-dominant currency, normal sales and blank authorization', () => {
    const data = snapshot([
      sourceCase(1, [
        line('2026-11-01', 100),
        line('2026-11-01', 30, 0, { paymentKind: 'vat', projectCode: 'KDV' }),
      ]),
      sourceCase(
        2,
        [line('2026-11-01', 200)],
        {},
        { authorization: { status: 'matched', codes: ['A'], hasBlank: false } },
      ),
      sourceCase(3, [line('2026-11-01', 500)], { currency: 'TL' }),
    ]);
    const report = buildCollectionReport(data);
    expect(report).toMatchObject({
      basis: 'original',
      selectedCurrency: 'GBP',
      currencyMode: 'single',
      selectedPaymentKind: 'sale',
      selectedAuthorizationState: 'blank',
      startMonth: '2026-11',
      months: 6,
    });
    expect(report.byCurrency).toHaveLength(1);
    expect(report.byCurrency[0].summary.outstanding).toBe(100);
    expect(report.currencies).toEqual([
      { value: 'GBP', label: 'GBP', recordCount: 3 },
      { value: 'TL', label: 'TL', recordCount: 1 },
    ]);
  });

  it('applies kind, project, representative and authorization before every bucket', () => {
    const data = snapshot([
      sourceCase(
        1,
        [
          line('2026-11-01', 100),
          line('2026-11-01', 20, 0, { paymentKind: 'vat', projectCode: 'KDV' }),
        ],
        {},
        { representatives: ['Ada', 'Ada'] },
      ),
      sourceCase(
        2,
        [line('2026-11-01', 300, 0, { projectCode: 'LJP-A2' })],
        { unitCode: 'LJP-A2' },
        { representatives: ['Ada'] },
      ),
      sourceCase(
        3,
        [line('2026-11-01', 400)],
        {},
        { representatives: ['Bob'] },
      ),
      sourceCase(
        4,
        [line('2026-11-01', 500)],
        {},
        {
          representatives: ['Ada'],
          authorization: { status: 'matched', codes: ['A'], hasBlank: false },
        },
      ),
    ]);
    const report = buildCollectionReport(data, {
      projectGroup: 'LA_JOYA',
      representative: 'Ada',
      paymentKind: 'vat',
    });
    expect(report.byCurrency[0].summary).toMatchObject({
      outstanding: 20,
      installmentCount: 1,
    });
    expect(report.byCurrency[0].nextMonth.outstanding).toBe(20);
    expect(report.detail.rows.map((row) => row.key)).toEqual([
      data.cases[0].key,
    ]);
    expect(report.projectGroups).toHaveLength(6);
    expect(
      report.projectGroups.find((row) => row.value === 'LA_JOYA')?.caseCount,
    ).toBe(1);
    expect(
      report.projectGroups.find((row) => row.value === 'LA_JOYA_PERLA')
        ?.caseCount,
    ).toBe(0);
    expect(report.representatives).toEqual([
      { value: 'Ada', label: 'Ada', caseCount: 1 },
    ]);
  });

  it('classifies project using all currencies and kinds before narrowing to selected lines', () => {
    const data = snapshot([
      sourceCase(1, [line('2026-11-01', 100)]),
      sourceCase(
        1,
        [
          line('2026-11-01', 20, 0, {
            paymentKind: 'vat',
            projectCode: 'LV-A1',
          }),
        ],
        { currency: 'TL' },
      ),
    ]);
    expect(
      buildCollectionReport(data, { currency: 'GBP', projectGroup: 'LA_JOYA' })
        .detail.total,
    ).toBe(0);
    const report = buildCollectionReport(data, {
      currency: 'GBP',
      projectGroup: 'UNKNOWN',
    });
    expect(report.detail.rows[0].projectGroup).toBe('UNKNOWN');
    expect(report.byCurrency[0].summary.outstanding).toBe(100);
  });

  it.each([
    ['all', [1, 2, 3, 4, 5]],
    ['blank', [1]],
    ['coded', [2, 3, 4]],
    ['mixed', [3]],
    ['multiple', [4]],
    ['unmatched', [5]],
  ] as const)(
    'supports authorization state %s without guessing from missing matches',
    (authorizationState, selected) => {
      const authorizations: PaymentSourceCase['authorization'][] = [
        { status: 'matched', codes: [], hasBlank: true },
        { status: 'matched', codes: ['A'], hasBlank: false },
        { status: 'matched', codes: ['A'], hasBlank: true },
        { status: 'matched', codes: ['A', 'B'], hasBlank: false },
        { status: 'unmatched', codes: [], hasBlank: false },
      ];
      const cases = authorizations.map((authorization, index) =>
        sourceCase(
          index + 1,
          [line('2026-11-01', index + 1)],
          {},
          { authorization },
        ),
      );
      const report = buildCollectionReport(snapshot(cases), {
        authorizationState,
      });
      expect(
        report.detail.rows
          .map((row) => Number(row.customerCode!.slice(2)))
          .sort(),
      ).toEqual([...selected]);
      expect(report.byCurrency[0].summary.outstanding).toBe(
        selected.reduce((sum, value) => sum + value, 0),
      );
    },
  );

  it('fails closed for authorization and representative metadata while allowing explicit unfiltered access', () => {
    const data = snapshot([sourceCase(1, [line('2026-11-01')])]);
    data.authorizationSource.status = 'unavailable';
    expect(() => buildCollectionReport(data)).toThrow(
      ServiceUnavailableException,
    );
    expect(() =>
      buildCollectionReport(data, {
        authorizationState: 'all',
        representative: 'Ada',
      }),
    ).toThrow(ServiceUnavailableException);
    expect(
      buildCollectionReport(data, { authorizationState: 'all' }).byCurrency[0]
        .summary.outstanding,
    ).toBe(100);
  });

  it('keeps all-currency amounts separate and distinguishes unknown from all', () => {
    const data = snapshot([
      sourceCase(1, [line('2026-11-01', 100)]),
      sourceCase(2, [line('2026-11-01', 1000)], { currency: 'TL' }),
      sourceCase(3, [line('2026-11-01', 50)], { currency: null }),
    ]);
    const all = buildCollectionReport(data, { currency: '__ALL__' });
    expect(
      all.byCurrency.map((row) => [row.currency, row.summary.outstanding]),
    ).toEqual([
      ['GBP', 100],
      [null, 50],
      ['TL', 1000],
    ]);
    for (const currency of all.byCurrency) {
      const single = buildCollectionReport(data, {
        currency: currency.currency ?? '__NULL__',
      });
      expect(single.byCurrency).toEqual([currency]);
      expect(single.currencyMode).toBe('single');
    }
    const unknown = buildCollectionReport(data, { currency: '__NULL__' });
    expect(unknown.selectedCurrency).toBeNull();
    expect(unknown.byCurrency[0].summary.incompleteRows).toBe(1);
  });

  it('sorts detail money only within currency and paginates without changing summaries', () => {
    const cases = Array.from({ length: 27 }, (_, index) =>
      sourceCase(index + 1, [line('2026-11-01', index + 1)]),
    );
    cases.push(sourceCase(90, [line('2026-11-01', 99999)], { currency: 'TL' }));
    cases.push(sourceCase(91, [line('2026-11-01', null, null)]));
    cases.push(
      sourceCase(92, [line('2026-11-01', 999999)], { currency: null }),
    );
    const data = snapshot(cases);
    const first = buildCollectionReport(data, { currency: '__ALL__' });
    const second = buildCollectionReport(data, {
      currency: '__ALL__',
      page: '2',
    });
    const complete = buildCollectionReport(data, {
      currency: '__ALL__',
      pageSize: '100',
    });
    expect(first.detail).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 30,
      totalPages: 2,
    });
    expect(second.detail.rows).toHaveLength(5);
    expect([...first.detail.rows, ...second.detail.rows]).toEqual(
      complete.detail.rows,
    );
    expect(first.byCurrency).toEqual(second.byCurrency);
    expect(
      complete.detail.rows.slice(0, 27).map((row) => row.totals.outstanding),
    ).toEqual(Array.from({ length: 27 }, (_, index) => 27 - index));
    expect(
      complete.detail.rows
        .slice(-3)
        .map((row) => [row.currency, row.totals.outstanding]),
    ).toEqual([
      ['GBP', null],
      ['TL', 99999],
      [null, 999999],
    ]);
    expect(buildCollectionReport(data, { page: '999' }).detail.page).toBe(2);
  });

  it('returns explicit empty buckets and stable options without inventing a currency for empty source', () => {
    const empty = buildCollectionReport(snapshot([]));
    expect(empty.byCurrency).toEqual([]);
    expect(empty.currencies).toEqual([]);
    expect(empty.projectGroups.every((row) => row.caseCount === 0)).toBe(true);
    expect(empty.detail).toEqual({
      scope: 'month',
      agingBucket: '',
      month: '2026-11',
      rows: [],
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 1,
    });
    const filtered = buildCollectionReport(
      snapshot([sourceCase(1, [line('2026-11-01')])]),
      { representative: 'missing' },
    );
    expect(filtered.byCurrency[0].summary).toMatchObject({
      scheduled: 0,
      paidToDate: 0,
      outstanding: 0,
      overdue: 0,
      installmentCount: 0,
    });
  });
});

describe('Collection report current-scope management insights', () => {
  it('includes today through month end independently of the selected window and timestamp timezone', () => {
    const data = snapshot(
      [
        sourceCase(1, [
          line('2026-12-30', 10),
          line('2026-12-31', 40, 10),
          line('2026-12-31', 20, 20),
          line('2027-01-01', 90),
          line(null, 500),
        ]),
      ],
      '2026-12-31',
    );
    data.generatedAt = '2026-12-30T22:30:00.000Z';
    const report = buildCollectionReport(data, {
      startMonth: '2020-01',
      months: 12,
    });
    expect(report.byCurrency[0].currentMonthRemaining).toEqual({
      scheduled: 60,
      paidToDate: 30,
      outstanding: 30,
      overdue: 0,
      installmentCount: 2,
      caseCount: 1,
      incompleteRows: 0,
    });
    expect(report.nextMonth).toBe('2027-01');
    expect(report.byCurrency[0].nextMonth.outstanding).toBe(90);
    expect(report.byCurrency[0].overdue.outstanding).toBe(10);
    expect(
      report.byCurrency[0].monthly.every((row) => row.outstanding === 0),
    ).toBe(true);
    expect(
      buildCollectionReport(data).byCurrency[0].currentMonthRemaining,
    ).toEqual(report.byCurrency[0].currentMonthRemaining);
    expect(() =>
      buildCollectionReport(
        snapshot([sourceCase(2, [line('2026-12-31T00:00:00Z')])]),
      ),
    ).toThrow(BadRequestException);
  });

  it('counts exact customer codes across units and ranks only positive overdue balances', () => {
    const cases = Array.from({ length: 22 }, (_, index) =>
      sourceCase(index + 1, [line('2026-09-01', index + 1)]),
    );
    cases.push(
      sourceCase(23, [line('2026-09-02', 10)], { customerCode: 'C-22' }),
      sourceCase(24, [line('2026-09-02', 5)], { customerCode: 'c-22' }),
      sourceCase(25, [line('2026-09-02', 6)], { customerCode: 'C-22 ' }),
      sourceCase(26, [line('2026-11-01', 99999)]),
      sourceCase(27, [line('2026-09-01', 100, 100)], { customerCode: null }),
    );
    const concentration = buildCollectionReport(snapshot(cases)).byCurrency[0]
      .overdueConcentration;
    expect(concentration).toEqual({
      complete: true,
      customerGroupCount: 24,
      top20GroupCount: 20,
      top20Outstanding: 264,
      top20SharePercent: 96.35,
    });
    expect(Object.keys(concentration)).not.toContain('customers');
  });

  it('reports zero groups and no percentage for an empty overdue denominator', () => {
    const report = buildCollectionReport(
      snapshot([sourceCase(1, [line('2026-11-01', 50)])]),
    );
    expect(report.byCurrency[0].overdueConcentration).toEqual({
      complete: true,
      customerGroupCount: 0,
      top20GroupCount: 0,
      top20Outstanding: 0,
      top20SharePercent: null,
    });
    expect(report.byCurrency[0].projectInsights[0]).toMatchObject({
      overdueOutstanding: 0,
      overdueSharePercent: null,
      nextMonthSharePercent: 100,
    });
  });

  it.each(['amount', 'paid', 'customer', 'currency'])(
    'hides exact concentration metrics when %s is unavailable',
    (missing) => {
      const item = sourceCase(
        1,
        [
          line(
            '2026-09-01',
            missing === 'amount' ? null : 100,
            missing === 'paid' ? null : 0,
          ),
        ],
        {
          customerCode: missing === 'customer' ? '   ' : 'C-1',
          currency: missing === 'currency' ? null : 'GBP',
        },
      );
      const report = buildCollectionReport(snapshot([item]), {
        currency: missing === 'currency' ? '__NULL__' : 'GBP',
      });
      expect(report.byCurrency[0].overdueConcentration).toEqual({
        complete: false,
        customerGroupCount: null,
        top20GroupCount: null,
        top20Outstanding: null,
        top20SharePercent: null,
      });
    },
  );

  it('keeps known project amounts but hides shares against a partial currency denominator', () => {
    const report = buildCollectionReport(
      snapshot([
        sourceCase(1, [line('2026-09-01', 100), line('2026-11-01', 200)]),
        sourceCase(
          2,
          [
            line('2026-09-01', null, 0, { projectCode: 'LV-A2' }),
            line('2026-11-01', null, 0, { projectCode: 'LV-A2' }),
          ],
          { unitCode: 'LV-A2' },
        ),
        sourceCase(3, [line('2026-10-02', null, 0), line('2026-10-31', 50)]),
      ]),
    );
    const bucket = report.byCurrency[0];
    expect(bucket.overdue.outstanding).toBe(100);
    expect(bucket.overdueConcentration.complete).toBe(false);
    expect(bucket.currentMonthRemaining).toMatchObject({
      outstanding: 50,
      incompleteRows: 1,
    });
    expect(bucket.projectInsights).toEqual([
      {
        projectGroup: 'LA_JOYA',
        overdueOutstanding: 100,
        nextMonthOutstanding: 200,
        overdueSharePercent: null,
        nextMonthSharePercent: null,
      },
      {
        projectGroup: 'LAGOON_VERDE',
        overdueOutstanding: null,
        nextMonthOutstanding: null,
        overdueSharePercent: null,
        nextMonthSharePercent: null,
      },
    ]);
  });

  it('applies every existing filter to insights and never combines currencies', () => {
    const base = sourceCase(
      1,
      [
        line('2026-09-01', 100),
        line('2026-10-02', 20),
        line('2026-11-01', 30),
        line('2026-09-01', 999, 0, { paymentKind: 'vat', projectCode: 'KDV' }),
      ],
      {},
      { representatives: ['Ada'] },
    );
    const data = snapshot([
      base,
      sourceCase(
        2,
        [line('2026-09-01', 1000)],
        {},
        { representatives: ['Bob'] },
      ),
      sourceCase(
        3,
        [line('2026-09-01', 2000, 0, { projectCode: 'LV-A3' })],
        { unitCode: 'LV-A3' },
        { representatives: ['Ada'] },
      ),
      sourceCase(
        4,
        [line('2026-09-01', 3000)],
        {},
        {
          representatives: ['Ada'],
          authorization: {
            status: 'matched',
            hasBlank: false,
            codes: ['CODED'],
          },
        },
      ),
      sourceCase(
        5,
        [line('2026-09-01', 500)],
        { currency: 'EUR' },
        { representatives: ['Ada'] },
      ),
    ]);
    const filters = { projectGroup: 'LA_JOYA', representative: 'Ada' };
    const all = buildCollectionReport(data, {
      ...filters,
      currency: '__ALL__',
    });
    for (const bucket of all.byCurrency) {
      expect(
        buildCollectionReport(data, { ...filters, currency: bucket.currency })
          .byCurrency,
      ).toEqual([bucket]);
      expect(bucket.overdueConcentration).toMatchObject({
        customerGroupCount: 1,
        top20GroupCount: 1,
        top20SharePercent: 100,
      });
    }
    const gbp = all.byCurrency.find((bucket) => bucket.currency === 'GBP')!;
    expect(gbp.currentMonthRemaining.outstanding).toBe(20);
    expect(gbp.projectInsights).toEqual([
      {
        projectGroup: 'LA_JOYA',
        overdueOutstanding: 100,
        nextMonthOutstanding: 30,
        overdueSharePercent: 100,
        nextMonthSharePercent: 100,
      },
    ]);
    expect(
      buildCollectionReport(data, {
        ...filters,
        currency: 'GBP',
        paymentKind: 'all',
      }).byCurrency[0].overdueConcentration.top20Outstanding,
    ).toBe(1099);
  });

  it('retains UNKNOWN as a separate canonical project without inventing a match', () => {
    const report = buildCollectionReport(
      snapshot([
        sourceCase(1, [line('2026-09-01', 100), line('2026-11-01', 200)]),
        sourceCase(2, [line('2026-09-01', 300), line('2026-11-01', 200)], {
          unitCode: 'unmapped-unit',
        }),
      ]),
    );
    expect(report.byCurrency[0].projectInsights).toEqual([
      {
        projectGroup: 'UNKNOWN',
        overdueOutstanding: 300,
        nextMonthOutstanding: 200,
        overdueSharePercent: 75,
        nextMonthSharePercent: 50,
      },
      {
        projectGroup: 'LA_JOYA',
        overdueOutstanding: 100,
        nextMonthOutstanding: 200,
        overdueSharePercent: 25,
        nextMonthSharePercent: 50,
      },
    ]);
  });
});

describe('Collection report historical months', () => {
  it('includes distinct paid-off historical months across years, independent of the selected window', () => {
    const data = snapshot([
      sourceCase(1, [
        line('2023-12-31', 100, 100),
        line('2024-02-01', 100, 20),
        line('2024-02-29', 50, 0),
        line('2026-09-30', 200, 100),
        line('2026-10-01', 300, 0),
        line('2026-10-02', 400, 0),
        line('2026-11-01', 500, 0),
        line(null, 600, 0),
      ]),
    ]);
    const original = structuredClone(data);
    const report = buildCollectionReport(data);
    expect(report.historicalPeriods).toEqual(['2023-12', '2024-02', '2026-09']);
    expect(report.byCurrency[0].historical).toEqual([
      {
        month: '2023-12',
        scheduled: 100,
        paidToDate: 100,
        outstanding: 0,
        overdue: 0,
        caseCount: 1,
        installmentCount: 1,
        incompleteRows: 0,
        completionPercent: 100,
      },
      {
        month: '2024-02',
        scheduled: 150,
        paidToDate: 20,
        outstanding: 130,
        overdue: 130,
        caseCount: 1,
        installmentCount: 2,
        incompleteRows: 0,
        completionPercent: 13.33,
      },
      {
        month: '2026-09',
        scheduled: 200,
        paidToDate: 100,
        outstanding: 100,
        overdue: 100,
        caseCount: 1,
        installmentCount: 1,
        incompleteRows: 0,
        completionPercent: 50,
      },
    ]);
    // October 1 is overdue on the 2nd, but belongs to the current month.
    expect(report.byCurrency[0].overdue.outstanding).toBe(530);
    for (const startMonth of ['2020-01', '2024-01', '2028-01']) {
      const moved = buildCollectionReport(data, { startMonth, months: '6' });
      expect(moved.historicalPeriods).toEqual(report.historicalPeriods);
      expect(moved.byCurrency[0].historical).toEqual(
        report.byCurrency[0].historical,
      );
      expect(moved.byCurrency[0].summary).toEqual(report.byCurrency[0].summary);
      expect(moved.byCurrency[0].nextMonth).toEqual(
        report.byCurrency[0].nextMonth,
      );
    }
    expect(data).toEqual(original);
  });

  it('applies currency, kind, project, representative and authorization before building historical periods', () => {
    const data = snapshot([
      sourceCase(
        1,
        [
          line('2025-01-01', 100),
          line('2025-02-01', 20, 0, { paymentKind: 'vat', projectCode: 'KDV' }),
        ],
        {},
        { representatives: ['Ada'] },
      ),
      sourceCase(
        2,
        [line('2025-03-01', 200)],
        { currency: 'TL' },
        { representatives: ['Ada'] },
      ),
      sourceCase(
        3,
        [line('2025-04-01', 300, 0, { projectCode: 'LJP-A3' })],
        { unitCode: 'LJP-A3' },
        { representatives: ['Ada'] },
      ),
      sourceCase(
        4,
        [line('2025-05-01', 400)],
        {},
        { representatives: ['Bob'] },
      ),
      sourceCase(
        5,
        [line('2025-06-01', 500)],
        {},
        {
          representatives: ['Ada'],
          authorization: { status: 'matched', codes: ['A'], hasBlank: false },
        },
      ),
    ]);
    const filters = {
      currency: 'GBP',
      paymentKind: 'sale',
      projectGroup: 'LA_JOYA',
      representative: 'Ada',
    };
    expect(buildCollectionReport(data, filters).historicalPeriods).toEqual([
      '2025-01',
    ]);
    expect(
      buildCollectionReport(data, { ...filters, currency: '__ALL__' })
        .historicalPeriods,
    ).toEqual(['2025-01', '2025-03']);
    expect(
      buildCollectionReport(data, { ...filters, paymentKind: 'all' })
        .historicalPeriods,
    ).toEqual(['2025-01', '2025-02']);
    expect(
      buildCollectionReport(data, { ...filters, projectGroup: '' })
        .historicalPeriods,
    ).toEqual(['2025-01', '2025-04']);
    expect(
      buildCollectionReport(data, { ...filters, representative: '' })
        .historicalPeriods,
    ).toEqual(['2025-01', '2025-05']);
    expect(
      buildCollectionReport(data, { ...filters, authorizationState: 'all' })
        .historicalPeriods,
    ).toEqual(['2025-01', '2025-06']);
    expect(
      buildCollectionReport(data, { ...filters, representative: 'missing' })
        .historicalPeriods,
    ).toEqual([]);
  });

  it('aligns every selected currency to one historical axis without adding missing money or losing duplicates', () => {
    const duplicate = line('2025-01-01', 100, 20);
    const data = snapshot([
      sourceCase(1, [duplicate, { ...duplicate }]),
      sourceCase(2, [line('2025-02-01', 300, 300)], { currency: 'TL' }),
      sourceCase(3, [line('2025-03-01', null, null)], { currency: null }),
      sourceCase(4, [line('2026-11-01', 9999)], { currency: 'EUR' }),
    ]);
    const report = buildCollectionReport(data, { currency: '__ALL__' });
    expect(report.historicalPeriods).toEqual(['2025-01', '2025-02', '2025-03']);
    for (const bucket of report.byCurrency)
      expect(bucket.historical.map((row) => row.month)).toEqual(
        report.historicalPeriods,
      );
    const gbp = report.byCurrency.find((bucket) => bucket.currency === 'GBP')!;
    expect(gbp.historical[0]).toMatchObject({
      scheduled: 200,
      paidToDate: 40,
      outstanding: 160,
      caseCount: 1,
      installmentCount: 2,
    });
    expect(gbp.historical[1]).toEqual({
      month: '2025-02',
      scheduled: 0,
      paidToDate: 0,
      outstanding: 0,
      overdue: 0,
      caseCount: 0,
      installmentCount: 0,
      incompleteRows: 0,
      completionPercent: null,
    });
    expect(
      report.byCurrency.find((bucket) => bucket.currency === 'TL')!
        .historical[1],
    ).toMatchObject({ paidToDate: 300, outstanding: 0, installmentCount: 1 });
    expect(
      report.byCurrency.find((bucket) => bucket.currency === null)!
        .historical[2],
    ).toMatchObject({
      scheduled: null,
      outstanding: null,
      overdue: null,
      incompleteRows: 1,
    });
    expect(
      report.byCurrency
        .find((bucket) => bucket.currency === 'EUR')!
        .historical.every(
          (row) => row.installmentCount === 0 && row.outstanding === 0,
        ),
    ).toBe(true);
    expect(
      buildCollectionReport(data, { currency: 'GBP' }).historicalPeriods,
    ).toEqual(['2025-01']);
    expect(
      buildCollectionReport(data, { currency: '__NULL__' }).historicalPeriods,
    ).toEqual(['2025-03']);
  });

  it('drills into paid and open historical installments without changing current-window totals', () => {
    const data = snapshot([
      sourceCase(1, [
        line('2025-09-01', 100, 100),
        line('2025-09-30', 200, 50),
        line('2026-11-01', 500),
      ]),
      sourceCase(2, [line('2025-09-15', 50, 50)]),
    ]);
    const current = buildCollectionReport(data);
    const historical = buildCollectionReport(data, { detailMonth: '2025-09' });
    expect(historical.byCurrency).toEqual(current.byCurrency);
    expect(historical.periods).toEqual(current.periods);
    expect(historical.detail).toMatchObject({ month: '2025-09', total: 2 });
    expect(historical.detail.rows[0]).toMatchObject({
      key: data.cases[0].key,
      earliestDueDate: '2025-09-01',
      lastDueDate: '2025-09-30',
      totals: {
        scheduled: 300,
        paidToDate: 150,
        outstanding: 150,
        installmentCount: 2,
      },
    });
    expect(historical.detail.rows[1].totals.outstanding).toBe(0);
    expect(historical.byCurrency[0].historical[0]).toMatchObject({
      scheduled: 350,
      paidToDate: 200,
      outstanding: 150,
      caseCount: 2,
      installmentCount: 3,
    });
  });

  it('moves December into historical months at the January boundary and keeps empty history explicit', () => {
    const cases = [
      sourceCase(1, [
        line('2026-12-31', 100, 100),
        line('2027-01-01', 100),
        line(null, 100),
      ]),
    ];
    expect(
      buildCollectionReport(snapshot(cases, '2026-12-31')).historicalPeriods,
    ).toEqual([]);
    const january = buildCollectionReport(snapshot(cases, '2027-01-01'));
    expect(january.historicalPeriods).toEqual(['2026-12']);
    expect(january.byCurrency[0].historical[0].outstanding).toBe(0);
    const noHistory = buildCollectionReport(
      snapshot([sourceCase(1, [line('2026-10-01'), line(null)])]),
    );
    expect(noHistory.historicalPeriods).toEqual([]);
    expect(noHistory.byCurrency[0].historical).toEqual([]);
    expect(buildCollectionReport(snapshot([])).historicalPeriods).toEqual([]);
  });
});

describe('Collection report performance and disjoint ownership analytics', () => {
  it('uses weighted due-based completion and unique selected-period case counts', () => {
    const data = snapshot([
      sourceCase(1, [
        line('2026-09-01', 100, 120),
        line('2026-11-01', 1000, 1000),
        line('2026-12-01', 100, 0),
        line('2027-06-01', 900, 450),
      ]),
      sourceCase(2, [line('2026-11-01', 100, 0)]),
    ]);
    const original = structuredClone(data);
    const report = buildCollectionReport(data);
    expect(report).toMatchObject({
      analyticsVersion: 1,
      selectedRepresentative: '',
      selectedRepresentativeState: '',
    });
    expect(report.byCurrency[0].period).toEqual({
      scheduled: 1200,
      paidToDate: 1000,
      outstanding: 200,
      overdue: 0,
      caseCount: 2,
      installmentCount: 3,
      incompleteRows: 0,
      completionPercent: 83.33,
    });
    expect(report.byCurrency[0].monthly[0].completionPercent).toBe(90.91);
    expect(report.byCurrency[0].monthly[1].completionPercent).toBe(0);
    expect(report.byCurrency[0].monthly[2].completionPercent).toBeNull();
    expect(report.byCurrency[0].historical[0].completionPercent).toBe(120);
    const expanded = buildCollectionReport(data, {
      startMonth: '2026-09',
      months: '12',
    });
    expect(expanded.byCurrency[0].period).toMatchObject({
      scheduled: 2200,
      paidToDate: 1570,
      outstanding: 650,
      completionPercent: 71.36,
      caseCount: 2,
    });
    expect(data).toEqual(original);
  });

  it.each([
    ['missing scheduled', line('2026-11-01', null, 20)],
    ['missing paid', line('2026-11-01', 100, null)],
    ['missing outstanding', line('2026-11-01', 100, 20, { outstanding: null })],
    ['signed scheduled', line('2026-11-01', -20, 0)],
    ['signed paid', line('2026-11-01', 100, -20)],
    ['signed outstanding', line('2026-11-01', 100, 20, { outstanding: -10 })],
  ])(
    'withholds completion for %s even when the known totals are positive',
    (_name, item) => {
      const report = buildCollectionReport(
        snapshot([sourceCase(1, [item, line('2026-11-02', 1000, 500)])]),
      );
      const bucket = report.byCurrency[0];
      expect(bucket.period.completionPercent).toBeNull();
      expect(bucket.monthly[0].completionPercent).toBeNull();
      expect(bucket.projectBreakdown[0].period.completionPercent).toBeNull();
      expect(
        bucket.representativeBreakdown[0].period.completionPercent,
      ).toBeNull();
    },
  );

  it('keeps zero denominators and unknown-currency completion unknown without clamping valid overpayment', () => {
    const report = buildCollectionReport(
      snapshot([
        sourceCase(1, [line('2026-11-01', 0, 20)]),
        sourceCase(2, [line('2026-11-01', 100, 150)], { currency: 'EUR' }),
        sourceCase(3, [line('2026-11-01', 100, 20)], { currency: null }),
      ]),
      { currency: '__ALL__' },
    );
    expect(
      report.byCurrency.find((part) => part.currency === 'GBP')!.period
        .completionPercent,
    ).toBeNull();
    expect(
      report.byCurrency.find((part) => part.currency === 'EUR')!.period
        .completionPercent,
    ).toBe(150);
    const unknown = report.byCurrency.find((part) => part.currency === null)!;
    expect(unknown.period).toMatchObject({
      scheduled: 100,
      paidToDate: 20,
      outstanding: 80,
      incompleteRows: 1,
      completionPercent: null,
    });
    expect(unknown.projectBreakdown[0].period.completionPercent).toBeNull();
    expect(
      unknown.representativeBreakdown[0].period.completionPercent,
    ).toBeNull();
  });

  it('partitions each currency and month once across canonical projects and representative ownership', () => {
    const data = snapshot([
      sourceCase(
        1,
        [
          line('2026-09-01', 60, 10),
          line('2026-11-01', 100, 20),
          line('2026-12-01', 50, 0),
        ],
        {},
        { representatives: ['Ada', 'Ada', '', '  '] },
      ),
      sourceCase(
        2,
        [line('2026-11-01', 200, 50, { projectCode: 'LJP-A2' })],
        { unitCode: 'LJP-A2' },
        { representatives: ['Bob'] },
      ),
      sourceCase(
        3,
        [line('2026-11-01', 300, 100)],
        {},
        { representatives: ['Ada', 'Bob', 'Ada'] },
      ),
      sourceCase(
        4,
        [line('2026-11-01', 400, 200, { projectCode: 'UNKNOWN' })],
        { unitCode: 'UNKNOWN' },
      ),
      sourceCase(
        5,
        [line('2026-11-01', 500, 400)],
        { currency: 'EUR' },
        { representatives: ['Ada'] },
      ),
      sourceCase(6, [line('2026-11-01', null, null)], { currency: null }),
      sourceCase(7, [line('2027-09-01', 70, 0)]),
    ]);
    const report = buildCollectionReport(data, { currency: '__ALL__' });
    const gbp = report.byCurrency.find((part) => part.currency === 'GBP')!;
    expect(
      gbp.projectBreakdown.map((group) => group.projectGroup).sort(),
    ).toEqual(['LA_JOYA', 'LA_JOYA_PERLA', 'UNKNOWN']);
    expect(
      gbp.representativeBreakdown.map((group) => group.key).sort(),
    ).toEqual(['multiple', 'single:Ada', 'single:Bob', 'unassigned']);
    expect(
      gbp.representativeBreakdown.find((group) => group.key === 'multiple'),
    ).toMatchObject({
      representative: null,
      representativeState: 'multiple',
      period: {
        scheduled: 300,
        paidToDate: 100,
        outstanding: 200,
        caseCount: 1,
      },
    });
    expect(
      gbp.representativeBreakdown.find((group) => group.key === 'single:Ada'),
    ).toMatchObject({
      representative: 'Ada',
      representativeState: 'single',
      period: { scheduled: 150, outstanding: 130, caseCount: 1 },
      overdue: { outstanding: 50 },
    });
    for (const bucket of report.byCurrency) {
      for (const groups of [
        bucket.projectBreakdown,
        bucket.representativeBreakdown,
      ]) {
        for (const scope of ['period', 'overdue', 'nextMonth'] as const)
          for (const field of [
            'scheduled',
            'paidToDate',
            'outstanding',
            'overdue',
            'caseCount',
            'installmentCount',
            'incompleteRows',
          ] as const)
            expect(
              groups.reduce(
                (sum, group) => sum + (group[scope][field] ?? 0),
                0,
              ),
            ).toBe(bucket[scope][field] ?? 0);
        for (const [index, row] of bucket.monthly.entries()) {
          expect(
            groups.every((group) => group.monthly[index].month === row.month),
          ).toBe(true);
          for (const field of [
            'scheduled',
            'paidToDate',
            'outstanding',
            'overdue',
            'caseCount',
            'installmentCount',
            'incompleteRows',
          ] as const)
            expect(
              groups.reduce(
                (sum, group) => sum + (group.monthly[index][field] ?? 0),
                0,
              ),
            ).toBe(row[field] ?? 0);
        }
      }
      expect(
        buildCollectionReport(data, { currency: bucket.currency ?? '__NULL__' })
          .byCurrency[0],
      ).toMatchObject({
        period: bucket.period,
        monthly: bucket.monthly,
        projectBreakdown: bucket.projectBreakdown,
        representativeBreakdown: bucket.representativeBreakdown,
      });
    }
  });

  it('preserves exact nonblank representative identities while grouping duplicate names only once', () => {
    const report = buildCollectionReport(
      snapshot([
        sourceCase(
          1,
          [line('2026-11-01')],
          {},
          { representatives: ['Ada', 'Ada', '', ' '] },
        ),
        sourceCase(2, [line('2026-11-01')], {}, { representatives: ['Ada '] }),
        sourceCase(
          3,
          [line('2026-11-01')],
          {},
          { representatives: ['', '  '] },
        ),
      ]),
    );
    expect(report.representatives.map((entry) => entry.value).sort()).toEqual([
      'Ada',
      'Ada ',
    ]);
    expect(
      report.byCurrency[0].representativeBreakdown
        .map((entry) => entry.key)
        .sort(),
    ).toEqual(['single:Ada', 'single:Ada ', 'unassigned']);
  });

  it.each(['multiple', 'unassigned'] as const)(
    'applies %s ownership state consistently to period, history and details',
    (state) => {
      const cases = [
        sourceCase(
          1,
          [line('2026-09-01'), line('2026-11-01')],
          {},
          { representatives: ['Ada', 'Bob'] },
        ),
        sourceCase(
          2,
          [line('2026-08-01'), line('2026-11-01')],
          {},
          { representatives: [] },
        ),
        sourceCase(
          3,
          [line('2026-07-01'), line('2026-11-01')],
          {},
          { representatives: ['Ada'] },
        ),
      ];
      const report = buildCollectionReport(snapshot(cases), {
        representativeState: state,
      });
      expect(report.selectedRepresentativeState).toBe(state);
      expect(report.historicalPeriods).toEqual([
        state === 'multiple' ? '2026-09' : '2026-08',
      ]);
      expect(report.byCurrency[0].period.caseCount).toBe(1);
      expect(report.byCurrency[0].representativeBreakdown).toHaveLength(1);
      expect(report.byCurrency[0].representativeBreakdown[0].key).toBe(state);
      expect(report.detail.rows.map((row) => row.key)).toEqual([
        cases[state === 'multiple' ? 0 : 1].key,
      ]);
      const named = buildCollectionReport(snapshot(cases), {
        representative: 'Ada',
      });
      expect(named.byCurrency[0].period.caseCount).toBe(2);
      expect(
        named.byCurrency[0].representativeBreakdown
          .map((group) => group.key)
          .sort(),
      ).toEqual(['multiple', 'single:Ada']);
    },
  );

  it('applies currency, kind, project and authorization before every analytics bucket', () => {
    const selected = sourceCase(
      1,
      [
        line('2026-11-01', 100),
        line('2026-11-01', 30, 10, { paymentKind: 'vat', projectCode: 'KDV' }),
      ],
      {},
      { representatives: ['Ada', 'Bob'] },
    );
    const cases = [
      selected,
      sourceCase(
        2,
        [
          line('2026-11-01', 200, 0, {
            paymentKind: 'vat',
            projectCode: 'KDV',
          }),
        ],
        { currency: 'EUR' },
        { representatives: ['Ada', 'Bob'] },
      ),
      sourceCase(
        3,
        [
          line('2026-11-01', 300, 0, {
            paymentKind: 'vat',
            projectCode: 'KDV',
          }),
        ],
        { unitCode: 'LJP-A3' },
        { representatives: ['Ada', 'Bob'] },
      ),
      sourceCase(
        4,
        [
          line('2026-11-01', 400, 0, {
            paymentKind: 'vat',
            projectCode: 'KDV',
          }),
        ],
        {},
        {
          representatives: ['Ada', 'Bob'],
          authorization: { status: 'matched', hasBlank: false, codes: ['A'] },
        },
      ),
      sourceCase(
        5,
        [
          line('2026-11-01', 500, 0, {
            paymentKind: 'vat',
            projectCode: 'KDV',
          }),
        ],
        {},
        { representatives: ['Ada'] },
      ),
    ];
    const report = buildCollectionReport(snapshot(cases), {
      currency: 'GBP',
      paymentKind: 'vat',
      projectGroup: 'LA_JOYA',
      representativeState: 'multiple',
    });
    expect(report.byCurrency[0].period).toMatchObject({
      scheduled: 30,
      paidToDate: 10,
      outstanding: 20,
      completionPercent: 33.33,
      caseCount: 1,
    });
    expect(report.byCurrency[0].projectBreakdown).toHaveLength(1);
    expect(report.byCurrency[0].representativeBreakdown).toHaveLength(1);
    expect(report.detail.rows[0].key).toBe(selected.key);
  });

  it('withholds representative charts when metadata is unavailable and rejects both ownership filters', () => {
    const data = snapshot([
      sourceCase(1, [line('2026-11-01')], {}, { representatives: ['Ada'] }),
    ]);
    data.authorizationSource.status = 'unavailable';
    const report = buildCollectionReport(data, { authorizationState: 'all' });
    expect(report.byCurrency[0].representativeBreakdown).toEqual([]);
    expect(report.byCurrency[0].projectBreakdown).toHaveLength(1);
    for (const filters of [
      { representative: 'Ada' },
      { representativeState: 'unassigned' },
      { representativeState: 'multiple' },
    ])
      expect(() =>
        buildCollectionReport(data, { authorizationState: 'all', ...filters }),
      ).toThrow(ServiceUnavailableException);
  });
});

describe('Collection report overdue aging', () => {
  const boundaries = [
    ['2026-10-02', '1_30'],
    ['2026-09-03', '1_30'],
    ['2026-09-02', '31_60'],
    ['2026-08-04', '31_60'],
    ['2026-08-03', '61_90'],
    ['2026-07-05', '61_90'],
    ['2026-07-04', '90_plus'],
  ] as const;

  it.each(boundaries)(
    'assigns %s to %s from the source date rather than cached status or overdueDays',
    (dueDate, expected) => {
      const report = buildCollectionReport(
        snapshot(
          [
            sourceCase(1, [
              line(dueDate, 120, 20, { overdueDays: 999, status: 'paid' }),
            ]),
          ],
          '2026-10-03',
        ),
      );
      const buckets = report.byCurrency[0].aging;
      expect(buckets.map((bucket) => bucket.key)).toEqual([
        '1_30',
        '31_60',
        '61_90',
        '90_plus',
      ]);
      for (const bucket of buckets) {
        expect(bucket.outstanding).toBe(bucket.key === expected ? 100 : 0);
        expect(bucket.installmentCount).toBe(bucket.key === expected ? 1 : 0);
      }
    },
  );

  it('partitions overdue money and installments while counting cases distinctly inside each bucket', () => {
    const installments = boundaries.map(([dueDate], index) =>
      line(dueDate, 100 + index, index),
    );
    installments.push(
      line('2026-10-03', 700, 0),
      line('2026-10-04', 800, 0),
      line('2026-09-01', 200, 200),
      line('2026-08-01', 200, 300),
      line(null, 300, 0),
      line('2026-10-03', null, 0),
      line('2026-10-04', null, 0),
    );
    const data = snapshot([sourceCase(1, installments)], '2026-10-03');
    const { aging, overdue } = buildCollectionReport(data).byCurrency[0];
    expect(aging.map((bucket) => bucket.installmentCount)).toEqual([
      2, 2, 2, 1,
    ]);
    expect(overdue).toMatchObject({
      outstanding: 700,
      caseCount: 1,
      installmentCount: 7,
      incompleteRows: 0,
    });
    for (const field of [
      'scheduled',
      'paidToDate',
      'outstanding',
      'overdue',
      'installmentCount',
      'incompleteRows',
    ] as const)
      expect(aging.reduce((sum, bucket) => sum + bucket[field]!, 0)).toBe(
        overdue[field],
      );
    // One case spans four buckets: summing bucket case counts would invent
    // three extra distinct debtors. Each bucket correctly counts the case once.
    expect(aging.map((bucket) => bucket.caseCount)).toEqual([1, 1, 1, 1]);
  });

  it.each([
    ['2024-03-31', '2024-03-01', '2024-02-29'],
    ['2026-11-01', '2026-10-02', '2026-10-01'],
    ['2027-01-01', '2026-12-02', '2026-12-01'],
  ])(
    'uses civil day boundaries across leap years, DST and year rollover: %s',
    (asOf, day30, day31) => {
      const report = buildCollectionReport(
        snapshot([sourceCase(1, [line(day30), line(day31)])], asOf),
      );
      expect(
        report.byCurrency[0].aging.map((bucket) => bucket.outstanding),
      ).toEqual([100, 100, 0, 0]);
    },
  );

  it('keeps unknown past-due balances in their true bucket and currencies separate', () => {
    const report = buildCollectionReport(
      snapshot(
        [
          sourceCase(1, [line('2026-10-02', null, 10)]),
          sourceCase(2, [line('2026-09-02', 100, null)]),
          sourceCase(3, [line('2026-07-04', 100, 20, { outstanding: null })]),
          sourceCase(4, [line(null, 100, 0)]),
          sourceCase(5, [line('2026-10-02', 50, 0)], { currency: 'EUR' }),
          sourceCase(6, [line('2026-10-02', 75, 0)], { currency: null }),
        ],
        '2026-10-03',
      ),
      { currency: '__ALL__' },
    );
    const gbp = report.byCurrency.find((part) => part.currency === 'GBP')!;
    expect(gbp.aging.map((bucket) => bucket.outstanding)).toEqual([
      null,
      null,
      0,
      null,
    ]);
    expect(gbp.aging.map((bucket) => bucket.incompleteRows)).toEqual([
      1, 1, 0, 1,
    ]);
    expect(gbp.aging[0].scheduled).toBeNull();
    expect(gbp.aging[0].paidToDate).toBe(10);
    expect(gbp.overdue).toMatchObject({
      outstanding: null,
      installmentCount: 3,
      incompleteRows: 3,
    });
    expect(
      report.byCurrency.find((part) => part.currency === 'EUR')!.aging[0],
    ).toMatchObject({
      outstanding: 50,
      incompleteRows: 0,
    });
    expect(
      report.byCurrency.find((part) => part.currency === null)!.aging[0],
    ).toMatchObject({
      outstanding: 75,
      incompleteRows: 1,
    });
  });

  it('preserves known subtotals and incomplete markers when a bucket also has unknown amounts', () => {
    const part = buildCollectionReport(
      snapshot([
        sourceCase(1, [
          line('2026-09-10', 120, 20),
          line('2026-09-11', null, 0),
        ]),
      ]),
    ).byCurrency[0];
    expect(part.aging[0]).toMatchObject({
      scheduled: 120,
      outstanding: 100,
      installmentCount: 2,
      incompleteRows: 1,
    });
    expect(part.aging[0].outstanding).toBe(part.overdue.outstanding);
  });
});

describe('Collection report scoped details', () => {
  function data() {
    return snapshot(
      [
        sourceCase(1, [
          line('2026-10-02', 100, 10),
          line('2026-07-01', 200, 20),
          line('2026-09-01', 50, 50),
          line('2026-10-03', 300, 30),
          line('2026-11-01', 400, 40),
          line('2027-04-30', 500, 50),
          line('2027-05-01', 600, 60),
          line(null, 700, 70),
          line(null, 90, 90),
        ]),
        sourceCase(2, [line('2026-09-02', null, 0)]),
      ],
      '2026-10-03',
    );
  }

  it.each([
    ['month', '', 1, 1, 400, 40, 360, '2026-11-01', '2026-11-01'],
    ['overdue', '', 2, 2, 300, 30, 270, '2026-07-01', '2026-10-02'],
    ['overdue', '1_30', 1, 1, 100, 10, 90, '2026-10-02', '2026-10-02'],
    ['overdue', '90_plus', 1, 1, 200, 20, 180, '2026-07-01', '2026-07-01'],
    ['period', '', 1, 2, 900, 90, 810, '2026-11-01', '2027-04-30'],
    ['undated', '', 1, 2, 790, 160, 630, null, null],
  ])(
    'drills into %s/%s using only the matching lines without changing report aggregates',
    (
      detailScope,
      agingBucket,
      total,
      count,
      scheduled,
      paid,
      outstanding,
      first,
      last,
    ) => {
      const before = buildCollectionReport(data());
      const after = buildCollectionReport(data(), { detailScope, agingBucket });
      expect(after).toEqual({ ...before, detail: after.detail });
      expect(after.detail).toMatchObject({
        scope: detailScope,
        agingBucket,
        month: '2026-11',
        total,
        page: 1,
        totalPages: 1,
      });
      expect(after.detail.rows[0]).toMatchObject({
        earliestDueDate: first,
        lastDueDate: last,
        totals: {
          scheduled,
          paidToDate: paid,
          outstanding,
          installmentCount: count,
        },
      });
    },
  );

  it('includes unknown overdue balances in bucket details and returns explicit empty buckets', () => {
    const unknown = buildCollectionReport(data(), {
      detailScope: 'overdue',
      agingBucket: '31_60',
    });
    expect(unknown.detail.total).toBe(1);
    expect(unknown.detail.rows[0].totals).toMatchObject({
      outstanding: null,
      incompleteRows: 1,
      installmentCount: 1,
    });
    const empty = buildCollectionReport(data(), {
      detailScope: 'overdue',
      agingBucket: '61_90',
      page: '999',
    });
    expect(empty.detail).toMatchObject({
      scope: 'overdue',
      agingBucket: '61_90',
      rows: [],
      total: 0,
      page: 1,
      totalPages: 1,
    });
  });

  it('keeps historical month drill-down compatible and confines period scope to the visible range', () => {
    const historical = buildCollectionReport(data(), {
      detailMonth: '2026-09',
    });
    expect(historical.detail).toMatchObject({
      scope: 'month',
      month: '2026-09',
      total: 2,
    });
    expect(
      historical.detail.rows.some((row) => row.totals.outstanding === 0),
    ).toBe(true);
    const pastPeriod = buildCollectionReport(data(), {
      detailScope: 'period',
      startMonth: '2026-05',
      months: '6',
      detailMonth: '2027-05',
    });
    expect(pastPeriod.detail.month).toBe('2027-05');
    expect(pastPeriod.detail.rows[0].totals).toMatchObject({
      installmentCount: 4,
      scheduled: 650,
      paidToDate: 110,
      outstanding: 540,
    });
  });

  it.each(['month', 'overdue', 'period', 'undated'])(
    'paginates %s scope in stable order without changing any top-level aggregate',
    (detailScope) => {
      const dueDate =
        detailScope === 'undated'
          ? null
          : detailScope === 'overdue'
            ? '2026-09-10'
            : '2026-11-10';
      const source = snapshot(
        Array.from({ length: 51 }, (_, index) =>
          sourceCase(index, [line(dueDate, 100 + index, 0)]),
        ),
      );
      const first = buildCollectionReport(source, {
        detailScope,
        pageSize: '25',
      });
      const last = buildCollectionReport(source, {
        detailScope,
        page: '999',
        pageSize: '25',
      });
      expect(first.detail).toMatchObject({ total: 51, page: 1, totalPages: 3 });
      expect(first.detail.rows).toHaveLength(25);
      expect(first.detail.rows[0].totals.outstanding).toBe(150);
      expect(last.detail).toMatchObject({ total: 51, page: 3, totalPages: 3 });
      expect(last.detail.rows).toHaveLength(1);
      expect(last.detail.rows[0].totals.outstanding).toBe(100);
      expect(last).toEqual({ ...first, detail: last.detail });
    },
  );

  it('applies invoice, authorization, project, representative, kind and currency filters before aging and details', () => {
    const selected = sourceCase(
      1,
      [
        line('2026-09-10', 100, 20),
        line('2026-08-01', 900, 0, { paymentKind: 'vat', projectCode: 'KDV' }),
      ],
      {},
      {
        representatives: ['REP-A'],
        invoiceOk: { status: 'matched', values: ['DND'], hasBlank: false },
      },
    );
    const others: PaymentSourceCase[] = [
      {
        ...selected,
        key: 'invoice',
        invoiceOk: { status: 'matched', values: ['GÜL'], hasBlank: false },
      },
      {
        ...selected,
        key: 'authorization',
        authorization: { status: 'matched', codes: ['CODED'], hasBlank: false },
      },
      { ...selected, key: 'representative', representatives: ['REP-B'] },
      {
        ...selected,
        key: 'currency',
        identity: { ...selected.identity, currency: 'EUR' },
      },
      {
        ...selected,
        key: 'project',
        identity: { ...selected.identity, unitCode: 'LJP-A1' },
        installments: [line('2026-09-10', 800, 0, { projectCode: 'LJP-A1' })],
      },
    ];
    const report = buildCollectionReport(snapshot([selected, ...others]), {
      currency: 'GBP',
      paymentKind: 'sale',
      projectGroup: 'LA_JOYA',
      representative: 'REP-A',
      authorizationState: 'blank',
      invoiceOk: 'value:DND',
      detailScope: 'overdue',
      agingBucket: '1_30',
    });
    expect(report.byCurrency[0].aging[0]).toMatchObject({
      outstanding: 80,
      installmentCount: 1,
      caseCount: 1,
    });
    expect(report.detail.total).toBe(1);
    expect(report.detail.rows[0].key).toBe(selected.key);
    expect(report.detail.rows[0].totals.outstanding).toBe(80);
  });
});

describe('Collection report validation and API boundary', () => {
  it.each([
    { startMonth: '2026-13' },
    { startMonth: '2026-1' },
    { startMonth: '1752-12' },
    { startMonth: '9998-08', months: '6' },
    { detailMonth: '9999-01' },
    { detailMonth: '2026-00' },
    { detailScope: 'all' },
    { detailScope: ['overdue'] },
    { agingBucket: ['1_30'], detailScope: 'overdue' },
    { agingBucket: 'unknown', detailScope: 'overdue' },
    { agingBucket: '1_30' },
    { agingBucket: '1_30', detailScope: 'month' },
    { agingBucket: '1_30', detailScope: 'period' },
    { agingBucket: '1_30', detailScope: 'undated' },
    { months: '7' },
    { page: '0' },
    { page: '1.5' },
    { pageSize: '10' },
    { refresh: true },
    { refresh: '1' },
    { basis: 'tracking' },
    { paymentKind: 'invalid' },
    { projectGroup: 'LAJOYA' },
    { authorizationState: 'invalid' },
    { currency: ['GBP', 'TL'] },
    { representative: 'bad\nvalue' },
    { representativeState: 'single' },
    { representativeState: ['multiple'] },
    { representative: 'Ada', representativeState: 'multiple' },
    { representative: 'Ada', representativeState: 'unassigned' },
    { scope: 'actionable' },
  ])(
    'rejects invalid or unsupported query %j before source access',
    async (query) => {
      const read = jest.fn();
      const service = new PaymentCollectionReportService({
        snapshot: read,
      } as unknown as PaymentTrackingSourceService);
      await expect(service.report(query)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(read).not.toHaveBeenCalled();
      expect(() => buildCollectionReport(snapshot([]), query)).toThrow(
        BadRequestException,
      );
    },
  );

  it('accepts bounded 24-month windows and rejects explicit absent currency', () => {
    expect(
      parseCollectionReportQuery({
        startMonth: '9997-01',
        months: '24',
        pageSize: '100',
        refresh: 'true',
      }),
    ).toMatchObject({ months: 24, refresh: true });
    const data = snapshot([sourceCase(1, [line('2026-11-01')])]);
    expect(() => buildCollectionReport(data, { currency: 'EUR' })).toThrow(
      BadRequestException,
    );
    expect(() => buildCollectionReport(data, { currency: '__NULL__' })).toThrow(
      BadRequestException,
    );
  });

  it('reads the shared snapshot once and preserves explicit refresh plus source failures', async () => {
    const read = jest
      .fn()
      .mockResolvedValue(snapshot([sourceCase(1, [line('2026-11-01')])]));
    const service = new PaymentCollectionReportService({
      snapshot: read,
    } as unknown as PaymentTrackingSourceService);
    await expect(service.report()).resolves.toMatchObject({
      basis: 'original',
    });
    expect(read.mock.calls).toEqual([[false]]);
    await service.report({ refresh: 'true' });
    expect(read.mock.calls).toEqual([[false], [true]]);
    const error = new ServiceUnavailableException('source unavailable');
    read.mockRejectedValueOnce(error);
    await expect(service.report()).rejects.toBe(error);
  });

  it('registers only a guarded read endpoint with no-store and forwards exact query', async () => {
    const report = jest.fn().mockResolvedValue({ basis: 'original' });
    const controller = new PaymentCollectionReportController({
      report,
    } as unknown as PaymentCollectionReportService);
    const query = { currency: '__ALL__', paymentKind: 'all' };
    await expect(controller.report(query)).resolves.toEqual({
      basis: 'original',
    });
    expect(report).toHaveBeenCalledWith(query);
    expect(
      Reflect.getMetadata(PATH_METADATA, PaymentCollectionReportController),
    ).toBe('payment-collection-report');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PaymentCollectionReportController),
    ).toEqual([JwtAuthGuard, PaymentTrackingGuard]);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Read decorator metadata without invoking the method.
    expect(Reflect.getMetadata(METHOD_METADATA, controller.report)).toBe(
      RequestMethod.GET,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Read decorator metadata without invoking the method.
    expect(Reflect.getMetadata(HEADERS_METADATA, controller.report)).toEqual([
      { name: 'Cache-Control', value: 'private, no-store' },
    ]);
  });

  it('permits real admin/accounting users and rejects preview or other roles', () => {
    const guard = new PaymentTrackingGuard();
    const context = (user: unknown) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as unknown as ExecutionContext;
    expect(guard.canActivate(context({ role: 'ADMIN' }))).toBe(true);
    expect(guard.canActivate(context({ role: 'ACCOUNTING' }))).toBe(true);
    for (const user of [
      { role: 'PREVIEW' },
      { role: 'SALES' },
      { role: 'ADMIN', originalRole: 'PREVIEW' },
      { role: 'ACCOUNTING', isPreview: true },
    ])
      expect(() => guard.canActivate(context(user))).toThrow(
        ForbiddenException,
      );
    expect(() => guard.canActivate(context(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
