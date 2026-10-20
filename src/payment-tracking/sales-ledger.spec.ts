import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
import {
  salesLedgerAccountKey,
  salesLedgerSnapshot,
} from './sales-ledger-scope';
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
  it('adds assigned company accounts in all currencies without replacing Logo ownership or leaking other units', () => {
    const data = source();
    const company = item(7, ['DND']);
    const euro = {
      ...company,
      identity: { ...company.identity, currency: 'EUR' },
    };
    euro.key = paymentTrackingCaseKey(euro.identity);
    const otherUnit = {
      ...item(8, ['DND']),
      identity: { ...company.identity, unitCode: 'LJ-A8' },
    };
    otherUnit.key = paymentTrackingCaseKey(otherUnit.identity);
    data.cases.push(company, euro, otherUnit);
    const before = JSON.stringify(data);
    const assignments = [
      { key: salesLedgerAccountKey(company.identity)!, userId: 'bob' },
    ];
    const result = salesLedgerSnapshot(data, 'bob', mappings, assignments);
    expect(result.cases.map((row) => row.key)).toEqual([
      data.cases[0].key,
      company.key,
      euro.key,
    ]);
    expect(
      salesLedgerSnapshot(data, 'sabina', mappings, assignments).cases.map(
        (row) => row.key,
      ),
    ).toEqual([data.cases[1].key]);
    expect(JSON.stringify(data)).toBe(before);
    expect(result.cases[1].representatives).toEqual(['DND']);
    expect(
      salesLedgerAccountKey({ customerCode: '', unitCode: 'LJ-A7' }),
    ).toBeNull();
    expect(
      salesLedgerAccountKey({ ...company.identity, customerCode: ' C7' }),
    ).not.toBe(assignments[0].key);
  });
  it('does not let manual assignment override invoice or authorization restrictions', () => {
    const data = source();
    data.cases[0].authorization.codes = ['PRIVATE'];
    data.cases[1].invoiceOk!.values = ['OTHER'];
    const assigned = data.cases
      .slice(0, 2)
      .map((row) => ({
        key: salesLedgerAccountKey(row.identity)!,
        userId: 'unmapped',
      }));
    expect(
      salesLedgerSnapshot(data, 'unmapped', mappings, assigned).cases,
    ).toEqual([]);
  });
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
      'ADMIN',
      'MANAGER',
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
      salesLedgerAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
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
    return { ledger, prisma, payments, src, store };
  }
  it('uses assignments for list, detail and export, and revokes them on the next request', async () => {
    const { ledger, prisma, payments } = service();
    const target = source().cases[4];
    const assignment = {
      key: salesLedgerAccountKey(target.identity),
      userId: 'bob',
      version: 1,
      updatedAt: new Date(),
      user: { id: 'bob', name: 'Bob', role: 'SALES', isActive: true },
      changedBy: { name: 'Manager' },
    };
    prisma.salesLedgerAssignment.findMany.mockResolvedValue([
      assignment,
    ] as never);
    const list = await ledger.list(bob, { scope: 'all', currency: 'GBP' });
    expect(list.total).toBe(2);
    const exported = await ledger.list(
      bob,
      { scope: 'all', currency: 'GBP' },
      true,
    );
    expect(exported.rows.map((row) => row.key)).toEqual(
      list.rows.map((row) => row.key),
    );
    const detail = await ledger.detail(bob, target.key);
    expect(detail.item.followupAssignment).toMatchObject({
      userId: 'bob',
      userName: 'Bob',
      version: 1,
    });
    expect(detail.canAssignFollowup).toBe(false);
    expect(detail.followupAssignees).toEqual([]);
    prisma.salesLedgerAssignment.findMany.mockResolvedValue([
      {
        ...assignment,
        userId: 'sabina',
        user: { ...assignment.user, id: 'sabina' },
      },
    ] as never);
    await expect(ledger.detail(bob, target.key)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await ledger.list(bob, { scope: 'all' }, true)).total).toBe(1);
    payments.action.mockClear();
  });
  it('ignores assignments to deactivated or non-sales users', async () => {
    const { ledger, prisma } = service();
    for (const user of [
      { role: 'SALES', isActive: false },
      { role: 'MANAGER', isActive: true },
    ]) {
      prisma.salesLedgerAssignment.findMany.mockResolvedValue([
        {
          key: salesLedgerAccountKey(source().cases[4].identity),
          userId: 'bob',
          user,
          version: 1,
          updatedAt: new Date(),
        },
      ] as never);
      expect((await ledger.list(bob, { scope: 'all' })).total).toBe(1);
    }
  });
  function assignmentService() {
    const result = service();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
          role: where.id === 'manager' ? 'MANAGER' : 'SALES',
          isActive: true,
        })),
      },
      salesLedgerAssignment: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const transaction = jest.fn(
      async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
    );
    Object.assign(result.prisma, { $transaction: transaction });
    return { ...result, tx, transaction };
  }
  it('assigns an eligible account, records the actor and keeps source and mappings unchanged', async () => {
    const { ledger, tx, src, prisma } = assignmentService();
    const target = source().cases[4];
    const result = await ledger.assignFollowup(
      { id: 'manager', role: 'MANAGER' },
      target.key,
      { userId: 'bob', expectedVersion: 0 },
    );
    expect(src.snapshot).toHaveBeenCalledWith(true);
    expect(tx.salesLedgerAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: salesLedgerAccountKey(target.identity) },
        create: expect.objectContaining({
          customerCode: 'C5',
          unitCode: 'LJ-A5',
          userId: 'bob',
          changedById: 'manager',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'manager',
          metaJson: {
            customerCode: 'C5',
            unitCode: 'LJ-A5',
            previousUserId: null,
            userId: 'bob',
          },
        }),
      }),
    );
    expect(result.item.representatives).toEqual(['UNKNOWN']);
    expect(prisma.salesLedgerRepresentative.findMany).toHaveBeenCalled();
    expect(result.canAssignFollowup).toBe(true);
  });
  it('allows unassignment with version checking and retains an audit record', async () => {
    const { ledger, tx } = assignmentService();
    tx.salesLedgerAssignment.findUnique.mockResolvedValue({
      userId: 'bob',
      version: 2,
    });
    await ledger.assignFollowup(
      { id: 'manager', role: 'MANAGER' },
      source().cases[4].key,
      { userId: null, expectedVersion: 2 },
    );
    expect(tx.salesLedgerAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          userId: null,
          version: { increment: 1 },
        }),
      }),
    );
  });
  it.each(['SALES', 'AFTERSALES', 'ACCOUNTING', 'PREVIEW'])(
    'prevents %s from granting access',
    async (role) => {
      const { ledger, transaction } = assignmentService();
      await expect(
        ledger.assignFollowup({ id: 'bob', role }, source().cases[4].key, {
          userId: 'bob',
          expectedVersion: 0,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects stale assignment forms without overwriting a newer assignment', async () => {
    const { ledger, tx } = assignmentService();
    tx.salesLedgerAssignment.findUnique.mockResolvedValue({
      userId: 'sabina',
      version: 3,
    });
    await expect(
      ledger.assignFollowup(
        { id: 'manager', role: 'MANAGER' },
        source().cases[4].key,
        { userId: 'bob', expectedVersion: 2 },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.salesLedgerAssignment.upsert).not.toHaveBeenCalled();
  });
  it.each([
    { role: 'SALES', isActive: false },
    { role: 'MANAGER', isActive: true },
  ])('rejects an ineligible follow-up owner %j', async (target) => {
    const { ledger, tx } = assignmentService();
    tx.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === 'manager' ? { role: 'MANAGER', isActive: true } : target,
    );
    await expect(
      ledger.assignFollowup(
        { id: 'manager', role: 'MANAGER' },
        source().cases[4].key,
        { userId: 'bob', expectedVersion: 0 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.salesLedgerAssignment.upsert).not.toHaveBeenCalled();
  });
  it('rechecks the manager role inside the assignment transaction', async () => {
    const { ledger, tx } = assignmentService();
    tx.user.findUnique.mockResolvedValue({ role: 'SALES', isActive: true });
    await expect(
      ledger.assignFollowup(
        { id: 'manager', role: 'MANAGER' },
        source().cases[4].key,
        { userId: 'bob', expectedVersion: 0 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.salesLedgerAssignment.upsert).not.toHaveBeenCalled();
  });
  it('shows admin portfolio counts using the same private account scope as each salesperson', async () => {
    const snapshot = source();
    snapshot.importedAt = '2026-10-10T07:12:31.633Z';
    const prisma = {
      salesLedgerAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'bob', name: 'Bob' },
          { id: 'sabina', name: 'Sabina' },
          { id: 'unmapped', name: 'Unmapped' },
        ]),
      },
      salesLedgerRepresentative: {
        findMany: jest.fn().mockResolvedValue(mappings),
      },
    };
    const ledger = new SalesLedgerService(
      prisma as unknown as PrismaService,
      {
        snapshot: jest.fn().mockResolvedValue(snapshot),
      } as unknown as PaymentTrackingSourceService,
      {} as PaymentTrackingStoreService,
      {} as PaymentTrackingService,
    );
    const result = await ledger.mappings();
    expect(result.portfolios).toEqual([
      { userId: 'bob', accountCount: 1, customerCount: 1, overdueCount: 1 },
      { userId: 'sabina', accountCount: 1, customerCount: 1, overdueCount: 1 },
      {
        userId: 'unmapped',
        accountCount: 0,
        customerCount: 0,
        overdueCount: 0,
      },
    ]);
    expect(result.codes).toContain('UNKNOWN');
    expect(result.importedAt).toBe(snapshot.importedAt);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'SALES', isActive: true } }),
    );
  });
  it('rejects other roles even if called outside the HTTP guard', async () => {
    const { ledger } = service();
    await expect(
      ledger.scoped({ id: 'callcenter', role: 'CALLCENTER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['ADMIN', 'MANAGER'])(
    'lets %s see all eligible accounts, filter representatives and export the same scope',
    async (role) => {
      const { ledger, payments } = service();
      const actor = { id: 'supervisor', role };
      const all = await ledger.list(actor, { scope: 'all', currency: 'GBP' });
      expect(all.total).toBe(6); // Includes unmapped and mixed-owner records.
      expect(all.filterOptions.representatives.map((row) => row.value)).toEqual(
        expect.arrayContaining(['BOB', 'SABINA', 'UNKNOWN']),
      );
      const filtered = await ledger.list(actor, {
        scope: 'all',
        currency: 'GBP',
        representative: 'SABINA',
      });
      const exported = await ledger.list(
        actor,
        { scope: 'all', currency: 'GBP', representative: 'SABINA' },
        true,
      );
      expect(filtered.total).toBe(2);
      expect(exported.rows.map((row) => row.key)).toEqual(
        filtered.rows.map((row) => row.key),
      );
      await ledger.detail(actor, source().cases[4].key);
      expect(payments.describe.mock.calls[0][0].cases).toHaveLength(6);
    },
  );
  it('keeps financial restrictions for supervisors as well as salespeople', () => {
    const data = source();
    data.cases[0].invoiceOk = {
      status: 'matched',
      values: ['OTHER'],
      hasBlank: false,
    };
    data.cases[1].authorization = {
      status: 'matched',
      codes: ['PRIVATE'],
      hasBlank: false,
    };
    expect(
      salesLedgerSnapshot(data, null, mappings).cases.map(
        (row) => row.identity.customerCode,
      ),
    ).toEqual(['C3', 'C4', 'C5', 'C6']);
    data.authorizationSource.status = 'unavailable';
    expect(() => salesLedgerSnapshot(data, null, mappings)).toThrow();
  });
  it('does not let a salesperson broaden scope using another representative filter', async () => {
    const { ledger } = service();
    const result = await ledger.list(
      bob,
      { scope: 'all', representative: 'SABINA' },
      true,
    );
    expect(result.rows).toEqual([]);
    expect(
      result.filterOptions.representatives.map((row) => row.value),
    ).toEqual(['BOB']);
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
      salesLedgerAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
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
