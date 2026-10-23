import type { PrismaService } from '../prisma/prisma.service';
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers have an any return type. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { budgetTotals, claimTotals, progressTotals } from './construction.math';
import { assertConstructionAccess } from './construction.guard';
import { day, numeric, version } from './construction.validation';
import { ConstructionService } from './construction.service';
const admin = { id: 'admin', role: 'ADMIN' };
describe('construction financial and progress rules', () => {
  it('reconstructs the imported March claim without adding previous amounts', () => {
    const quantities = [
      411.42, 1160, 1125.76, 292.2, 361.8, 2866.8, 229.45, 2764.2, 7757.43, 90,
      271.52, 74.06, 137.4, 1087.3, 48,
    ];
    const prices = [
      12, 9.75, 9.75, 28, 56, 4.25, 12, 4.25, 5, 12, 12, 12, 12, 10, 60,
    ];
    expect(
      claimTotals({
        taxRate: 10,
        adjustment: -22214.6,
        deduction: 0,
        lines: quantities.map((q, i) => ({
          acceptedQty: q,
          previousQty: 1000,
          unitPrice: prices[i],
        })),
      }),
    ).toEqual({
      gross: 141766.66,
      adjustment: -22214.6,
      base: 119552.06,
      tax: 11955.21,
      deduction: 0,
      net: 131507.27,
    });
  });
  it('sums exact decimal extensions before rounding document totals', () => {
    const result = claimTotals({
      taxRate: 10,
      adjustment: 0,
      deduction: 0,
      lines: [
        { acceptedQty: 1, previousQty: 0, unitPrice: '0.005' },
        { acceptedQty: 1, previousQty: 0, unitPrice: '0.005' },
      ],
    });
    expect(result.gross).toBe(0.01);
    expect(result.net).toBe(0.01);
  });
  it('keeps source amount apart from the corrected pool line and unknown actuals', () => {
    expect(
      budgetTotals([
        {
          quantity: 28,
          unitPrice: 30,
          sourceAmount: 3900,
          completedQty: null,
          paid: null,
        },
      ]),
    ).toEqual({
      calculated: 840,
      source: 3900,
      difference: -3060,
      knownPaid: 0,
      paid: null,
      paidCoverage: 0,
      itemCount: 1,
    });
  });
  it('does not turn partial payment coverage into a complete paid total', () => {
    const base = {
      quantity: 10,
      unitPrice: 20,
      sourceAmount: 200,
      completedQty: null,
    };
    expect(
      budgetTotals([
        { ...base, paid: 50 },
        { ...base, paid: null },
      ]),
    ).toMatchObject({ knownPaid: 50, paid: null, paidCoverage: 1 });
    expect(budgetTotals([{ ...base, paid: 0 }]).paid).toBe(0);
  });
  it('separates physical progress, quality, partial and unchecked', () => {
    expect(
      progressTotals([
        { status: 'DONE', quality: 'UNCHECKED', trade: { weight: 60 } },
        { status: 'PARTIAL', quality: 'PARTIAL', trade: { weight: 40 } },
      ]),
    ).toEqual({
      progress: 60,
      quality: 20,
      done: 1,
      checked: 1,
      defects: 1,
      total: 2,
    });
    expect(progressTotals([]).progress).toBeNull();
  });
});
describe('construction authorization and input boundaries', () => {
  it.each(['SALES', 'MANAGER', 'AFTERSALES', 'CALLCENTER', 'PREVIEW'])(
    'rejects %s',
    (role) =>
      expect(() => assertConstructionAccess({ id: 'user', role })).toThrow(
        ForbiddenException,
      ),
  );
  it('allows accountants to read but not mutate', () => {
    expect(() =>
      assertConstructionAccess({ id: 'accountant', role: 'ACCOUNTING' }),
    ).not.toThrow();
    expect(() =>
      assertConstructionAccess({ id: 'accountant', role: 'ACCOUNTING' }, true),
    ).toThrow(ForbiddenException);
  });
  it('blocks preview impersonation and missing identity', () => {
    expect(() =>
      assertConstructionAccess({ ...admin, isPreview: true }),
    ).toThrow();
    expect(() =>
      assertConstructionAccess({ ...admin, originalRole: 'PREVIEW' }),
    ).toThrow();
    expect(() => assertConstructionAccess()).toThrow(UnauthorizedException);
  });
  it.each(['', true, {}, 'NaN', 'Infinity', '1e3', '-1', '1,25', '1.1234567'])(
    'rejects malformed/nonfinite/negative quantity %p',
    (v) => expect(() => numeric(v)).toThrow(BadRequestException),
  );
  it('allows signed adjustments, exact decimals and explicit unknown', () => {
    expect(numeric('-22214.60', { signed: true })).toBe('-22214.60');
    expect(numeric(null, { nullable: true })).toBeNull();
    expect(() => numeric(undefined, { nullable: true })).toThrow();
    expect(() => version(0)).toThrow();
    expect(() => day('2026-02-30')).toThrow();
  });
});
describe('construction optimistic concurrency and audit', () => {
  const body = {
    version: 2,
    status: 'DONE',
    quality: 'UNCHECKED',
    note: 'Checked on site',
    reason: 'Verified site inspection',
  };
  function fixture() {
    const tx = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...admin, name: 'Admin', isActive: true }),
      },
      constructionProgress: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'entry',
          unitId: 'unit',
          version: 2,
          status: 'NOT_DONE',
          quality: 'UNCHECKED',
          note: '',
          checkedAt: null,
          unit: { projectId: 'perla' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      constructionActivity: { create: jest.fn().mockResolvedValue({}) },
    };
    return {
      tx,
      service: new ConstructionService({
        $transaction: (cb: (transaction: typeof tx) => Promise<unknown>) =>
          cb(tx),
      } as unknown as PrismaService),
    };
  }
  it('rejects stale records without writing history or data', async () => {
    const { tx, service } = fixture();
    await expect(
      service.updateEntry('unit', 'entry', { ...body, version: 1 }, admin),
    ).rejects.toThrow(ConflictException);
    expect(tx.constructionProgress.updateMany).not.toHaveBeenCalled();
    expect(tx.constructionActivity.create).not.toHaveBeenCalled();
  });
  it('scopes entries to their unit and audits before and after', async () => {
    const { tx, service } = fixture();
    await service.updateEntry('unit', 'entry', body, admin);
    expect(tx.constructionProgress.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'entry', unitId: 'unit' } }),
    );
    expect(tx.constructionProgress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'entry', version: 2 },
        data: expect.objectContaining({
          version: { increment: 1 },
          checkedAt: null,
        }),
      }),
    );
    expect(tx.constructionActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'perla',
        actorId: 'admin',
        reason: body.reason,
        before: expect.objectContaining({ status: 'NOT_DONE' }),
        after: expect.objectContaining({ status: 'DONE' }),
      }),
    });
  });
  it('checks the current database role before any mutation', async () => {
    const { tx, service } = fixture();
    tx.user.findUnique.mockResolvedValue({
      ...admin,
      role: 'SALES',
      isActive: true,
    });
    await expect(
      service.updateEntry('unit', 'entry', body, admin),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.constructionProgress.findFirst).not.toHaveBeenCalled();
  });
  it('rejects a concurrent winner after the initial read', async () => {
    const { tx, service } = fixture();
    tx.constructionProgress.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.updateEntry('unit', 'entry', body, admin),
    ).rejects.toThrow(ConflictException);
    expect(tx.constructionActivity.create).not.toHaveBeenCalled();
  });
  it('propagates audit failures so the transaction rolls back', async () => {
    const { tx, service } = fixture();
    tx.constructionActivity.create.mockRejectedValue(
      new Error('audit unavailable'),
    );
    await expect(
      service.updateEntry('unit', 'entry', body, admin),
    ).rejects.toThrow('audit unavailable');
  });
});
