import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PaymentTrackingGuard } from './payment-tracking.guard';
import { PaymentTrackingController } from './payment-tracking.controller';
import {
  paymentTrackingDate,
  paymentTrackingToday,
} from './payment-tracking-date';
import {
  parsePaymentQuery,
  parseTrackingAction,
  paymentList,
  PaymentTrackingService,
  trackingRow,
} from './payment-tracking.service';
import {
  paymentTrackingCaseKey,
  PaymentTrackingSourceService,
} from './payment-tracking-source.service';
import { PaymentTrackingStoreService } from './payment-tracking-store.service';
import type {
  PaymentActor,
  PaymentIdentity,
  PaymentSourceCase,
  PaymentSourceSnapshot,
  PaymentTrackingState,
} from './payment-tracking.types';

const actor: PaymentActor = {
  id: 'synthetic-accountant',
  name: 'Synthetic',
  role: 'ACCOUNTING',
};
function sourceCase(
  index = 1,
  patch: Partial<PaymentSourceCase> = {},
  identityPatch: Partial<PaymentIdentity> = {},
): PaymentSourceCase {
  const identity: PaymentIdentity = {
    customerCode: `C-${index}`,
    unitCode: `U-${index}`,
    currency: 'GBP',
    ...identityPatch,
  };
  return {
    key: paymentTrackingCaseKey(identity),
    identity,
    customerName: `Synthetic ${index}`,
    unitName: `Unit ${index}`,
    customerNames: [`Synthetic ${index}`],
    unitNames: [`Unit ${index}`],
    projects: [{ code: 'P-1', name: 'Synthetic project' }],
    representatives: [],
    brokers: [],
    invoiceDates: [],
    authorization: { codes: [], status: 'unmatched', hasBlank: false },
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
    ...patch,
  };
}
function snapshot(
  cases: PaymentSourceCase[],
  asOf = '2026-09-29',
): PaymentSourceSnapshot {
  return {
    database: 'LOGO_DND',
    view: 'L_223_ODEME_PLANI',
    generatedAt: `${asOf}T09:00:00.000Z`,
    asOf,
    recordCount: cases.reduce(
      (total, item) => total + item.installmentCount,
      0,
    ),
    cases,
    authorizationSource: {
      view: 'L_223_FATURA_VADE',
      status: 'available',
      matchedCases: 0,
      unmatchedCases: cases.length,
      multipleCodeCases: 0,
      message: null,
    },
  };
}
function state(
  item: PaymentSourceCase,
  patch: Partial<PaymentTrackingState> = {},
): PaymentTrackingState {
  return {
    key: item.key,
    sourceIdentity: item.identity,
    trackingDate: null,
    assigneeId: null,
    assigneeName: null,
    priority: 'normal',
    version: 2,
    updatedAt: '2026-09-28T09:00:00.000Z',
    updatedByName: 'Synthetic',
    ...patch,
  };
}
const all = { scope: 'all' };
const defer = {
  type: 'defer',
  expectedVersion: 2,
  body: 'Synthetic follow-up agreement',
  trackingDate: '2026-10-10',
};

describe('Payment tracking civil dates', () => {
  it('uses the Famagusta calendar date across local midnight', () => {
    expect(paymentTrackingToday(new Date('2026-10-01T20:59:59Z'))).toBe(
      '2026-10-01',
    );
    expect(paymentTrackingToday(new Date('2026-10-01T21:00:00Z'))).toBe(
      '2026-10-02',
    );
  });

  it('accepts valid SQL calendar dates and rejects normalized invalid dates', () => {
    expect(paymentTrackingDate('2024-02-29', 'date').toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
    for (const value of [
      '2026-02-29',
      '2026-02-30',
      '1752-12-31',
      '9999-01-01',
      '01.10.2026',
    ]) {
      expect(() => paymentTrackingDate(value, 'date')).toThrow(
        BadRequestException,
      );
    }
  });
});

describe('Payment tracking filters and original financial status', () => {
  it('keeps original overdue facts while a deferred case leaves the actionable queue', () => {
    const item = sourceCase();
    const original = structuredClone(item);
    const tracking = state(item, { trackingDate: '2026-10-10' });
    const result = trackingRow(item, tracking, '2026-09-29');
    expect(result).toMatchObject({
      oldestDueDate: '2026-09-01',
      overdueDays: 28,
      outstanding: 80,
      overdueAmount: 80,
      overdueCount: 1,
      effectiveDueDate: '2026-10-10',
      trackingStatus: 'deferred',
      trackingOverdueDays: 0,
    });
    expect(result).not.toHaveProperty('installments');
    expect(item).toEqual(original);
    const queue = paymentList(snapshot([item]), [tracking], actor, {});
    expect(queue.total).toBe(0);
    expect(queue.summary).toMatchObject({
      overdueCount: 1,
      overdueAmount: 80,
      outstanding: 80,
      actionableCount: 0,
      actionableAmount: 0,
      deferredCount: 1,
    });
    expect(
      paymentList(snapshot([item]), [tracking], actor, { scope: 'overdue' })
        .total,
    ).toBe(1);
    expect(
      paymentList(snapshot([item]), [tracking], actor, { scope: 'deferred' })
        .total,
    ).toBe(1);
    expect(trackingRow(item, tracking, '2026-10-10').trackingStatus).toBe(
      'today',
    );
    expect(trackingRow(item, tracking, '2026-10-11')).toMatchObject({
      trackingStatus: 'overdue',
      trackingOverdueDays: 1,
    });
  });

  it('never accelerates a source obligation when its next source due date moves beyond the local follow-up', () => {
    const item = sourceCase(1, {
      oldestDueDate: '2026-11-01',
      nextDueDate: '2026-11-01',
      overdueAmount: 0,
      overdueCount: 0,
      overdueDays: 0,
    });
    expect(
      trackingRow(
        item,
        state(item, { trackingDate: '2026-10-01' }),
        '2026-10-15',
      ),
    ).toMatchObject({
      effectiveDueDate: '2026-11-01',
      trackingStatus: 'upcoming',
      trackingOverdueDays: 0,
    });
  });

  it.each(['2026-09-29', '2026-10-01'])(
    'recognizes a deferred today/future obligation without inventing source overdue amounts: %s',
    (oldestDueDate) => {
      const item = sourceCase(1, {
        oldestDueDate,
        nextDueDate: oldestDueDate,
        overdueAmount: 0,
        overdueCount: 0,
        overdueDays: 0,
      });
      const tracking = state(item, { trackingDate: '2026-10-10' });
      expect(trackingRow(item, tracking, '2026-09-29')).toMatchObject({
        trackingStatus: 'deferred',
        effectiveDueDate: '2026-10-10',
        oldestDueDate,
        overdueAmount: 0,
        overdueCount: 0,
      });
      expect(
        paymentList(snapshot([item]), [tracking], actor, { scope: 'deferred' })
          .total,
      ).toBe(1);
      expect(
        paymentList(snapshot([item]), [tracking], actor, { scope: 'overdue' })
          .total,
      ).toBe(0);
    },
  );

  it('does not classify an incomplete zero or unknown balance as paid', () => {
    expect(
      trackingRow(
        sourceCase(1, {
          outstanding: null,
          overdueAmount: null,
          incompleteRows: 1,
          oldestDueDate: null,
        }),
        null,
        '2026-09-29',
      ).trackingStatus,
    ).toBe('unknown');
    expect(
      trackingRow(
        sourceCase(1, { outstanding: 0, incompleteRows: 1 }),
        null,
        '2026-09-29',
      ).trackingStatus,
    ).toBe('unknown');
    expect(
      trackingRow(
        sourceCase(1, {
          outstanding: 0,
          overdueAmount: 0,
          overdueCount: 0,
          oldestDueDate: null,
        }),
        null,
        '2026-09-29',
      ).trackingStatus,
    ).toBe('paid');
  });

  it('uses only the selected currency for every monetary summary; defaults by source record count', () => {
    const cases = [
      sourceCase(1, { installmentCount: 3 }),
      sourceCase(
        2,
        { installmentCount: 5, outstanding: 9000, overdueAmount: 9000 },
        { currency: 'EUR' },
      ),
      sourceCase(3, { outstanding: 50, overdueAmount: 50 }, { currency: null }),
    ];
    const defaultResult = paymentList(snapshot(cases), [], actor, all);
    expect(defaultResult.selectedCurrency).toBe('EUR');
    expect(defaultResult.summary.outstanding).toBe(9000);
    expect(defaultResult.currencies).toEqual([
      { value: 'EUR', label: 'EUR', recordCount: 5 },
      { value: 'GBP', label: 'GBP', recordCount: 3 },
      { value: null, label: 'Belirsiz / Unknown', recordCount: 1 },
    ]);
    const gbp = paymentList(snapshot(cases), [], actor, {
      ...all,
      currency: 'GBP',
    });
    expect(gbp.summary).toMatchObject({
      outstanding: 80,
      overdueAmount: 80,
      openCount: 1,
    });
    expect(gbp.rows.map((row) => row.identity.currency)).toEqual(['GBP']);
    const unknown = paymentList(snapshot(cases), [], actor, {
      ...all,
      currency: '__NULL__',
    });
    expect(unknown.selectedCurrency).toBeNull();
    expect(unknown.summary.outstanding).toBe(50);
    expect(() =>
      paymentList(snapshot(cases), [], actor, { currency: 'gbp' }),
    ).toThrow(BadRequestException);
  });

  it('keeps all-unknown totals null and an actually empty result zero', () => {
    const item = sourceCase(1, {
      amount: null,
      paid: null,
      outstanding: null,
      overdueAmount: null,
      incompleteRows: 2,
      oldestDueDate: null,
    });
    expect(paymentList(snapshot([item]), [], actor, all).summary).toMatchObject(
      {
        outstanding: null,
        overdueAmount: null,
        openCount: 0,
        incompleteRows: 2,
      },
    );
    expect(paymentList(snapshot([]), [], actor, all).summary).toMatchObject({
      outstanding: 0,
      overdueAmount: 0,
      openCount: 0,
      incompleteRows: 0,
    });
  });

  it('applies assignment/project/priority/search filters before totals and pagination', () => {
    const cases = Array.from({ length: 60 }, (_, i) => sourceCase(i + 1));
    const states = cases.map((item, index) =>
      state(item, {
        assigneeId: index < 40 ? actor.id : 'other',
        priority: index < 30 ? 'high' : 'normal',
      }),
    );
    const result = paymentList(snapshot(cases), states, actor, {
      ...all,
      assignee: 'me',
      project: 'P-1',
      priority: 'high',
      q: 'Synthetic',
      page: '2',
      pageSize: '25',
    });
    expect(result).toMatchObject({
      total: 30,
      totalPages: 2,
      page: 2,
      pageSize: 25,
    });
    expect(result.rows).toHaveLength(5);
    expect(result.summary).toMatchObject({
      outstanding: 2400,
      overdueAmount: 2400,
      openCount: 30,
      overdueCount: 30,
      actionableCount: 30,
      unassignedCount: 0,
    });
    expect(
      paymentList(snapshot(cases), states, actor, { ...all, assignee: 'other' })
        .total,
    ).toBe(20);
    expect(
      paymentList(snapshot(cases), states, actor, {
        ...all,
        assignee: 'unassigned',
      }).total,
    ).toBe(0);
    expect(
      paymentList(snapshot(cases), states, actor, { ...all, project: 'p-1' })
        .total,
    ).toBe(0);
  });

  it('keeps KPI summaries over the filtered portfolio when switching the queue scope', () => {
    const cases = [sourceCase(1), sourceCase(2)];
    const states = [state(cases[0], { trackingDate: '2026-10-01' })];
    const result = paymentList(snapshot(cases), states, actor, {
      scope: 'deferred',
    });
    expect(result.total).toBe(1);
    expect(result.summary).toMatchObject({
      openCount: 2,
      outstanding: 160,
      overdueCount: 2,
      overdueAmount: 160,
      actionableCount: 1,
      deferredCount: 1,
    });
  });

  it('defines actionableAmount as the entire open balance of actionable cases, including their later installments', () => {
    const item = sourceCase(1, { outstanding: 1000, overdueAmount: 100 });
    expect(paymentList(snapshot([item]), [], actor, {}).summary).toMatchObject({
      outstanding: 1000,
      overdueAmount: 100,
      actionableAmount: 1000,
    });
  });

  it.each([25, 50, 100])(
    'paginates at %s without changing global filtered totals and clamps a deleted last page',
    (pageSize) => {
      const cases = Array.from({ length: 101 }, (_, i) => sourceCase(i + 1));
      const result = paymentList(snapshot(cases), [], actor, {
        ...all,
        pageSize: String(pageSize),
      });
      expect(result.rows).toHaveLength(pageSize);
      expect(result.total).toBe(101);
      expect(result.summary.outstanding).toBe(8080);
      const final = paymentList(snapshot(cases), [], actor, {
        ...all,
        pageSize: String(pageSize),
        page: '999',
      });
      expect(final.page).toBe(Math.ceil(101 / pageSize));
      expect(final.rows).toHaveLength(1);
    },
  );

  it('sorts nullable balances last in either direction with stable case-key ties', () => {
    const cases = [
      sourceCase(1, { outstanding: null }),
      sourceCase(2),
      sourceCase(3, { outstanding: 10 }),
      sourceCase(4),
    ];
    for (const direction of ['asc', 'desc']) {
      const result = paymentList(snapshot(cases), [], actor, {
        ...all,
        sortBy: 'outstanding',
        sortDir: direction,
      });
      expect(result.rows.at(-1)?.key).toBe(cases[0].key);
      expect(
        result.rows
          .filter((row) => row.outstanding === 80)
          .map((row) => row.key),
      ).toEqual([cases[1].key, cases[3].key].sort());
    }
  });

  it('counts saved cases absent from the complete source snapshot, not cases hidden by filters', () => {
    const current = sourceCase();
    const absent = sourceCase(99);
    const result = paymentList(
      snapshot([current]),
      [state(current), state(absent)],
      actor,
      { ...all, q: 'unmatched' },
    );
    expect(result.total).toBe(0);
    expect(result.orphanedTrackingCount).toBe(1);
  });

  it.each([
    { pageSize: '1000' },
    { pageSize: '30' },
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { currency: ['GBP', 'EUR'] },
    { scope: 'wrong' },
    { sortBy: 'amount;DROP' },
    { sortDir: 'sideways' },
    { refresh: '1' },
    { q: 'x'.repeat(201) },
    { dateFrom: '2026-01-01' },
  ])('rejects unsupported or malformed query filters %s', (query) => {
    expect(() => parsePaymentQuery(query)).toThrow(BadRequestException);
  });

  it.each([
    null,
    [],
    {},
    { ...defer, expectedVersion: '2' },
    { ...defer, expectedVersion: -1 },
    { ...defer, expectedVersion: 2.2 },
    { ...defer, body: ' ' },
    { ...defer, trackingDate: '2026-02-31' },
    { ...defer, sourceIdentity: {} },
    { type: 'contact', expectedVersion: 0, body: 'Note', channel: 'sms' },
    { type: 'priority', expectedVersion: 0, priority: 'urgent' },
    { type: 'assign', expectedVersion: 0 },
  ])('rejects malformed actions before any data is read: %s', (input) => {
    expect(() => parseTrackingAction(input)).toThrow(BadRequestException);
  });
});

describe('PaymentTrackingService with source/store/contact mocks', () => {
  let service: PaymentTrackingService;
  let read: jest.Mock;
  let store: {
    getMany: jest.Mock;
    assignables: jest.Mock;
    get: jest.Mock;
    history: jest.Mock;
    apply: jest.Mock;
  };
  let contact: jest.Mock;
  let item: PaymentSourceCase;
  beforeEach(() => {
    item = sourceCase();
    read = jest.fn().mockResolvedValue(snapshot([item]));
    store = {
      getMany: jest.fn().mockResolvedValue([]),
      assignables: jest.fn().mockResolvedValue([actor]),
      get: jest.fn().mockResolvedValue(null),
      history: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      apply: jest.fn().mockResolvedValue(null),
    };
    contact = jest.fn().mockResolvedValue({
      email: null,
      phone: null,
      source: null,
      status: 'missing',
    });
    service = new PaymentTrackingService(
      { snapshot: read, contact } as unknown as PaymentTrackingSourceService,
      store as unknown as PaymentTrackingStoreService,
    );
  });

  it('validates list filters before source access and forwards explicit refresh', async () => {
    await expect(
      service.list(actor, { pageSize: '1000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(read).not.toHaveBeenCalled();
    const result = await service.list(actor, { refresh: 'true' });
    expect(read).toHaveBeenCalledWith(true);
    expect(store.getMany).toHaveBeenCalledTimes(1);
    expect(store.assignables).toHaveBeenLastCalledWith(true);
    expect(result.assignees).toEqual([actor]);
    expect(result.source).not.toHaveProperty('cases');
  });

  it('projects the list by kind while details and tracking actions retain the complete case', async () => {
    item = sourceCase(1, {
      amount: 300,
      paid: 20,
      outstanding: 280,
      overdueAmount: 280,
      overdueCount: 2,
      installmentCount: 2,
      installments: [
        sourceCase().installments[0],
        {
          ...sourceCase().installments[0],
          sequence: 2,
          projectCode: 'KDV',
          paymentKind: 'vat',
          amount: 200,
          paid: 0,
          outstanding: 200,
        },
      ],
    });
    read.mockResolvedValue(snapshot([item]));
    const selected = await service.list(actor, {
      paymentKind: 'sale',
      scope: 'all',
    });
    expect(selected.selectedPaymentKind).toBe('sale');
    expect(selected.rows[0]).toMatchObject({
      key: item.key,
      amount: 100,
      outstanding: 80,
      installmentCount: 1,
    });
    const full = await service.detail(item.key);
    expect(full.item).toMatchObject({
      key: item.key,
      amount: 300,
      outstanding: 280,
      installmentCount: 2,
    });
    expect(full.installments.map((row) => row.paymentKind)).toEqual([
      'sale',
      'vat',
    ]);
    const updated = await service.action(
      item.key,
      { type: 'note', body: 'Whole case note', expectedVersion: 0 },
      actor,
    );
    expect(updated.item.amount).toBe(300);
    expect(store.apply).toHaveBeenCalledWith({
      key: item.key,
      sourceIdentity: item.identity,
      actor,
      type: 'note',
      body: 'Whole case note',
      expectedVersion: 0,
    });
    await expect(
      service.detail(item.key, { paymentKind: 'sale' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('overlaps independent Logo and workflow reads while keeping workflow reads sequential', async () => {
    let resolveSource!: (value: PaymentSourceSnapshot) => void;
    let resolveStates!: (value: PaymentTrackingState[]) => void;
    read.mockReturnValue(
      new Promise<PaymentSourceSnapshot>((resolve) => {
        resolveSource = resolve;
      }),
    );
    store.getMany.mockReturnValue(
      new Promise<PaymentTrackingState[]>((resolve) => {
        resolveStates = resolve;
      }),
    );
    const pending = service.list(actor, {});
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.getMany).toHaveBeenCalledTimes(1);
    expect(store.assignables).not.toHaveBeenCalled();
    resolveStates([]);
    await Promise.resolve();
    expect(store.assignables).toHaveBeenCalledTimes(1);
    resolveSource(snapshot([item]));
    expect((await pending).rows).toHaveLength(1);
  });

  it('does not replace failed independent reads with empty data', async () => {
    store.getMany.mockRejectedValueOnce(
      new Error('Synthetic workflow read failure'),
    );
    await expect(service.list(actor, {})).rejects.toThrow(
      'Synthetic workflow read failure',
    );
    read.mockRejectedValueOnce(
      new ServiceUnavailableException('Synthetic SQL read failure'),
    );
    await expect(service.list(actor, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(store.apply).not.toHaveBeenCalled();
  });

  it('explicit detail refresh bypasses cached financial data and validates its query first', async () => {
    for (const raw of [
      { refresh: 'yes' },
      { refresh: 'true', unexpected: 'x' },
    ]) {
      await expect(service.detail(item.key, raw)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(read).not.toHaveBeenCalled();
    await service.detail(item.key, { refresh: 'true' });
    expect(read).toHaveBeenLastCalledWith(true);
    expect(store.assignables).toHaveBeenLastCalledWith(true);
    await service.detail(item.key);
    expect(read).toHaveBeenLastCalledWith(false);
    expect(store.assignables).toHaveBeenLastCalledWith(false);
  });

  it('starts Logo contact lookup alongside sequential detail workflow reads', async () => {
    let resolveState!: (value: PaymentTrackingState[]) => void;
    store.getMany.mockReturnValue(
      new Promise<PaymentTrackingState[]>((resolve) => {
        resolveState = resolve;
      }),
    );
    const pending = service.detail(item.key);
    await Promise.resolve();
    expect(store.getMany).toHaveBeenCalledWith([item.key]);
    expect(contact).toHaveBeenCalledWith(item.identity.customerCode);
    expect(store.history).not.toHaveBeenCalled();
    expect(store.assignables).not.toHaveBeenCalled();
    resolveState([]);
    await pending;
    expect(store.history).toHaveBeenCalledWith(item.key);
    expect(store.assignables).toHaveBeenCalledWith(false);
  });

  it('forces the assignee list after a successful tracking action', async () => {
    await service.action(
      item.key,
      { type: 'note', expectedVersion: 0, body: 'Updated' },
      actor,
    );
    expect(store.apply).toHaveBeenCalledTimes(1);
    expect(store.assignables).toHaveBeenCalledWith(true);
  });

  it.each(['', 'wrong', '../source', 'a'.repeat(63), 'G'.repeat(64)])(
    'rejects bad case keys before touching source or store: %s',
    async (key) => {
      await expect(service.detail(key)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.action(key, defer, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(read).not.toHaveBeenCalled();
      expect(store.apply).not.toHaveBeenCalled();
    },
  );

  it('refuses absent source cases without writing or deleting their stored history', async () => {
    read.mockResolvedValue(snapshot([]));
    await expect(service.detail(item.key)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.action(item.key, defer, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(store.apply).not.toHaveBeenCalled();
    expect(store.history).not.toHaveBeenCalled();
  });

  it.each([
    { canTrack: false, trackingIssue: 'Identity unavailable' },
    { outstanding: 0, overdueAmount: 0 },
    { outstanding: null },
    { oldestDueDate: null },
  ])(
    'blocks deferral when the fresh source cannot support it: %s',
    async (patch) => {
      read.mockResolvedValue(snapshot([sourceCase(1, patch)]));
      await expect(
        service.action(item.key, defer, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(read).toHaveBeenCalledWith(true);
      expect(store.apply).not.toHaveBeenCalled();
    },
  );

  it.each(['2026-09-29', '2026-09-01', '2026-08-01'])(
    'requires a follow-up after today and after the source due date: %s',
    async (trackingDate) => {
      await expect(
        service.action(item.key, { ...defer, trackingDate }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(store.apply).not.toHaveBeenCalled();
    },
  );

  it('also rejects a future follow-up that precedes the original future due date', async () => {
    read.mockResolvedValue(
      snapshot([
        sourceCase(1, { oldestDueDate: '2026-11-01', overdueAmount: 0 }),
      ]),
    );
    await expect(service.action(item.key, defer, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.apply).not.toHaveBeenCalled();
  });

  it('passes the fresh exact identity, actor and expected version to the store, without copying financial rows', async () => {
    const updated = state(item, { trackingDate: '2026-10-10', version: 3 });
    store.apply.mockImplementation(() => {
      store.getMany.mockResolvedValue([updated]);
      return Promise.resolve(updated);
    });
    const result = await service.action(item.key, defer, actor);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(true);
    expect(store.apply).toHaveBeenCalledWith({
      key: item.key,
      sourceIdentity: item.identity,
      actor,
      ...defer,
    });
    expect(result.item.tracking).toEqual(updated);
    expect(result.item).toMatchObject({
      trackingStatus: 'deferred',
      overdueAmount: 80,
      oldestDueDate: '2026-09-01',
    });
    expect(result.installments).toEqual(item.installments);
    const [input] = store.apply.mock.calls[0] as [Record<string, unknown>];
    expect(input).not.toHaveProperty('installments');
    expect(input).not.toHaveProperty('amount');
    expect(input).not.toHaveProperty('customerName');
  });

  it('propagates a stale-version conflict without a second write or blind retry', async () => {
    store.apply.mockRejectedValue(
      new ConflictException('Synthetic stale version'),
    );
    await expect(service.action(item.key, defer, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(store.apply).toHaveBeenCalledTimes(1);
    expect(store.history).not.toHaveBeenCalled();
  });

  it('does not write if refreshing the financial source fails', async () => {
    read.mockRejectedValue(
      new ServiceUnavailableException('Synthetic source failure'),
    );
    await expect(service.action(item.key, defer, actor)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(store.apply).not.toHaveBeenCalled();
  });

  it('requires an existing postponed date to reset and preserves mandatory notes/channel parsing', async () => {
    const reset = {
      type: 'reset',
      expectedVersion: 2,
      body: 'Remove local postponement',
    };
    await expect(service.action(item.key, reset, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.apply).not.toHaveBeenCalled();
    store.get.mockResolvedValue(state(item, { trackingDate: '2026-10-10' }));
    await service.action(item.key, reset, actor);
    expect(store.apply).toHaveBeenCalledWith({
      key: item.key,
      sourceIdentity: item.identity,
      actor,
      ...reset,
    });
    await service.action(
      item.key,
      {
        type: 'contact',
        expectedVersion: 2,
        body: '  Synthetic call note  ',
        channel: 'phone',
      },
      actor,
    );
    expect(store.apply).toHaveBeenLastCalledWith({
      key: item.key,
      sourceIdentity: item.identity,
      actor,
      type: 'contact',
      expectedVersion: 2,
      body: 'Synthetic call note',
      channel: 'phone',
    });
  });

  it('loads contact details from the Logo source with the exact customer code', async () => {
    const sourceContact = {
      status: 'matched',
      email: 'logo@example.invalid',
      phone: '111',
      source: 'LOGO_DND · LG_223_CLCARD',
    };
    contact.mockResolvedValue(sourceContact);
    const result = await service.detail(item.key);
    expect(contact).toHaveBeenCalledWith(item.identity.customerCode);
    expect(result.contact).toEqual(sourceContact);
  });

  it.each(['missing', 'ambiguous', 'unavailable'])(
    'preserves Logo contact status %s without substituting local CRM contact data',
    async (status) => {
      const sourceContact = { status, email: null, phone: null, source: null };
      contact.mockResolvedValue(sourceContact);
      expect((await service.detail(item.key)).contact).toEqual(sourceContact);
    },
  );

  it('returns history pagination metadata and leaves original installments intact', async () => {
    const history = [
      {
        id: 'event-fixture',
        type: 'note',
        body: 'Synthetic history',
        previousDate: null,
        nextDate: null,
        actorName: 'Synthetic',
        channel: null,
        createdAt: '2026-09-28T09:00:00Z',
      },
    ];
    store.history.mockResolvedValue({ items: history, hasMore: true });
    const result = await service.detail(item.key);
    expect(result.history).toEqual(history);
    expect(result.historyHasMore).toBe(true);
    expect(result.installments).toEqual(item.installments);
    expect(read).toHaveBeenCalledWith(false);
  });
});

function context(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
describe('Payment tracking controller access contract', () => {
  it('guards the entire controller with JWT and the finance guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PaymentTrackingController)).toBe(
      'payment-tracking',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PaymentTrackingController),
    ).toEqual([JwtAuthGuard, PaymentTrackingGuard]);
  });
  it.each(['ADMIN', 'ACCOUNTING'])(
    'allows %s through the actual finance guard',
    (role) => {
      expect(new PaymentTrackingGuard().canActivate(context({ role }))).toBe(
        true,
      );
    },
  );
  it.each([
    { role: 'PREVIEW' },
    { role: 'SALES' },
    { role: 'MANAGER' },
    { role: 'AFTERSALES' },
    { role: 'ADMIN', originalRole: 'PREVIEW' },
    { role: 'ACCOUNTING', isPreview: true },
  ])(
    'returns forbidden for unauthorized and preview identities: %s',
    (user) => {
      expect(() =>
        new PaymentTrackingGuard().canActivate(context(user)),
      ).toThrow(ForbiddenException);
    },
  );
  it('returns unauthorized when no authenticated role exists', () => {
    expect(() => new PaymentTrackingGuard().canActivate(context())).toThrow(
      UnauthorizedException,
    );
  });
  it('forwards the authenticated actor and raw inputs without source-ID overrides', async () => {
    const methods = {
      list: jest.fn().mockResolvedValue({}),
      detail: jest.fn().mockResolvedValue({}),
      action: jest.fn().mockResolvedValue({}),
    };
    const controller = new PaymentTrackingController(
      methods as unknown as PaymentTrackingService,
    );
    const key = sourceCase().key;
    await controller.list({ user: actor }, { scope: 'all', pageSize: '25' });
    await controller.detail(key);
    await controller.action(key, defer, { user: actor });
    expect(methods.list).toHaveBeenCalledWith(actor, {
      scope: 'all',
      pageSize: '25',
    });
    expect(methods.detail).toHaveBeenCalledWith(key, {});
    await controller.detail(key, { refresh: 'true' });
    expect(methods.detail).toHaveBeenLastCalledWith(key, { refresh: 'true' });
    expect(methods.action).toHaveBeenCalledWith(key, defer, actor);
  });
});
