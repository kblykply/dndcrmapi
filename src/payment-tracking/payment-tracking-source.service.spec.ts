import { paymentTrackingCaseKey } from './payment-tracking-source.service';

const identity = {
  customerCode: 'C-7',
  unitCode: 'A-11',
  currency: 'GBP',
};

describe('Payment tracking case identity', () => {
  it('does not depend on money, dates, displayed names, source order or repeated logical references', () => {
    const first = {
      ...identity,
      amount: 100,
      paid: 0,
      dueDate: '2026-08-01',
      customerName: 'Synthetic name',
      logicalRef: 99,
      rowIndex: 1,
    };
    const next = {
      ...identity,
      amount: 200,
      paid: 100,
      dueDate: '2026-09-01',
      customerName: 'Corrected name',
      logicalRef: 100,
      rowIndex: 18,
    };
    expect(paymentTrackingCaseKey(first)).toBe(paymentTrackingCaseKey(next));
  });

  it.each([
    { customerCode: 'c-7' },
    { customerCode: 'C-7 ' },
    { unitCode: 'a-11' },
    { unitCode: 'A-11 ' },
    { currency: 'gbp' },
    { currency: 'GBP ' },
    { currency: 'EUR' },
  ])('keeps different source identities separate: %s', (patch) => {
    expect(paymentTrackingCaseKey({ ...identity, ...patch })).not.toBe(
      paymentTrackingCaseKey(identity),
    );
  });

  it('distinguishes null/empty and prevents concatenated-field delimiter collisions', () => {
    expect(
      paymentTrackingCaseKey({ ...identity, customerCode: null }),
    ).not.toBe(paymentTrackingCaseKey({ ...identity, customerCode: '' }));
    expect(
      paymentTrackingCaseKey({
        ...identity,
        customerCode: 'X|Y',
        unitCode: 'Z',
      }),
    ).not.toBe(
      paymentTrackingCaseKey({
        ...identity,
        customerCode: 'X',
        unitCode: 'Y|Z',
      }),
    );
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentTrackingSourceService } from './payment-tracking-source.service';
import { PaymentTrackingCatalogService } from './payment-tracking-catalog.service';
import {
  LogoDatabaseService,
  assertReadOnlyLogoQuery,
} from '../logo-database/logo-database.service';
import type { PaymentViewMetadata } from './payment-tracking-catalog.service';

const fields = {
  CARIKODU: ['CARİ KOD', 'text'],
  CARIADI: ['CARİ ADI', 'text'],
  DAIRE: ['DAİRE', 'text'],
  DAIREADI: ['DAİRE ADI', 'text'],
  PROJEKODU: ['PROJE KOD', 'text'],
  VADE: ['VADE', 'date'],
  DVZ: ['DVZ', 'text'],
  TOPLAMTUTAR: ['TUTAR', 'number'],
  TOPLAMODENEN: ['ODENEN', 'number'],
} as const;
const attributeFields = {
  CARIKODU: ['CARİ KOD', 'text'],
  DAIRE: ['DAİRE', 'text'],
  DVZ: ['DVZ', 'text'],
  YETKIKODU: ['YETKİ_KODU', 'text'],
  FATURAOK: ['FAT_OK', 'text'],
  SATISTEMSILCISIKODU: ['SE_KODU', 'text'],
  EMLAKCIKODU: ['BROKER', 'text'],
  FATURATARIHI: ['FAT TARİHİ', 'date'],
} as const;
const view: PaymentViewMetadata = {
  database: 'LOGO_DND',
  sourceKind: 'VIEW',
  name: 'L_223_ODEME_PLANI',
  schema: 'dbo',
  qualifiedName: '[LOGO_DND].[dbo].[L_223_ODEME_PLANI]',
  available: true,
  columns: Object.values(fields).map(([name, kind]) => ({ name, kind })),
};
const authorizationView: PaymentViewMetadata = {
  ...view,
  name: 'L_223_FATURA_VADE',
  qualifiedName: '[LOGO_DND].[dbo].[L_223_FATURA_VADE]',
  columns: Object.values(attributeFields).map(([name, kind]) => ({
    name,
    kind,
  })),
};
function authorizationRow(patch: Record<string, unknown> = {}) {
  return {
    RAW_COUNT: 1,
    CARIKODU: 'C-7',
    DAIRE: 'A-11',
    DVZ: 'GBP',
    YETKIKODU: 'AUTH-A',
    FATURAOK: 'DND',
    SATISTEMSILCISIKODU: 'REP-A',
    EMLAKCIKODU: 'BROKER-A',
    FATURATARIHI: new Date('2026-06-01T00:00:00Z'),
    ...patch,
  };
}
function row(patch: Record<string, unknown> = {}) {
  return {
    CARIKODU: 'C-7',
    CARIADI: 'Synthetic customer',
    DAIRE: 'A-11',
    DAIREADI: 'Synthetic unit',
    PROJEKODU: 'P-1',
    PROJEADI: 'Synthetic project',
    FATURATARIHI: new Date('2026-06-01T00:00:00Z'),
    SATISTEMSILCISIKODU: 'REP-A',
    EMLAKCIKODU: 'BROKER-A',
    VADE: new Date('2026-09-01T00:00:00Z'),
    DVZ: 'GBP',
    TOPLAMTUTAR: 100,
    TOPLAMODENEN: 20,
    ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function flushMicrotasks() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}
function databaseUnavailable() {
  return new ServiceUnavailableException({
    code: 'LOGO_DB_UNAVAILABLE',
    message: 'Synthetic failure',
  });
}
function auditRow(
  patch: Record<string, unknown> = {},
  reviews: unknown[] = [],
) {
  return {
    summary: JSON.stringify({
      paymentRows: 25_000,
      multipleStockLines: 0,
      multipleReceiptMatches: 0,
      cancelledInvoices: 0,
      cancelledStockLines: 0,
      invalidSigns: 0,
      invalidInvoiceLinks: 0,
      unknownCurrencies: 0,
      nullAmounts: 0,
      missingIdentities: 0,
      excludedVatRows: reviews.length,
      ...patch,
    }),
    reviews: JSON.stringify(reviews),
  };
}

describe('PaymentTrackingSourceService', () => {
  let query: jest.Mock;
  let authorizationQuery: jest.Mock;
  let auditQuery: jest.Mock;
  let requireView: jest.Mock;
  let service: PaymentTrackingSourceService;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T09:00:00Z'));
    query = jest.fn().mockResolvedValue([row()]);
    authorizationQuery = jest.fn().mockResolvedValue([authorizationRow()]);
    auditQuery = jest.fn().mockResolvedValue([auditRow()]);
    requireView = jest
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(name === view.name ? view : authorizationView),
      );
    service = new PaymentTrackingSourceService(
      {
        query: (statement: string) =>
          (statement.startsWith('WITH PaymentAuditEligible')
            ? auditQuery(statement)
            : statement.includes('FROM [LOGO_DND].[dbo].[L_223_FATURA_VADE]')
              ? authorizationQuery(statement)
              : query(statement)) as Promise<Record<string, unknown>[]>,
      } as unknown as LogoDatabaseService,
      { requireView } as unknown as PaymentTrackingCatalogService,
    );
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('shares the audit with the cached snapshot instead of querying per reader', async () => {
    const first = await service.snapshot();
    expect(first.audit).toMatchObject({
      status: 'verified',
      financialChecks: 'passed',
      reviewCaseCount: 0,
      excludedVatRows: 0,
    });
    await Promise.all([service.snapshot(), service.snapshot()]);
    expect(auditQuery).toHaveBeenCalledTimes(1);
  });

  it.each([
    'multipleStockLines',
    'multipleReceiptMatches',
    'cancelledInvoices',
    'cancelledStockLines',
    'invalidSigns',
    'invalidInvoiceLinks',
    'unknownCurrencies',
    'nullAmounts',
    'missingIdentities',
  ])(
    'rejects new source data and clears the old cache on %s',
    async (field) => {
      await service.snapshot();
      auditQuery.mockResolvedValue([auditRow({ [field]: 1 })]);
      await expect(service.snapshot(true)).rejects.toMatchObject({
        response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID' },
      });
      await expect(service.snapshot()).rejects.toMatchObject({
        response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID' },
      });
    },
  );

  it('keeps only the previous verified snapshot stale when the audit times out', async () => {
    const first = await service.snapshot();
    query.mockResolvedValue([row({ TOPLAMTUTAR: 900 })]);
    auditQuery.mockRejectedValue(databaseUnavailable());
    await expect(service.snapshot(true)).rejects.toMatchObject({
      response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_UNAVAILABLE' },
    });
    const retained = await service.snapshot();
    expect(retained.freshness?.status).toBe('stale');
    expect(retained.cases[0].amount).toBe(first.cases[0].amount);
    jest.advanceTimersByTime(300_000);
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_UNAVAILABLE' },
    });
  });

  it('does not label more view rows than audited components as verified', async () => {
    auditQuery.mockResolvedValue([auditRow({ paymentRows: 0 })]);
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID' },
    });
  });

  it('attaches excluded VAT review to the exact related case without adding it to debt', async () => {
    auditQuery.mockResolvedValue([
      auditRow({}, [
        {
          customerCode: 'C-OLD',
          unitCode: 'A-11',
          currency: 'EUR',
          selectedCustomerCode: 'C-7',
          selectedUnitCode: 'A-11',
          selectedCurrency: 'GBP',
          excludedOutstanding: 42.75,
          hasCustomerChange: 1,
          hasReturnLink: 1,
        },
      ]),
    ]);
    query.mockResolvedValue([
      row(),
      row({ CARIKODU: 'C-OTHER', DAIRE: 'A-12', TOPLAMTUTAR: 200 }),
    ]);
    const result = await service.snapshot();
    const related = result.cases.find(
      (item) => item.identity.customerCode === 'C-7',
    )!;
    const unrelated = result.cases.find(
      (item) => item.identity.customerCode === 'C-OTHER',
    )!;
    expect(related.outstanding).toBe(80);
    expect(related.sourceReview).toEqual({
      status: 'review_required',
      vat: [
        {
          currency: 'EUR',
          excludedRows: 1,
          excludedOutstanding: 42.75,
          hasReturnLink: true,
          hasCustomerChange: true,
        },
      ],
    });
    expect(unrelated.sourceReview).toBeNull();
    expect(result.audit).toMatchObject({
      status: 'review_required',
      reviewCaseCount: 1,
      excludedVatRows: 1,
    });
  });

  it('prewarms without blocking startup and shares the in-flight read with users', async () => {
    const finance = deferred<ReturnType<typeof row>[]>();
    query.mockReturnValueOnce(finance.promise);
    expect(service.onApplicationBootstrap()).toBeUndefined();
    await flushMicrotasks();
    expect(query).toHaveBeenCalledTimes(1);
    const regular = service.snapshot();
    const forced = service.snapshot(true);
    service.onApplicationBootstrap();
    await flushMicrotasks();
    expect(query).toHaveBeenCalledTimes(1);
    finance.resolve([row()]);
    const results = await Promise.all([regular, forced]);
    expect(
      results.every((result) => result.freshness?.status === 'fresh'),
    ).toBe(true);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('refreshes idle snapshots every 120 seconds without creating user activity', async () => {
    const timeout = jest.spyOn(global, 'setTimeout');
    service.onApplicationBootstrap();
    await flushMicrotasks();
    const timer = timeout.mock.results.at(-1)?.value as ReturnType<
      typeof setTimeout
    >;
    expect(timer.hasRef()).toBe(false);
    await jest.advanceTimersByTimeAsync(119_999);
    expect(query).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(119_999);
    expect(query).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledTimes(3);
    timeout.mockRestore();
  });

  it('uses 30-second refreshes for recent users and returns to idle cadence after two minutes', async () => {
    service.onApplicationBootstrap();
    await flushMicrotasks();
    await service.snapshot();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(query).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(89_999);
    expect(query).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledTimes(5);
  });

  it('does not loop or reject startup when prewarming fails and retries at the idle cadence', async () => {
    query.mockRejectedValueOnce(databaseUnavailable());
    expect(service.onApplicationBootstrap()).toBeUndefined();
    await flushMicrotasks();
    expect(query).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(119_999);
    expect(query).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect((await service.snapshot()).freshness?.status).toBe('fresh');
  });

  it('coalesces a scheduled refresh with forced readers while cached readers stay responsive', async () => {
    service.onApplicationBootstrap();
    await flushMicrotasks();
    await service.snapshot();
    const finance = deferred<ReturnType<typeof row>[]>();
    query.mockReturnValueOnce(finance.promise);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(2);
    expect((await service.snapshot()).freshness?.status).toBe('refreshing');
    const forced = service.snapshot(true);
    const rejection = expect(forced).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    finance.reject(databaseUnavailable());
    await rejection;
    expect(query).toHaveBeenCalledTimes(2);
    expect((await service.snapshot()).freshness?.status).toBe('stale');
    await jest.advanceTimersByTimeAsync(29_999);
    expect(query).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('clears a scheduled timer at shutdown and never schedules after a late read completes', async () => {
    service.onApplicationBootstrap();
    await flushMicrotasks();
    expect(jest.getTimerCount()).toBe(1);
    const finance = deferred<ReturnType<typeof row>[]>();
    query.mockReturnValueOnce(finance.promise);
    const pending = service.snapshot(true);
    await flushMicrotasks();
    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    finance.resolve([row()]);
    await pending;
    service.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(600_000);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps the hard age limit when repeated scheduled reads fail', async () => {
    service.onApplicationBootstrap();
    await flushMicrotasks();
    query.mockRejectedValue(databaseUnavailable());
    await jest.advanceTimersByTimeAsync(300_000);
    expect(query).toHaveBeenCalledTimes(3);
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('does not reconnect for an optional-read retry after shutdown', async () => {
    const authorization = deferred<ReturnType<typeof authorizationRow>[]>();
    query.mockRejectedValue(databaseUnavailable());
    authorizationQuery.mockReturnValueOnce(authorization.promise);
    service.onApplicationBootstrap();
    await flushMicrotasks();
    expect(query).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    authorization.reject(databaseUnavailable());
    await flushMicrotasks();
    await jest.advanceTimersByTimeAsync(600_000);
    expect(query).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reads only explicit columns from the verified view with a hard overflow sentinel', async () => {
    const result = await service.snapshot();
    expect(requireView).toHaveBeenCalledWith('L_223_ODEME_PLANI');
    expect(query).toHaveBeenCalledTimes(1);
    const [statement] = query.mock.calls[0] as [string];
    expect(statement).toContain('SELECT TOP (25001)');
    expect(statement).toContain('FROM [LOGO_DND].[dbo].[L_223_ODEME_PLANI]');
    expect(statement).not.toMatch(
      /LOGICALREF|SELECT \*|LG_223_|OFFSET|ORDER BY/i,
    );
    expect(() => assertReadOnlyLogoQuery(statement)).not.toThrow();
    for (const [name] of Object.values(fields))
      expect(statement).toContain(`[v].[${name}]`);
    expect(result).toMatchObject({
      view: view.name,
      asOf: '2026-09-29',
      recordCount: 1,
    });
    expect(result.cases[0]).toMatchObject({
      key: paymentTrackingCaseKey(identity),
      identity,
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
      representatives: ['REP-A'],
      brokers: ['BROKER-A'],
      invoiceDates: ['2026-06-01'],
      authorization: { status: 'matched', codes: ['AUTH-A'], hasBlank: false },
      canTrack: true,
      trackingIssue: null,
    });
  });

  it('keeps every duplicate source row and all name/project variants without mixing currencies', async () => {
    query.mockResolvedValue([
      row(),
      row(),
      row({
        CARIADI: 'Second name',
        DAIREADI: 'Second unit',
        PROJEKODU: 'P-2',
        PROJEADI: 'Second project',
      }),
      row({ DVZ: 'EUR' }),
      row({ DVZ: 'gbp' }),
      row({ DVZ: 'GBP ' }),
      row({ CARIKODU: 'c-7' }),
    ]);
    const result = await service.snapshot();
    expect(result.recordCount).toBe(7);
    expect(result.cases).toHaveLength(5);
    const group = result.cases.find(
      (entry) => entry.key === paymentTrackingCaseKey(identity),
    )!;
    expect(group).toMatchObject({
      installmentCount: 3,
      amount: 300,
      paid: 60,
      outstanding: 240,
    });
    expect(group.customerNames).toEqual(['Second name', 'Synthetic customer']);
    expect(group.unitNames).toEqual(['Second unit', 'Synthetic unit']);
    expect(group.projects).toHaveLength(2);
    expect(group.installments).toHaveLength(3);
    expect(group.installments.map((entry) => entry.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(
      result.cases.reduce((total, entry) => total + entry.installmentCount, 0),
    ).toBe(7);
  });

  it('uses original due dates and positive remaining balances for aging, today and next due', async () => {
    query.mockResolvedValue([
      row({
        VADE: new Date('2026-10-05T00:00:00Z'),
        TOPLAMTUTAR: 50,
        TOPLAMODENEN: 0,
      }),
      row({ VADE: new Date('2026-08-01T00:00:00Z'), TOPLAMODENEN: 120 }),
      row({ VADE: new Date('2026-09-29T14:00:00Z'), TOPLAMODENEN: 60 }),
      row(),
      row({ VADE: null, TOPLAMTUTAR: 70, TOPLAMODENEN: 0 }),
    ]);
    const group = (await service.snapshot()).cases[0];
    expect(group).toMatchObject({
      amount: 420,
      paid: 200,
      outstanding: 240,
      overdueAmount: 80,
      overdueCount: 1,
      overdueDays: 28,
      dueTodayAmount: 40,
      oldestDueDate: '2026-09-01',
      nextDueDate: '2026-09-29',
      incompleteRows: 1,
    });
    expect(group.installments.map((item) => item.status)).toEqual([
      'paid',
      'overdue',
      'today',
      'upcoming',
      'unknown',
    ]);
    expect(group.installments[0].overdueDays).toBe(0);
    expect(group.installments.at(-1)).toMatchObject({
      dueDate: null,
      outstanding: 70,
      status: 'unknown',
    });
  });

  it('matches SQL known partial sums while completely missing money remains unknown', async () => {
    query.mockResolvedValue([row({ TOPLAMTUTAR: null }), row()]);
    const partial = (await service.snapshot()).cases[0];
    expect(partial).toMatchObject({
      amount: 100,
      paid: 40,
      outstanding: 80,
      overdueAmount: 80,
      incompleteRows: 1,
    });
    expect(partial.installments[0]).toMatchObject({
      amount: null,
      paid: 20,
      outstanding: null,
      status: 'unknown',
    });
    query.mockResolvedValue([row({ TOPLAMTUTAR: null, TOPLAMODENEN: null })]);
    const missing = (await service.snapshot(true)).cases[0];
    expect(missing).toMatchObject({
      amount: null,
      paid: null,
      outstanding: null,
      overdueAmount: null,
      dueTodayAmount: null,
      incompleteRows: 1,
      oldestDueDate: null,
    });
  });

  it('retains invalid identities as read-only groups rather than hiding other cases', async () => {
    query.mockResolvedValue([
      row(),
      row({ CARIKODU: '' }),
      row({ DAIRE: null }),
      row({ CARIKODU: null }),
      row({ DAIRE: ' ' }),
      row({ DVZ: null }),
    ]);
    const result = await service.snapshot();
    expect(result.recordCount).toBe(6);
    expect(result.cases).toHaveLength(6);
    expect(result.cases.filter((entry) => entry.canTrack)).toHaveLength(1);
    for (const group of result.cases.filter((entry) => !entry.canTrack)) {
      expect(group.trackingIssue).toBeTruthy();
      expect(group.installmentCount).toBe(1);
      expect(group.installments).toHaveLength(1);
    }
  });

  it.each([null, '2026-02-31', 'not-a-date', 123, new Date(NaN)])(
    'handles missing vs malformed source dates: %s',
    async (date) => {
      query.mockResolvedValue([row({ VADE: date })]);
      if (date === null) {
        expect((await service.snapshot()).cases[0]).toMatchObject({
          incompleteRows: 1,
          oldestDueDate: null,
          overdueAmount: null,
        });
      } else
        await expect(service.snapshot()).rejects.toMatchObject({
          response: { code: 'PAYMENT_TRACKING_SOURCE_DATE_INVALID' },
        });
    },
  );

  it.each(['', ' ', '100', NaN, Infinity, false])(
    'rejects malformed money without coercing it into a known value: %s',
    async (amount) => {
      query.mockResolvedValue([row({ TOPLAMTUTAR: amount })]);
      await expect(service.snapshot()).rejects.toMatchObject({
        response: { code: 'PAYMENT_TRACKING_SOURCE_AMOUNT_INVALID' },
      });
    },
  );

  it('rejects 25001 rows instead of silently truncating the portfolio', async () => {
    query.mockResolvedValue(Array(25001).fill(row()));
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'PAYMENT_TRACKING_SOURCE_LIMIT_EXCEEDED' },
    });
    query.mockResolvedValue([row()]);
    expect((await service.snapshot()).recordCount).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('accepts the inclusive 25000-row bound and preserves duplicate installments', async () => {
    query.mockResolvedValue(Array(25000).fill(row()));
    const result = await service.snapshot();
    expect(result.recordCount).toBe(25000);
    expect(result.cases[0].installments).toHaveLength(25000);
    expect(result.cases[0].outstanding).toBe(2000000);
  });

  it.each([
    { available: false },
    { sourceKind: 'TABLE' },
    { database: 'Wrong_Database' },
    { schema: 'other' },
    { name: 'CRMODEMEPLANI' },
    { qualifiedName: '[LOGO_DND].[dbo].[NotAllowed]' },
    { columns: view.columns.filter((column) => column.name !== 'VADE') },
    {
      columns: view.columns.filter((column) => column.name !== 'CARİ KOD'),
    },
    {
      columns: view.columns.filter((column) => column.name !== 'DAİRE'),
    },
    { columns: view.columns.filter((column) => column.name !== 'DVZ') },
    {
      columns: view.columns.map((column) =>
        column.name === 'TUTAR' ? { ...column, kind: 'text' } : column,
      ),
    },
  ])(
    'rejects changed/unverified source metadata before reading data: %s',
    async (patch) => {
      requireView.mockResolvedValue({ ...view, ...patch });
      await expect(service.snapshot()).rejects.toMatchObject({
        response: { code: 'PAYMENT_TRACKING_SOURCE_SCHEMA_CHANGED' },
      });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('propagates forced source failures while retaining a labeled stale read-only portfolio', async () => {
    await service.snapshot();
    query.mockRejectedValueOnce(
      new ServiceUnavailableException('Synthetic source unavailable'),
    );
    await expect(service.snapshot(true)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const retained = await service.snapshot();
    expect(retained.recordCount).toBe(1);
    expect(retained.freshness).toEqual({
      status: 'stale',
      retryAfterMs: 15000,
      maxAgeSeconds: 300,
    });
    query.mockResolvedValueOnce([]);
    expect((await service.snapshot(true)).recordCount).toBe(0);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('keeps a 30-second fresh cache, refreshes stale reads in the background and isolates callers', async () => {
    const first = await service.snapshot();
    first.cases[0].installments[0].paid = 999;
    first.cases.length = 0;
    jest.setSystemTime(new Date('2026-09-29T09:00:29.999Z'));
    const cached = await service.snapshot();
    expect(cached.cases).toHaveLength(1);
    expect(cached.cases[0].installments[0].paid).toBe(20);
    expect(query).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-09-29T09:00:30.000Z'));
    expect((await service.snapshot()).freshness?.status).toBe('refreshing');
    await service.snapshot(true);
    expect(query).toHaveBeenCalledTimes(2);
    await service.snapshot(true);
    expect(query).toHaveBeenCalledTimes(3);
    expect(requireView).toHaveBeenCalledTimes(6);
    expect(authorizationQuery).toHaveBeenCalledTimes(3);
  });

  it('shares one in-flight read across simultaneous normal and forced requests', async () => {
    const gate = deferred<ReturnType<typeof row>[]>();
    query.mockReturnValue(gate.promise);
    const reads = [
      service.snapshot(),
      service.snapshot(),
      service.snapshot(true),
    ];
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);
    expect(requireView).toHaveBeenCalledTimes(2);
    gate.resolve([row()]);
    const results = await Promise.all(reads);
    expect(results.map((result) => result.recordCount)).toEqual([1, 1, 1]);
    results[0].cases.length = 0;
    expect(results[1].cases).toHaveLength(1);
  });

  it('refreshes aging at Famagusta midnight even if the cache TTL has not expired', async () => {
    jest.setSystemTime(new Date('2026-09-28T20:59:59Z'));
    query.mockResolvedValue([row({ VADE: new Date('2026-09-28T00:00:00Z') })]);
    const before = await service.snapshot();
    expect(before.asOf).toBe('2026-09-28');
    expect(before.cases[0].installments[0].status).toBe('today');
    jest.setSystemTime(new Date('2026-09-28T21:00:00Z'));
    const after = await service.snapshot();
    expect(after.asOf).toBe('2026-09-29');
    expect(after.cases[0].installments[0]).toMatchObject({
      status: 'overdue',
      overdueDays: 1,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reads invoice attributes separately without joining or summing financial amounts', async () => {
    const result = await service.snapshot();
    expect(requireView).toHaveBeenCalledWith('L_223_FATURA_VADE');
    expect(authorizationQuery).toHaveBeenCalledTimes(1);
    const [statement] = authorizationQuery.mock.calls[0] as [string];
    expect(statement).toContain('SELECT TOP (25001)');
    expect(statement).toContain('FROM [LOGO_DND].[dbo].[L_223_FATURA_VADE]');
    expect(statement).not.toMatch(
      /JOIN|LOGICALREF|TOPLAMTUTAR|TOPLAMODENEN|CARIADI|SELECT \*|LG_223_|OFFSET|ORDER BY/i,
    );
    for (const [name] of Object.values(attributeFields))
      expect(statement).toContain(`[v].[${name}]`);
    expect(() => assertReadOnlyLogoQuery(statement)).not.toThrow();
    expect(result.authorizationSource).toEqual({
      view: 'L_223_FATURA_VADE',
      status: 'available',
      matchedCases: 1,
      unmatchedCases: 0,
      multipleCodeCases: 0,
      message: null,
    });
  });

  it('keeps all exact authorization variants and blank membership without multiplying installments or money', async () => {
    query.mockResolvedValue([row(), row()]);
    authorizationQuery.mockResolvedValue([
      authorizationRow(),
      authorizationRow(),
      authorizationRow({ YETKIKODU: 'auth-a' }),
      authorizationRow({ YETKIKODU: ' AUTH-A ' }),
      authorizationRow({ YETKIKODU: null }),
      authorizationRow({ YETKIKODU: '' }),
      authorizationRow({ YETKIKODU: '  ' }),
    ]);
    const result = await service.snapshot();
    expect(result.recordCount).toBe(2);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({
      key: paymentTrackingCaseKey(identity),
      amount: 200,
      paid: 40,
      outstanding: 160,
      overdueAmount: 160,
      installmentCount: 2,
      incompleteRows: 0,
      canTrack: true,
      authorization: {
        status: 'matched',
        codes: [' AUTH-A ', 'AUTH-A', 'auth-a'],
        hasBlank: true,
      },
    });
    expect(result.cases[0].installments).toHaveLength(2);
    expect(result.authorizationSource.multipleCodeCases).toBe(1);
  });

  it('preserves exact invoice special codes and blank membership without changing the financial case', async () => {
    const before = await service.snapshot();
    authorizationQuery.mockResolvedValue(
      ['DND', 'DND', 'dnd', 'DND ', ' GÜL ', 'KOZANSOY', null, '', '  '].map(
        (FATURAOK) => authorizationRow({ FATURAOK }),
      ),
    );
    const after = await service.snapshot(true);
    expect(after.cases[0].invoiceOk).toEqual({
      status: 'matched',
      values: [' GÜL ', 'DND', 'DND ', 'KOZANSOY', 'dnd'],
      hasBlank: true,
    });
    expect(after.cases[0]).toEqual({
      ...before.cases[0],
      invoiceOk: after.cases[0].invoiceOk,
    });
    expect(after.recordCount).toBe(before.recordCount);
    expect(authorizationQuery).toHaveBeenCalledTimes(2);
  });

  it.each([null, '', '  '])(
    'distinguishes a matched blank invoice code from an unmatched source: %p',
    async (FATURAOK) => {
      query.mockResolvedValue([row(), row({ DVZ: 'EUR' })]);
      authorizationQuery.mockResolvedValue([authorizationRow({ FATURAOK })]);
      const result = await service.snapshot();
      expect(
        result.cases.find((item) => item.identity.currency === 'GBP')
          ?.invoiceOk,
      ).toEqual({ status: 'matched', values: [], hasBlank: true });
      expect(
        result.cases.find((item) => item.identity.currency === 'EUR')
          ?.invoiceOk,
      ).toEqual({ status: 'unmatched', values: [], hasBlank: false });
    },
  );

  it.each([123, false, {}, []])(
    'discards malformed invoice codes without returning partial attributes: %p',
    async (FATURAOK) => {
      authorizationQuery.mockResolvedValue([
        authorizationRow(),
        authorizationRow({ FATURAOK }),
      ]);
      const result = await service.snapshot();
      expect(result.cases[0]).toMatchObject({
        outstanding: 80,
        invoiceOk: { status: 'unavailable', values: [], hasBlank: false },
        authorization: { status: 'unavailable', codes: [], hasBlank: false },
      });
    },
  );

  it('clears cached invoice codes on metadata failure and recovers from the current source', async () => {
    const first = await service.snapshot();
    first.cases[0].invoiceOk!.values.push('CALLER-MUTATION');
    expect((await service.snapshot()).cases[0].invoiceOk!.values).toEqual([
      'DND',
    ]);
    authorizationQuery.mockRejectedValueOnce(databaseUnavailable());
    const unavailable = await service.snapshot(true);
    expect(unavailable.cases[0].invoiceOk).toEqual({
      status: 'unavailable',
      values: [],
      hasBlank: false,
    });
    expect(unavailable.cases[0].outstanding).toBe(80);
    authorizationQuery.mockResolvedValue([
      authorizationRow({ FATURAOK: 'GÜL' }),
    ]);
    const recovered = await service.snapshot(true);
    expect(recovered.cases[0].invoiceOk).toEqual({
      status: 'matched',
      values: ['GÜL'],
      hasBlank: false,
    });
  });

  it.each([
    { CARIKODU: 'c-7' },
    { CARIKODU: 'C-7 ' },
    { CARIKODU: null },
    { DAIRE: 'a-11' },
    { DAIRE: 'A-11 ' },
    { DVZ: 'gbp' },
    { DVZ: 'GBP ' },
    { DVZ: 'EUR' },
  ])(
    'does not attach authorization from a different exact identity: %s',
    async (patch) => {
      authorizationQuery.mockResolvedValue([authorizationRow(patch)]);
      const result = await service.snapshot();
      expect(result.cases[0].authorization).toEqual({
        status: 'unmatched',
        codes: [],
        hasBlank: false,
      });
      expect(result.cases[0].invoiceOk).toEqual({
        status: 'unmatched',
        values: [],
        hasBlank: false,
      });
      expect(result.authorizationSource).toMatchObject({
        status: 'available',
        matchedCases: 0,
        unmatchedCases: 1,
        multipleCodeCases: 0,
      });
      expect(result.cases[0].outstanding).toBe(80);
    },
  );

  it('distinguishes matched blank authorization from an unmatched identity', async () => {
    query.mockResolvedValue([row(), row({ DVZ: 'EUR' })]);
    authorizationQuery.mockResolvedValue([
      authorizationRow({ YETKIKODU: null }),
    ]);
    const result = await service.snapshot();
    expect(
      result.cases.find((item) => item.identity.currency === 'GBP')
        ?.authorization,
    ).toEqual({
      status: 'matched',
      codes: [],
      hasBlank: true,
    });
    expect(
      result.cases.find((item) => item.identity.currency === 'EUR')
        ?.authorization,
    ).toEqual({
      status: 'unmatched',
      codes: [],
      hasBlank: false,
    });
    expect(result.authorizationSource).toMatchObject({
      matchedCases: 1,
      unmatchedCases: 1,
    });
  });

  it('treats an empty authorization source as available with unmatched cases', async () => {
    authorizationQuery.mockResolvedValue([]);
    const result = await service.snapshot();
    expect(result.authorizationSource).toMatchObject({
      status: 'available',
      unmatchedCases: 1,
    });
    expect(result.cases[0].authorization.status).toBe('unmatched');
  });

  it('preserves representative, broker and invoice date sets independently of case identity and financial completeness', async () => {
    authorizationQuery.mockResolvedValue([
      authorizationRow(),
      authorizationRow({
        SATISTEMSILCISIKODU: 'rep-a',
        EMLAKCIKODU: ' BROKER-A ',
        FATURATARIHI: '2026-06-15',
      }),
      authorizationRow({
        SATISTEMSILCISIKODU: 'REP-A ',
        EMLAKCIKODU: 'BROKER-A',
        FATURATARIHI: '2026-06-15T14:00:00Z',
      }),
      authorizationRow({
        SATISTEMSILCISIKODU: null,
        EMLAKCIKODU: '  ',
        FATURATARIHI: null,
      }),
    ]);
    query.mockResolvedValue(Array(4).fill(row()));
    const result = await service.snapshot();
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({
      key: paymentTrackingCaseKey(identity),
      representatives: ['REP-A', 'REP-A ', 'rep-a'],
      brokers: [' BROKER-A ', 'BROKER-A'],
      invoiceDates: ['2026-06-01', '2026-06-15'],
      incompleteRows: 0,
      installmentCount: 4,
      outstanding: 320,
      oldestDueDate: '2026-09-01',
    });
    authorizationQuery.mockResolvedValue([
      authorizationRow({
        SATISTEMSILCISIKODU: null,
        EMLAKCIKODU: '',
        FATURATARIHI: null,
      }),
    ]);
    const refreshed = (await service.snapshot(true)).cases[0];
    expect(refreshed).toMatchObject({
      key: result.cases[0].key,
      representatives: [],
      brokers: [],
      invoiceDates: [],
      incompleteRows: 0,
    });
  });

  it.each(['2026-02-31', 'not-a-date', 123, new Date(NaN)])(
    'marks malformed invoice metadata unavailable while keeping plan amounts: %s',
    async (date) => {
      authorizationQuery.mockResolvedValue([
        authorizationRow({ FATURATARIHI: date }),
      ]);
      const result = await service.snapshot();
      expect(result.authorizationSource.status).toBe('unavailable');
      expect(result.cases[0].outstanding).toBe(80);
      expect(result.cases[0].invoiceDates).toEqual([]);
    },
  );

  it.each([
    { available: false },
    { sourceKind: 'TABLE' },
    { database: 'Wrong_Database' },
    { schema: 'other' },
    { name: 'L_223_FATURA_VADEBAKIYELI' },
    { qualifiedName: '[LOGO_DND].[dbo].[NotAllowed]' },
    {
      columns: authorizationView.columns.filter(
        (column) => column.name !== 'YETKİ_KODU',
      ),
    },
    {
      columns: authorizationView.columns.map((column) =>
        column.name === 'YETKİ_KODU' ? { ...column, kind: 'number' } : column,
      ),
    },
    {
      columns: authorizationView.columns.filter(
        (column) => column.name !== 'FAT_OK',
      ),
    },
    {
      columns: authorizationView.columns.map((column) =>
        column.name === 'FAT_OK' ? { ...column, kind: 'number' } : column,
      ),
    },
  ])(
    'isolates changed authorization metadata without querying another source: %s',
    async (patch) => {
      requireView.mockImplementation((name: string) =>
        Promise.resolve(
          name === view.name ? view : { ...authorizationView, ...patch },
        ),
      );
      const result = await service.snapshot();
      expect(authorizationQuery).not.toHaveBeenCalled();
      expect(result.authorizationSource).toMatchObject({
        status: 'unavailable',
        matchedCases: 0,
        unmatchedCases: 0,
        multipleCodeCases: 0,
      });
      expect(result.authorizationSource.message).toBeTruthy();
      expect(result.cases[0]).toMatchObject({
        outstanding: 80,
        canTrack: true,
        authorization: { status: 'unavailable', codes: [], hasBlank: false },
        invoiceOk: { status: 'unavailable', values: [], hasBlank: false },
      });
    },
  );

  it('does not misrepresent partial authorization data after a row limit or malformed code', async () => {
    authorizationQuery.mockResolvedValue(Array(25001).fill(authorizationRow()));
    const overflow = await service.snapshot();
    expect(overflow.authorizationSource.status).toBe('unavailable');
    expect(overflow.cases[0].authorization.codes).toEqual([]);
    authorizationQuery.mockResolvedValue([
      authorizationRow(),
      authorizationRow({ YETKIKODU: 123 }),
    ]);
    const malformed = await service.snapshot(true);
    expect(malformed.authorizationSource.status).toBe('unavailable');
    expect(malformed.cases[0].authorization.codes).toEqual([]);
    expect(malformed.cases[0].outstanding).toBe(80);
    expect(malformed.cases[0].canTrack).toBe(true);
  });

  it('accepts exactly 25000 authorization rows while preserving the original financial row count', async () => {
    authorizationQuery.mockResolvedValue(Array(25000).fill(authorizationRow()));
    const result = await service.snapshot();
    expect(result.authorizationSource.status).toBe('available');
    expect(result.recordCount).toBe(1);
    expect(result.cases[0].installmentCount).toBe(1);
    expect(result.cases[0].outstanding).toBe(80);
    expect(result.cases[0].authorization.codes).toEqual(['AUTH-A']);
  });

  it('revalidates authorization on force, clears stale codes on errors and recovers without hiding financial data', async () => {
    const first = await service.snapshot();
    first.cases[0].authorization.codes.push('CALLER-MUTATION');
    expect((await service.snapshot()).cases[0].authorization.codes).toEqual([
      'AUTH-A',
    ]);
    authorizationQuery.mockRejectedValueOnce(
      new Error('Synthetic sensitive timeout detail'),
    );
    const failed = await service.snapshot(true);
    expect(failed.authorizationSource.status).toBe('unavailable');
    expect(failed.authorizationSource.message).not.toContain('sensitive');
    expect(failed.cases[0]).toMatchObject({
      outstanding: 80,
      canTrack: true,
      authorization: { codes: [] },
    });
    authorizationQuery.mockResolvedValue([
      authorizationRow({ YETKIKODU: 'AUTH-B' }),
    ]);
    const recovered = await service.snapshot(true);
    expect(recovered.authorizationSource.status).toBe('available');
    expect(recovered.cases[0].authorization.codes).toEqual(['AUTH-B']);
    expect(recovered.cases[0].key).toBe(first.cases[0].key);
  });

  it('keeps the financial case available if authorization runtime view verification fails', async () => {
    requireView.mockImplementation((name: string) =>
      name === view.name
        ? Promise.resolve(view)
        : Promise.reject(new ServiceUnavailableException('Unavailable view')),
    );
    const result = await service.snapshot();
    expect(result.authorizationSource.status).toBe('unavailable');
    expect(result.cases[0].outstanding).toBe(80);
    expect(authorizationQuery).not.toHaveBeenCalled();
  });

  it('starts both independent verified source reads before either data query finishes', async () => {
    const finance = deferred<ReturnType<typeof row>[]>();
    const authorization = deferred<ReturnType<typeof authorizationRow>[]>();
    query.mockReturnValue(finance.promise);
    authorizationQuery.mockReturnValue(authorization.promise);
    const pending = service.snapshot();
    await flushMicrotasks();
    expect(requireView).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(1);
    expect(authorizationQuery).toHaveBeenCalledTimes(1);
    let completed = false;
    void pending.then(() => {
      completed = true;
    });
    finance.resolve([row()]);
    await flushMicrotasks();
    expect(completed).toBe(false);
    authorization.resolve([authorizationRow()]);
    const result = await pending;
    expect(result.recordCount).toBe(1);
    expect(result.cases[0].authorization.codes).toEqual(['AUTH-A']);
    expect(result.freshness).toEqual({
      status: 'fresh',
      retryAfterMs: null,
      maxAgeSeconds: 300,
    });
  });

  it('retries finance once only after a concurrent optional failure has settled', async () => {
    const authorization = deferred<ReturnType<typeof authorizationRow>[]>();
    authorizationQuery.mockReturnValueOnce(authorization.promise);
    query
      .mockRejectedValueOnce(databaseUnavailable())
      .mockResolvedValueOnce([row()]);
    const pending = service.snapshot();
    await flushMicrotasks();
    expect(query).toHaveBeenCalledTimes(1);
    authorization.reject(databaseUnavailable());
    const result = await pending;
    expect(query).toHaveBeenCalledTimes(2);
    expect(authorizationQuery).toHaveBeenCalledTimes(1);
    expect(
      requireView.mock.calls.filter(([name]) => name === view.name),
    ).toHaveLength(2);
    expect(result.cases[0].outstanding).toBe(80);
    expect(result.authorizationSource.status).toBe('unavailable');
  });

  it('stops after one finance retry and never converts a failed retry into an empty portfolio', async () => {
    query.mockRejectedValue(databaseUnavailable());
    authorizationQuery.mockRejectedValue(databaseUnavailable());
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(authorizationQuery).toHaveBeenCalledTimes(1);
  });

  it('does not retry finance database errors when the independent authorization read succeeded', async () => {
    query.mockRejectedValue(databaseUnavailable());
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      records: Array(25001).fill(row()),
      code: 'PAYMENT_TRACKING_SOURCE_LIMIT_EXCEEDED',
    },
    {
      records: [row({ TOPLAMTUTAR: '100' })],
      code: 'PAYMENT_TRACKING_SOURCE_AMOUNT_INVALID',
    },
    {
      records: [row({ VADE: 'bad-date' })],
      code: 'PAYMENT_TRACKING_SOURCE_DATE_INVALID',
    },
  ])(
    'never retries financial limits or malformed values during an optional failure: $code',
    async ({ records, code }) => {
      authorizationQuery.mockRejectedValue(databaseUnavailable());
      query.mockResolvedValue(records);
      await expect(service.snapshot()).rejects.toMatchObject({
        response: { code },
      });
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry or read finance after invalid metadata even when authorization also fails', async () => {
    requireView.mockImplementation((name: string) =>
      name === view.name
        ? Promise.resolve({ ...view, sourceKind: 'TABLE' })
        : Promise.reject(databaseUnavailable()),
    );
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'PAYMENT_TRACKING_SOURCE_SCHEMA_CHANGED' },
    });
    expect(query).not.toHaveBeenCalled();
    expect(requireView).toHaveBeenCalledTimes(2);
  });

  it('timestamps the successful financial read instead of a later authorization completion or cache access', async () => {
    const authorization = deferred<ReturnType<typeof authorizationRow>[]>();
    authorizationQuery.mockReturnValueOnce(authorization.promise);
    const pending = service.snapshot();
    await flushMicrotasks();
    jest.setSystemTime(new Date('2026-09-29T09:00:20Z'));
    authorization.resolve([authorizationRow()]);
    const result = await pending;
    expect(result.generatedAt).toBe('2026-09-29T09:00:00.000Z');
    jest.setSystemTime(new Date('2026-09-29T09:00:29.999Z'));
    expect((await service.snapshot()).freshness?.status).toBe('fresh');
    expect(query).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-09-29T09:00:30Z'));
    const stale = await service.snapshot();
    expect(stale.generatedAt).toBe(result.generatedAt);
    expect(stale.freshness?.status).toBe('refreshing');
    await service.snapshot(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('serves concurrent cached readers immediately while one refresh builds an atomic replacement', async () => {
    const original = await service.snapshot();
    const finance = deferred<ReturnType<typeof row>[]>();
    const authorization = deferred<ReturnType<typeof authorizationRow>[]>();
    query.mockReturnValueOnce(finance.promise);
    authorizationQuery.mockReturnValueOnce(authorization.promise);
    jest.setSystemTime(new Date('2026-09-29T09:00:30Z'));
    const readers = await Promise.all([
      service.snapshot(),
      service.snapshot(),
      service.snapshot(),
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(authorizationQuery).toHaveBeenCalledTimes(2);
    for (const result of readers) {
      expect(result.generatedAt).toBe(original.generatedAt);
      expect(result.cases[0].outstanding).toBe(80);
      expect(result.freshness).toEqual({
        status: 'refreshing',
        retryAfterMs: 3000,
        maxAgeSeconds: 300,
      });
    }
    finance.resolve([row({ TOPLAMODENEN: 50 })]);
    await flushMicrotasks();
    const duringAuthorization = await service.snapshot();
    expect(duringAuthorization.cases[0].outstanding).toBe(80);
    expect(duringAuthorization.cases[0].authorization.codes).toEqual([
      'AUTH-A',
    ]);
    const fresh = service.snapshot(true);
    authorization.resolve([authorizationRow({ YETKIKODU: 'AUTH-B' })]);
    const updated = await fresh;
    expect(updated.cases[0].outstanding).toBe(50);
    expect(updated.cases[0].authorization.codes).toEqual(['AUTH-B']);
    expect(updated.cases[0].key).toBe(original.cases[0].key);
    expect(updated.freshness?.status).toBe('fresh');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('replaces cached authorization with unavailable when a background read succeeds financially but loses its optional dimension', async () => {
    await service.snapshot();
    query.mockResolvedValue([row({ TOPLAMODENEN: 50 })]);
    authorizationQuery.mockRejectedValue(databaseUnavailable());
    jest.setSystemTime(new Date('2026-09-29T09:00:30Z'));
    const previous = await service.snapshot();
    expect(previous.cases[0].authorization.codes).toEqual(['AUTH-A']);
    const updated = await service.snapshot(true);
    expect(updated.cases[0].outstanding).toBe(50);
    expect(updated.cases[0].authorization).toEqual({
      status: 'unavailable',
      codes: [],
      hasBlank: false,
    });
    expect(updated.authorizationSource.status).toBe('unavailable');
    expect(updated.freshness?.status).toBe('fresh');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('backs off failed background reads for 15 seconds while clearly labeling cached data', async () => {
    const first = await service.snapshot();
    query.mockRejectedValueOnce(databaseUnavailable());
    jest.setSystemTime(new Date('2026-09-29T09:00:30Z'));
    expect((await service.snapshot()).freshness?.status).toBe('refreshing');
    await flushMicrotasks();
    const stale = await service.snapshot();
    expect(stale.generatedAt).toBe(first.generatedAt);
    expect(stale.freshness).toEqual({
      status: 'stale',
      retryAfterMs: 15000,
      maxAgeSeconds: 300,
    });
    for (let index = 0; index < 5; index++) await service.snapshot();
    expect(query).toHaveBeenCalledTimes(2);
    jest.setSystemTime(new Date('2026-09-29T09:00:44.999Z'));
    expect((await service.snapshot()).freshness?.retryAfterMs).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
    jest.setSystemTime(new Date('2026-09-29T09:00:45Z'));
    expect((await service.snapshot()).freshness?.status).toBe('refreshing');
    await service.snapshot(true);
    expect(query).toHaveBeenCalledTimes(3);
    expect((await service.snapshot()).freshness?.status).toBe('fresh');
  });

  it('allows explicit refresh to bypass backoff without serving cached data after another failure', async () => {
    await service.snapshot();
    query.mockRejectedValue(databaseUnavailable());
    await expect(service.snapshot(true)).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    expect((await service.snapshot()).freshness?.status).toBe('stale');
    await expect(service.snapshot(true)).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    expect(query).toHaveBeenCalledTimes(3);
    query.mockResolvedValue([row({ TOPLAMODENEN: 100 })]);
    const updated = await service.snapshot(true);
    expect(updated.cases[0].outstanding).toBe(0);
    expect(updated.freshness?.status).toBe('fresh');
  });

  it('allows cached GETs during a forced refresh but makes every forced caller await its failure', async () => {
    await service.snapshot();
    const gate = deferred<ReturnType<typeof row>[]>();
    query.mockReturnValueOnce(gate.promise);
    const forced = service.snapshot(true);
    const joined = service.snapshot(true);
    const settled = Promise.allSettled([forced, joined]);
    const cached = await service.snapshot();
    expect(cached.cases[0].outstanding).toBe(80);
    expect(cached.freshness?.status).toBe('refreshing');
    gate.reject(databaseUnavailable());
    expect((await settled).map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    expect((await service.snapshot()).freshness?.status).toBe('stale');
  });

  it('never serves a 300-second-old snapshot even during refresh or backoff', async () => {
    await service.snapshot();
    const gate = deferred<ReturnType<typeof row>[]>();
    query.mockReturnValueOnce(gate.promise);
    jest.setSystemTime(new Date('2026-09-29T09:04:59.999Z'));
    expect((await service.snapshot()).freshness?.status).toBe('refreshing');
    jest.setSystemTime(new Date('2026-09-29T09:05:00Z'));
    const expired = service.snapshot();
    const rejection = expect(expired).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    gate.reject(databaseUnavailable());
    await rejection;
    query.mockRejectedValue(databaseUnavailable());
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('does not reuse yesterday’s aging on a source error even within the fresh TTL', async () => {
    jest.setSystemTime(new Date('2026-09-28T20:59:59Z'));
    await service.snapshot();
    jest.setSystemTime(new Date('2026-09-28T21:00:00Z'));
    query.mockRejectedValue(databaseUnavailable());
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    await expect(service.snapshot()).rejects.toMatchObject({
      response: { code: 'LOGO_DB_UNAVAILABLE' },
    });
    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe('Logo tracking contacts', () => {
  const contactView: PaymentViewMetadata = {
    ...view,
    name: 'L_223_OZET_SATIS',
    qualifiedName: '[LOGO_DND].[dbo].[L_223_OZET_SATIS]',
    columns: ['CARİ KOD', 'MAIL', 'TELEFON'].map((name) => ({
      name,
      kind: 'text',
    })),
  };
  let query: jest.Mock;
  let requireView: jest.Mock;
  let service: PaymentTrackingSourceService;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue([
      {
        customerCode: 'C-7',
        email: 'reader@example.test',
        phone: '+905330000001',
      },
    ]);
    requireView = jest.fn().mockResolvedValue(contactView);
    service = new PaymentTrackingSourceService(
      { query } as unknown as LogoDatabaseService,
      { requireView } as unknown as PaymentTrackingCatalogService,
    );
  });
  it('uses the exact Logo account code and a parameterized contact query', async () => {
    expect(await service.contact('C-7')).toEqual({
      email: 'reader@example.test',
      phone: '+905330000001',
      status: 'matched',
      source: 'Logo · tam cari kodu eşleşmesi',
    });
    expect(requireView).toHaveBeenCalledWith('L_223_OZET_SATIS');
    const [statement, parameters] = query.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(statement).toContain('FROM [LOGO_DND].[dbo].[L_223_OZET_SATIS]');
    expect(statement).not.toMatch(/Crm_DND|JOIN|LG_223/i);
    expect(statement).toContain('@customerCode');
    expect(parameters).toEqual({ customerCode: 'C-7' });
    expect(() => assertReadOnlyLogoQuery(statement)).not.toThrow();
  });
  it('accepts repeated identical contacts without selecting between conflicting recipients', async () => {
    query.mockResolvedValue(
      Array(3).fill({
        customerCode: 'C-7',
        email: 'a@example.test',
        phone: null,
      }),
    );
    expect((await service.contact('C-7')).status).toBe('matched');
    query.mockResolvedValue([
      { customerCode: 'C-7', email: 'a@example.test', phone: null },
      { customerCode: 'C-7', email: 'b@example.test', phone: null },
    ]);
    expect(await service.contact('C-7')).toEqual({
      email: null,
      phone: null,
      source: null,
      status: 'ambiguous',
    });
  });
  it('rejects approximate matches, over-limit recipients and unavailable sources', async () => {
    query.mockResolvedValue([
      { customerCode: 'c-7', email: 'wrong@example.test', phone: null },
    ]);
    expect((await service.contact('C-7')).status).toBe('missing');
    query.mockResolvedValue(
      Array(101).fill({
        customerCode: 'C-7',
        email: 'a@example.test',
        phone: null,
      }),
    );
    expect((await service.contact('C-7')).status).toBe('ambiguous');
    query.mockRejectedValue(new Error('Synthetic failure'));
    expect((await service.contact('C-7')).status).toBe('unavailable');
  });
  it('does not query for missing codes or unverified view schemas', async () => {
    expect((await service.contact(null)).status).toBe('missing');
    expect(query).not.toHaveBeenCalled();
    requireView.mockResolvedValue({ ...contactView, sourceKind: 'TABLE' });
    expect((await service.contact('C-7')).status).toBe('unavailable');
    expect(query).not.toHaveBeenCalled();
  });
});
