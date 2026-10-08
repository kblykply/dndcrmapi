import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PROJECT_LABELS, PROJECT_TYPES } from '../common/projects';
import { paymentProjectGroups } from './payment-tracking-project';
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
} from './payment-tracking.types';

const actor = { id: 'project-filter-accountant', role: 'ACCOUNTING' };
function item(
  unitCode: string | null,
  changes: Partial<PaymentIdentity> = {},
  projectCode: string | null = unitCode,
  paymentKind: PaymentKind = 'sale',
  outstanding = 80,
): PaymentSourceCase {
  const identity = {
    customerCode: 'C-1',
    unitCode,
    currency: 'GBP',
    ...changes,
  };
  return {
    key: paymentTrackingCaseKey(identity),
    identity,
    customerName: 'Synthetic',
    unitName: 'Synthetic',
    customerNames: ['Synthetic'],
    unitNames: ['Synthetic'],
    projects: projectCode ? [{ code: projectCode, name: '' }] : [],
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
    oldestDueDate: outstanding > 0 ? '2026-10-01' : null,
    nextDueDate: null,
    overdueDays: outstanding > 0 ? 1 : 0,
    canTrack: true,
    trackingIssue: null,
    installments: [
      {
        sequence: 1,
        projectCode,
        paymentKind,
        dueDate: '2026-10-01',
        amount: 100,
        paid: 100 - outstanding,
        outstanding,
        overdueDays: outstanding > 0 ? 1 : 0,
        status: outstanding > 0 ? 'overdue' : 'paid',
      },
    ],
  };
}
function snapshot(cases: PaymentSourceCase[]): PaymentSourceSnapshot {
  return {
    database: 'LOGO_DND',
    view: 'L_223_ODEME_PLANI',
    asOf: '2026-10-02',
    generatedAt: '2026-10-02T12:00:00.000Z',
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
function list(cases: PaymentSourceCase[], query: Record<string, unknown> = {}) {
  return paymentList(snapshot(cases), [], actor, {
    scope: 'all',
    currency: 'GBP',
    ...query,
  });
}

describe('Payment main-project classification', () => {
  it.each([
    ['LJ-A1', 'LA_JOYA'],
    ['LJ-A15A', 'LA_JOYA'],
    ['LJP-A1', 'LA_JOYA_PERLA'],
    ['LJP-D60', 'LA_JOYA_PERLA'],
    ['LJP2-A1', 'LA_JOYA_PERLA_II'],
    ['LJP2-F2A', 'LA_JOYA_PERLA_II'],
    ['LV-A39-A40', 'LAGOON_VERDE'],
    ['LV-B1', 'LAGOON_VERDE'],
    ['GK-ARSA1', 'GECITKALE_1_ETAP'],
    ['GK-ARSA36', 'GECITKALE_1_ETAP'],
    [' ljp2-a1 ', 'LA_JOYA_PERLA_II'],
  ])('classifies audited full unit code %s as %s', (unit, expected) => {
    const row = item(unit, {}, 'KDV', 'vat');
    expect(paymentProjectGroups([row]).get(row.key)).toBe(expected);
  });

  it.each([
    null,
    '',
    ' ',
    'LJ',
    'LJP',
    'LJP2',
    'LJP3-A1',
    'LJP21-A1',
    'LJPERLA-A1',
    'LJ-ACCOUNT',
    'LJ-A',
    'LJ-A1EXTRA',
    'LJ-A1-',
    'LJ-A1-A',
    'LJ-A1-2',
    'GK-ARSA',
    'GK-ARSA1A',
    'GK-ARSA1-2',
    'S-A1',
    'SOPOT',
    'DEPOZİTO',
    'ŞANTİYE',
    'LA JOYA PERLA 2',
  ])(
    'keeps unsupported, partial or ambiguous unit %s unknown even with a known payment code',
    (unit) => {
      const row = item(unit, {}, 'LJ-A1');
      row.customerName = 'La Joya';
      row.customerNames = ['La Joya Perla'];
      row.unitName = 'LA JOYA PERLA 2';
      row.unitNames = ['LAGOON VERDE'];
      row.projects[0].name = PROJECT_LABELS.LA_JOYA;
      expect(paymentProjectGroups([row]).get(row.key)).toBe('UNKNOWN');
    },
  );

  it('keeps generic payment kinds in their unit project without changing financial rows', () => {
    const rows = [
      item('LJP2-A1'),
      item('LJP2-A1', { currency: 'TL' }, 'KDV', 'vat'),
      item('LJP2-A1', { currency: 'EUR' }, 'TRAFO', 'transformer'),
      item('LJP2-A1', { currency: 'USD' }, 'ESYA', 'furniture'),
      item('LJP2-A1', { currency: null }, 'DEPOZİTO ELEKTRİK', 'deposit'),
    ];
    const before = structuredClone(rows);
    expect([...paymentProjectGroups(rows).values()]).toEqual(
      rows.map(() => 'LA_JOYA_PERLA_II'),
    );
    expect(rows).toEqual(before);
  });

  it.each(['LJP-A1', 'LJP2-A1', 'LV-A1', 'GK-ARSA1', 'S-A1'])(
    'marks all exact customer/unit siblings unknown when a payment code contradicts their LJ unit: %s',
    (conflictCode) => {
      const gbp = item('LJ-A1');
      const tl = item('LJ-A1', { currency: 'TL' }, conflictCode, 'other');
      const otherCustomer = item(
        'LJ-A1',
        { customerCode: 'C-2', currency: 'TL' },
        'KDV',
        'vat',
      );
      const otherUnit = item('LJ-A2');
      const whitespaceCustomer = item('LJ-A1', { customerCode: 'C-1 ' });
      const groups = paymentProjectGroups([
        gbp,
        tl,
        otherCustomer,
        otherUnit,
        whitespaceCustomer,
      ]);
      expect(groups.get(gbp.key)).toBe('UNKNOWN');
      expect(groups.get(tl.key)).toBe('UNKNOWN');
      for (const row of [otherCustomer, otherUnit, whitespaceCustomer])
        expect(groups.get(row.key)).toBe('LA_JOYA');
      const selected = list([gbp, tl], {
        paymentKind: 'sale',
        projectGroup: 'UNKNOWN',
      });
      expect(selected.rows.map((row) => row.key)).toEqual([gbp.key]);
      expect(selected.rows[0].outstanding).toBe(80);
    },
  );

  it('does not share conflicting project evidence across missing-customer identities', () => {
    const first = item('LJ-A1', { customerCode: null }, 'KDV', 'vat');
    const other = item(
      'LJ-A1',
      { customerCode: null, currency: 'TL' },
      'LJP-A1',
    );
    const groups = paymentProjectGroups([first, other]);
    expect(groups.get(first.key)).toBe('LA_JOYA');
    expect(groups.get(other.key)).toBe('UNKNOWN');
  });

  it('checks recognized project evidence carried only by an installment', () => {
    const row = item('LJ-A1');
    row.projects = [{ code: 'KDV', name: 'LA JOYA' }];
    row.installments[0].projectCode = 'LV-A1';
    expect(paymentProjectGroups([row]).get(row.key)).toBe('UNKNOWN');
  });
});

describe('Payment main-project filtering and response contract', () => {
  it('accepts only canonical project filters, while preserving legacy exact project codes', () => {
    expect(parsePaymentQuery({}).projectGroup).toBe('');
    for (const projectGroup of ['', ...PROJECT_TYPES, 'UNKNOWN'])
      expect(parsePaymentQuery({ projectGroup }).projectGroup).toBe(
        projectGroup,
      );
    for (const projectGroup of [
      'La Joya',
      'LJ',
      'LAJOYA',
      'ALL',
      'unknown',
      ' LA_JOYA',
      ['LA_JOYA'],
    ])
      expect(() => parsePaymentQuery({ projectGroup })).toThrow(
        BadRequestException,
      );
    expect(parsePaymentQuery({ project: 'KDV' }).project).toBe('KDV');
  });

  it('combines project, payment type, currency and legacy-code filters before summaries and pagination', () => {
    const sale = item('LJ-A1');
    const vat = item('LJ-A1', {}, 'KDV', 'vat', 30);
    const mixed: PaymentSourceCase = {
      ...sale,
      amount: 200,
      paid: 90,
      outstanding: 110,
      overdueAmount: 110,
      overdueCount: 2,
      installmentCount: 2,
      projects: [...sale.projects, ...vat.projects],
      installments: [
        sale.installments[0],
        { ...vat.installments[0], sequence: 2 },
      ],
    };
    const cases = [
      mixed,
      item('LJ-A1', { currency: 'TL' }, 'TRAFO', 'transformer', 50),
      item('LJP-A1', {}, 'KDV', 'vat', 60),
      item('LV-A1', {}, 'KDV', 'vat', 70),
    ];
    const before = structuredClone(cases);
    const result = list(cases, {
      projectGroup: 'LA_JOYA',
      paymentKind: 'vat',
      project: 'KDV',
    });
    expect(result).toMatchObject({
      selectedProjectGroup: 'LA_JOYA',
      selectedPaymentKind: 'vat',
      total: 1,
    });
    expect(result.rows[0]).toMatchObject({
      key: mixed.key,
      projectGroup: 'LA_JOYA',
      amount: 100,
      outstanding: 30,
    });
    expect(result.summary).toMatchObject({
      outstanding: 30,
      overdueAmount: 30,
      openCount: 1,
    });
    expect(result.filteredSummary).toMatchObject({
      outstanding: 30,
      overdueAmount: 30,
    });
    expect(result.projectGroups).toEqual([
      { value: 'LA_JOYA', label: PROJECT_LABELS.LA_JOYA, caseCount: 1 },
      {
        value: 'LA_JOYA_PERLA',
        label: PROJECT_LABELS.LA_JOYA_PERLA,
        caseCount: 1,
      },
      {
        value: 'LA_JOYA_PERLA_II',
        label: PROJECT_LABELS.LA_JOYA_PERLA_II,
        caseCount: 0,
      },
      {
        value: 'LAGOON_VERDE',
        label: PROJECT_LABELS.LAGOON_VERDE,
        caseCount: 1,
      },
      {
        value: 'GECITKALE_1_ETAP',
        label: PROJECT_LABELS.GECITKALE_1_ETAP,
        caseCount: 0,
      },
      { value: 'UNKNOWN', label: 'Belirsiz / Diğer', caseCount: 0 },
    ]);
    const tl = list(cases, {
      currency: 'TL',
      projectGroup: 'LA_JOYA',
      paymentKind: 'transformer',
    });
    expect(tl.total).toBe(1);
    expect(tl.rows[0].outstanding).toBe(50);
    expect(
      tl.projectGroups.reduce((sum, group) => sum + group.caseCount, 0),
    ).toBe(1);
    expect(
      list(cases, {
        projectGroup: 'LA_JOYA',
        paymentKind: 'vat',
        project: 'LJ-A1',
      }).total,
    ).toBe(0);
    expect(cases).toEqual(before);
  });

  it('keeps closure based on every currency/kind and counts only matching project cases', () => {
    const cases = [
      item('LJ-A1', {}, 'LJ-A1', 'sale', 0),
      item('LJ-A1', { currency: 'TL' }, 'KDV', 'vat', 50),
      item('LJ-A2', {}, 'LJ-A2', 'sale', 0),
      item('LJ-A2', { currency: 'TL' }, 'TRAFO', 'transformer', 0),
      item('LJP-A1', {}, 'LJP-A1', 'sale', 0),
    ];
    const closed = list(cases, {
      projectGroup: 'LA_JOYA',
      paymentKind: 'sale',
      scope: 'closed',
    });
    expect(closed.total).toBe(1);
    expect(closed.rows[0].identity.unitCode).toBe('LJ-A2');
    expect(closed.rows[0].fullyPaid).toBe(true);
    expect(closed.summary.closedCount).toBe(1);
    expect(closed.filteredSummary.closedCount).toBe(1);
    const paid = list(cases, {
      projectGroup: 'LA_JOYA',
      paymentKind: 'sale',
      scope: 'paid',
    });
    expect(paid.total).toBe(2);
    expect(
      paid.rows.find((row) => row.identity.unitCode === 'LJ-A1')?.fullyPaid,
    ).toBe(false);
  });

  it('partitions every visible currency case exactly once with no duplicate amounts or omitted unknowns', () => {
    const units = [
      'LJ-A1',
      'LJP-A1',
      'LJP2-A1',
      'LV-A1',
      'GK-ARSA1',
      'S-A1',
      null,
    ];
    const cases = units.flatMap((unit, index) => [
      item(
        unit,
        { customerCode: `C-${index}` },
        unit,
        unit?.startsWith('GK') ? 'land' : 'sale',
        index + 1,
      ),
      item(
        unit,
        { customerCode: `C-${index}`, currency: 'TL' },
        'KDV',
        'vat',
        index + 20,
      ),
    ]);
    for (const currency of ['GBP', 'TL']) {
      const complete = list(cases, { currency });
      const partitions = [...PROJECT_TYPES, 'UNKNOWN'].map((projectGroup) =>
        list(cases, { currency, projectGroup }),
      );
      const partitionKeys = partitions.flatMap((result) =>
        result.rows.map((row) => row.key),
      );
      expect(partitionKeys.sort()).toEqual(
        complete.rows.map((row) => row.key).sort(),
      );
      expect(new Set(partitionKeys).size).toBe(complete.total);
      expect(
        partitions.reduce(
          (sum, result) => sum + (result.filteredSummary.outstanding ?? 0),
          0,
        ),
      ).toBe(complete.filteredSummary.outstanding);
      expect(
        complete.projectGroups.reduce((sum, group) => sum + group.caseCount, 0),
      ).toBe(complete.total);
    }
  });

  it('includes zero-count options for an empty kind and computes project summaries before pagination', () => {
    const cases = Array.from({ length: 30 }, (_, index) =>
      item(`LJ-A${index + 1}`),
    );
    cases.push(item('LJP-A1'));
    const result = list(cases, { projectGroup: 'LA_JOYA', page: 2 });
    expect(result.rows).toHaveLength(5);
    expect(result.total).toBe(30);
    expect(result.summary.outstanding).toBe(2400);
    expect(
      result.projectGroups.find((group) => group.value === 'LA_JOYA')
        ?.caseCount,
    ).toBe(30);
    const empty = list(cases, { paymentKind: 'deposit' });
    expect(empty.total).toBe(0);
    expect(empty.projectGroups).toHaveLength(6);
    expect(empty.projectGroups.every((group) => group.caseCount === 0)).toBe(
      true,
    );
  });

  it('adds project groups to detail and POST portfolio rows without changing selected keys or actions', async () => {
    const cases = [
      item('LJP2-A1'),
      item('LJP2-A1', { currency: 'TL' }, 'KDV', 'vat'),
    ];
    const source = {
      snapshot: jest.fn().mockResolvedValue(snapshot(cases)),
      contact: jest.fn().mockResolvedValue({
        status: 'missing',
        email: null,
        phone: null,
        source: null,
      }),
    };
    const store = {
      getMany: jest.fn().mockResolvedValue([]),
      history: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      assignables: jest.fn().mockResolvedValue([]),
      apply: jest.fn().mockResolvedValue(null),
    };
    const service = new PaymentTrackingService(
      source as unknown as PaymentTrackingSourceService,
      store as unknown as PaymentTrackingStoreService,
    );
    const before = structuredClone(cases);
    const detail = await service.detail(cases[0].key);
    expect(detail.item.projectGroup).toBe('LA_JOYA_PERLA_II');
    expect(detail.portfolio.cases.map((row) => row.projectGroup)).toEqual([
      'LA_JOYA_PERLA_II',
      'LA_JOYA_PERLA_II',
    ]);
    const action = {
      type: 'note',
      expectedVersion: 0,
      body: 'Synthetic project note',
    };
    const updated = await service.action(cases[0].key, action, actor);
    expect(updated.item.projectGroup).toBe('LA_JOYA_PERLA_II');
    expect(updated.portfolio.cases.map((row) => row.projectGroup)).toEqual([
      'LA_JOYA_PERLA_II',
      'LA_JOYA_PERLA_II',
    ]);
    expect(store.apply).toHaveBeenCalledWith({
      key: cases[0].key,
      sourceIdentity: cases[0].identity,
      actor,
      ...action,
    });
    expect(cases).toEqual(before);
  });
});
