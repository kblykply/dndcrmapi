import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolesGuard } from '../common/roles.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  PaymentTrackingService,
  paymentList,
} from './payment-tracking.service';
import {
  PaymentTrackingSourceService,
  paymentTrackingCaseKey,
} from './payment-tracking-source.service';
import { PaymentTrackingStoreService } from './payment-tracking-store.service';
import { salesLedgerSnapshot } from './sales-ledger-scope';
import { SalesLedgerService } from './sales-ledger.service';
import {
  SalesLedgerController,
  SalesLedgerMappingsController,
} from './sales-ledger.controller';
import { PrismaService } from '../prisma/prisma.service';
import type {
  PaymentSourceCase,
  PaymentSourceSnapshot,
} from './payment-tracking.types';
const bob = { id: 'bob', role: 'SALES' },
  sabina = { id: 'sabina', role: 'SALES' };
function item(index: number, reps: string[]): PaymentSourceCase {
  const identity = {
    customerCode: `C${index}`,
    unitCode: `LJ-A${index}`,
    currency: 'GBP',
  };
  return {
    key: paymentTrackingCaseKey(identity),
    identity,
    customerName: `Customer ${index}`,
    unitName: `Unit ${index}`,
    customerNames: [],
    unitNames: [],
    projects: [],
    representatives: reps,
    brokers: [],
    invoiceDates: [],
    authorization: { codes: [], status: 'matched', hasBlank: true },
    invoiceOk: { status: 'matched', values: ['DND'], hasBlank: false },
    installmentCount: 1,
    incompleteRows: 0,
    amount: 100,
    paid: 20,
    outstanding: 80,
    overdueAmount: 80,
    overdueCount: 1,
    dueTodayAmount: 0,
    oldestDueDate: '2026-01-01',
    nextDueDate: null,
    overdueDays: 30,
    canTrack: true,
    trackingIssue: null,
    installments: [
      {
        sequence: 1,
        projectCode: identity.unitCode,
        paymentKind: 'sale',
        dueDate: '2026-01-01',
        amount: 100,
        paid: 20,
        outstanding: 80,
        overdueDays: 30,
        status: 'overdue',
      },
    ],
  };
}
function source(): PaymentSourceSnapshot {
  return {
    database: 'LOGO_DND',
    view: 'L_223_ODEME_PLANI',
    generatedAt: '2026-10-15T00:00:00Z',
    asOf: '2026-10-15',
    recordCount: 6,
    cases: [
      item(1, ['BOB']),
      item(2, ['SABINA']),
      item(3, ['BOB', 'SABINA']),
      item(4, []),
      item(5, ['UNKNOWN']),
      item(6, ['BOB', 'UNKNOWN']),
    ],
    authorizationSource: {
      view: 'L_223_FATURA_VADE',
      status: 'available',
      matchedCases: 6,
      unmatchedCases: 0,
      multipleCodeCases: 0,
      message: null,
    },
  };
}
const mappings = [
  { code: 'BOB', userId: 'bob' },
  { code: 'SABINA', userId: 'sabina' },
];
describe('sales ledger isolation', () => {
  it('matches only explicit owner codes and never falls back to all cases', () => {
    const data = source();
    expect(
      salesLedgerSnapshot(data, bob.id, mappings).cases.map(
        (row) => row.identity.customerCode,
      ),
    ).toEqual(['C1']);
    expect(
      salesLedgerSnapshot(data, sabina.id, mappings).cases.map(
        (row) => row.identity.customerCode,
      ),
    ).toEqual(['C2']);
    expect(salesLedgerSnapshot(data, 'unmapped', mappings).cases).toEqual([]);
    expect(data.cases).toHaveLength(6);
  });
  it('handles case and surrounding whitespace without guessing a person from a partial name', () => {
    const data = source();
    data.cases = [item(1, [' bob ']), item(2, ['BOBBY'])];
    expect(salesLedgerSnapshot(data, bob.id, mappings).cases).toHaveLength(1);
  });
  it('keeps DND and blank authorization constraints on list, detail and source projections', () => {
    const data = source();
    data.cases = [
      item(1, ['BOB']),
      {
        ...item(2, ['BOB']),
        invoiceOk: { status: 'matched', values: ['OTHER'], hasBlank: false },
      },
      {
        ...item(3, ['BOB']),
        authorization: { status: 'matched', codes: ['X'], hasBlank: true },
      },
    ];
    const scoped = salesLedgerSnapshot(data, bob.id, mappings);
    expect(scoped.cases.map((row) => row.identity.customerCode)).toEqual([
      'C1',
    ]);
    const result = paymentList(scoped, [], bob, {
      currency: 'GBP',
      scope: 'all',
      paymentKind: 'sale',
      invoiceOk: 'value:DND',
      authorizationState: 'blank',
    });
    expect(result.total).toBe(1);
    expect(
      result.filterOptions.representatives.map((row) => row.value),
    ).toEqual(['BOB']);
    expect(
      paymentList(scoped, [], bob, { representative: 'SABINA', scope: 'all' })
        .total,
    ).toBe(0);
  });
  it('blocks access when invoice metadata is unavailable', () => {
    const data = source();
    data.authorizationSource.status = 'unavailable';
    expect(() => salesLedgerSnapshot(data, bob.id, mappings)).toThrow();
  });
  it('allows aliases only when every code is mapped to the same user', () => {
    const data = source();
    data.cases = [item(1, ['BOB', 'BOB_2'])];
    expect(
      salesLedgerSnapshot(data, bob.id, [
        ...mappings,
        { code: 'BOB_2', userId: 'bob' },
      ]).cases,
    ).toHaveLength(1);
  });
  it('keeps sales and admin mapping routes behind distinct role guards', () => {
    expect(Reflect.getMetadata('roles', SalesLedgerController)).toEqual([
      'SALES',
    ]);
    expect(Reflect.getMetadata('roles', SalesLedgerMappingsController)).toEqual(
      ['ADMIN'],
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, SalesLedgerController)).toEqual(
      [JwtAuthGuard, RolesGuard],
    );
  });
  function service() {
    const prisma = {
      salesLedgerRepresentative: {
        findMany: jest.fn().mockResolvedValue(mappings),
      },
    };
    const src = { snapshot: jest.fn().mockResolvedValue(source()) };
    const store = { getMany: jest.fn().mockResolvedValue([]) };
    const payments = {
      describe: jest.fn(
        async (snapshot: PaymentSourceSnapshot, found: PaymentSourceCase) => ({
          item: found,
          portfolio: { cases: snapshot.cases },
          assignees: [],
        }),
      ),
      action: jest.fn(),
    };
    const ledger = new SalesLedgerService(
      prisma as unknown as PrismaService,
      src as unknown as PaymentTrackingSourceService,
      store as unknown as PaymentTrackingStoreService,
      payments as unknown as PaymentTrackingService,
    );
    return { ledger, prisma, payments };
  }
  it('rejects other roles even if called outside the HTTP guard', async () => {
    const { ledger } = service();
    await expect(
      ledger.scoped({ id: 'admin', role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects a known case belonging to another salesperson before reading its details', async () => {
    const { ledger, payments } = service();
    await expect(
      ledger.detail(bob, source().cases[1].key),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(payments.describe).not.toHaveBeenCalled();
  });
  it('limits the portfolio before detail and statement rendering, including shared customer/unit cases', async () => {
    const { ledger, payments } = service();
    await ledger.detail(bob, source().cases[0].key);
    expect(payments.describe.mock.calls[0][0].cases).toHaveLength(1);
  });
  it('re-reads mappings on every request, so removing a mapping revokes detail and report access', async () => {
    const { ledger, prisma } = service();
    expect((await ledger.list(bob, { scope: 'all' }, true)).total).toBe(1);
    prisma.salesLedgerRepresentative.findMany.mockResolvedValue([]);
    await expect(
      ledger.detail(bob, source().cases[0].key),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await ledger.list(bob, { scope: 'all' }, true)).rows).toEqual([]);
  });
  it('prevents salespeople from assigning financial cases or changing priority', async () => {
    const { ledger, payments } = service();
    await expect(
      ledger.action(bob, source().cases[0].key, {
        type: 'assign',
        assigneeId: 'other',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(payments.action).not.toHaveBeenCalled();
  });
  it('denies conflicting normalized mappings rather than using the last matching code', () => {
    const data = source();
    expect(
      salesLedgerSnapshot(data, bob.id, [
        { code: 'BOB', userId: 'bob' },
        { code: ' bob ', userId: 'sabina' },
      ]).cases,
    ).toEqual([]);
  });
  it('authorizes ownership again against a fresh snapshot before recording an action', async () => {
    const src = { snapshot: jest.fn().mockResolvedValue(source()) };
    const store = { apply: jest.fn() };
    const payments = new PaymentTrackingService(
      src as unknown as PaymentTrackingSourceService,
      store as unknown as PaymentTrackingStoreService,
    );
    const prisma = {
      salesLedgerRepresentative: {
        findMany: jest.fn().mockResolvedValue(mappings),
      },
    };
    const ledger = new SalesLedgerService(
      prisma as unknown as PrismaService,
      src as unknown as PaymentTrackingSourceService,
      store as unknown as PaymentTrackingStoreService,
      payments,
    );
    await expect(
      ledger.action(bob, source().cases[1].key, {
        type: 'note',
        body: 'must not save',
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(src.snapshot).toHaveBeenCalledWith(true);
    expect(store.apply).not.toHaveBeenCalled();
  });
});
