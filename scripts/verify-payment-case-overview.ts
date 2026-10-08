import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import {
  PaymentTrackingService,
  paymentList,
} from '../src/payment-tracking/payment-tracking.service';
import { PaymentTrackingStoreService } from '../src/payment-tracking/payment-tracking-store.service';
import type { PaymentSourceCase } from '../src/payment-tracking/payment-tracking.types';

type SqlCase = Record<string, unknown> & {
  customerCode: string | null;
  unitCode: string | null;
  currency: string | null;
  records: number;
  incompleteFinancialRows: number;
  hasPositiveOutstanding: number;
};
const output = resolve(
  __dirname,
  '../../output/payment-case-overview-2026-10-02/source-audit.json',
);
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  mode: 'READ_ONLY_SELECT_NO_WORKFLOW_DATABASE',
  source: 'LOGO_DND.dbo.L_223_ODEME_PLANI',
  identityRule:
    'Exact customerCode + unitCode; no trimming, case folding or fuzzy join',
  closureRule:
    'Every currency case has finite amount/paid, a nonblank currency, outstanding === 0 and incompleteRows === 0 across every payment kind',
  consistency: 'Sequential live reads; no historical or atomic snapshot claim',
  status: 'RUNNING',
};
function persist() {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
}
function check(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${name}`);
}
const pair = (item: PaymentSourceCase) =>
  JSON.stringify([item.identity.customerCode, item.identity.unitCode]);
const completePaid = (item: PaymentSourceCase) =>
  !!item.identity.currency?.trim() &&
  Number.isFinite(item.amount) &&
  Number.isFinite(item.paid) &&
  item.outstanding === 0 &&
  item.incompleteRows === 0;
const masked = (type: string, value: string | null) =>
  value === null
    ? `${type}:missing`
    : `${type}:***${createHash('sha256').update(value).digest('hex').slice(0, 8)}`;
function kinds(items: PaymentSourceCase[]) {
  return [
    ...new Set(
      items.flatMap((item) =>
        item.installments.map((line) => line.paymentKind),
      ),
    ),
  ].sort();
}
function example(items: PaymentSourceCase[]) {
  return {
    customer: masked('customer', items[0].identity.customerCode),
    unit: masked('unit', items[0].identity.unitCode),
    fullyClosed: items.every(completePaid),
    currencies: items.map((item) => ({
      currency: item.identity.currency,
      sourceRows: item.installmentCount,
      paymentKinds: kinds([item]),
      state: completePaid(item)
        ? 'paid'
        : (item.outstanding ?? 0) > 0
          ? 'open'
          : 'incomplete',
    })),
  };
}

async function main() {
  const settings = {
    ...parse(readFileSync(resolve(__dirname, '../.env'))),
    ...process.env,
  };
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const source = new PaymentTrackingSourceService(
    database,
    new PaymentTrackingCatalogService(database),
  );
  const started = Date.now();
  let stage = 'source';
  try {
    const snapshot = await source.snapshot(true);
    report.sourceReadMs = Date.now() - started;
    report.asOf = snapshot.asOf;
    report.sourceRows = snapshot.recordCount;
    report.currencyCases = snapshot.cases.length;
    stage = 'independent_sql';
    const sqlStarted = Date.now();
    const sqlCases = await database.query<SqlCase>(
      `SELECT [CARİ KOD] AS [customerCode], [DAİRE] AS [unitCode], [DVZ] AS [currency],
       COUNT(*) AS [records],
       SUM(CASE WHEN [TUTAR] IS NULL OR [ODENEN] IS NULL OR [VADE] IS NULL THEN 1 ELSE 0 END) AS [incompleteFinancialRows],
       MAX(CASE WHEN [TUTAR] IS NOT NULL AND [ODENEN] IS NOT NULL AND [TUTAR]-[ODENEN]>0 THEN 1 ELSE 0 END) AS [hasPositiveOutstanding]
       FROM [LOGO_DND].[dbo].[L_223_ODEME_PLANI]
       GROUP BY [CARİ KOD], CONVERT(varbinary(max), [CARİ KOD]), [DAİRE], CONVERT(varbinary(max), [DAİRE]), [DVZ], CONVERT(varbinary(max), [DVZ])`,
    );
    report.independentSqlMs = Date.now() - sqlStarted;
    const oracle = new Map(
      sqlCases.map((item) => [
        JSON.stringify([item.customerCode, item.unitCode, item.currency]),
        item,
      ]),
    );
    check(sqlCases.length === snapshot.cases.length, 'case count');
    check(
      sqlCases.reduce((sum, item) => sum + item.records, 0) ===
        snapshot.recordCount,
      'source row count',
    );
    for (const item of snapshot.cases) {
      const { customerCode, unitCode, currency } = item.identity;
      const sql = oracle.get(
        JSON.stringify([customerCode, unitCode, currency]),
      );
      check(sql, 'exact case identity');
      check(sql.records === item.installmentCount, 'case row count');
      const incompleteRows = currency?.trim()
        ? sql.incompleteFinancialRows
        : sql.records;
      check(incompleteRows === item.incompleteRows, 'case completeness');
      check(
        (sql.hasPositiveOutstanding === 1) === (item.outstanding ?? 0) > 0,
        'case open state',
      );
      check(
        (sql.hasPositiveOutstanding === 0 && incompleteRows === 0) ===
          completePaid(item),
        'case paid state',
      );
    }
    report.independentSqlValidation = 'PASS';
    stage = 'exact_groups';
    const groups = new Map<string, PaymentSourceCase[]>();
    const byCustomer = new Map<string | null, PaymentSourceCase[]>();
    const byUnit = new Map<string | null, PaymentSourceCase[]>();
    for (const item of snapshot.cases) {
      const siblings = groups.get(pair(item)) ?? [];
      siblings.push(item);
      groups.set(pair(item), siblings);
      const customer = byCustomer.get(item.identity.customerCode) ?? [];
      customer.push(item);
      byCustomer.set(item.identity.customerCode, customer);
      const unit = byUnit.get(item.identity.unitCode) ?? [];
      unit.push(item);
      byUnit.set(item.identity.unitCode, unit);
    }
    const entities = [...groups.values()];
    const multiCurrency = entities.filter((items) => items.length > 1);
    const currencyCombinations = new Map<string, number>();
    for (const items of multiCurrency) {
      const key = JSON.stringify(
        items.map((item) => item.identity.currency).sort(),
      );
      currencyCombinations.set(key, (currencyCombinations.get(key) ?? 0) + 1);
    }
    const fullyClosed = entities.filter((items) => items.every(completePaid));
    const open = entities.filter((items) =>
      items.some((item) => (item.outstanding ?? 0) > 0),
    );
    const unresolved = entities.filter(
      (items) =>
        !items.every(completePaid) &&
        !items.some((item) => (item.outstanding ?? 0) > 0),
    );
    check(
      fullyClosed.length + open.length + unresolved.length === entities.length,
      'entity state partition',
    );
    report.entityGroups = entities.length;
    report.groupsWithMissingCustomerOrUnit = entities.filter(
      ([item]) =>
        !item.identity.customerCode?.trim() || !item.identity.unitCode?.trim(),
    ).length;
    report.multiCurrencyGroups = multiCurrency.length;
    report.currencyCombinations = [...currencyCombinations].map(
      ([key, groups]) => ({ currencies: JSON.parse(key), groups }),
    );
    report.fullyClosedGroups = fullyClosed.length;
    report.groupsWithKnownOutstanding = open.length;
    report.groupsWithoutKnownOutstandingButIncomplete = unresolved.length;
    report.groupsWithIncompleteRows = entities.filter((items) =>
      items.some((item) => item.incompleteRows > 0),
    ).length;
    report.paidCurrencyCases = snapshot.cases.filter(completePaid).length;
    report.paidCurrencyCasesInsideUnclosedGroups = entities
      .filter((items) => !items.every(completePaid))
      .reduce((sum, items) => sum + items.filter(completePaid).length, 0);
    report.fullyClosedMultiCurrencyGroups = multiCurrency.filter((items) =>
      items.every(completePaid),
    ).length;
    report.multiCurrencyGroupsWithMixedPaidAndOpenCases = multiCurrency.filter(
      (items) =>
        items.some(completePaid) &&
        items.some((item) => (item.outstanding ?? 0) > 0),
    ).length;
    report.multiCurrencyGroupsContainingTL = multiCurrency.filter((items) =>
      items.some((item) => item.identity.currency === 'TL'),
    ).length;
    report.multiCurrencyExamples = multiCurrency.slice(0, 8).map(example);

    stage = 'closed_list_and_portfolio';
    const actor = { id: 'read-only-portfolio-verifier', role: 'ADMIN' };
    const closedGroupKeys = new Set(fullyClosed.map(([item]) => pair(item)));
    const actualClosedGroups = new Set<string>();
    let actualClosedCurrencyCases = 0;
    const closedLists: Array<Record<string, unknown>> = [];
    const currencies = [
      ...new Set(snapshot.cases.map((item) => item.identity.currency)),
    ];
    for (const currency of currencies) {
      const raw = {
        currency: currency ?? '__NULL__',
        scope: 'closed',
        paymentKind: 'all',
        pageSize: 100,
      };
      const first = paymentList(snapshot, [], actor, raw);
      const rows = [...first.rows];
      for (let page = 2; page <= first.totalPages; page++)
        rows.push(...paymentList(snapshot, [], actor, { ...raw, page }).rows);
      check(rows.length === first.total, 'closed list pagination');
      const expectedCases = fullyClosed
        .flat()
        .filter((item) => item.identity.currency === currency);
      const expectedKeys = new Set(expectedCases.map((item) => item.key));
      check(
        rows.length === expectedKeys.size,
        'closed list currency case count',
      );
      for (const row of rows) {
        check(
          expectedKeys.has(row.key),
          'closed list excludes paid siblings of open portfolios',
        );
        check(row.fullyPaid === true, 'closed list flag');
        actualClosedGroups.add(
          JSON.stringify([row.identity.customerCode, row.identity.unitCode]),
        );
      }
      actualClosedCurrencyCases += rows.length;
      closedLists.push({
        currency,
        currencyCases: rows.length,
        pages: first.totalPages,
        status: 'PASS',
      });
    }
    check(
      actualClosedGroups.size === closedGroupKeys.size &&
        [...closedGroupKeys].every((key) => actualClosedGroups.has(key)),
      'closed scope exact entity union',
    );
    report.productionClosedLists = closedLists;
    report.productionClosedGroupUnion = actualClosedGroups.size;
    report.productionClosedCurrencyCases = actualClosedCurrencyCases;

    let workflowKeys: string[] = [];
    const service = new PaymentTrackingService(
      {
        snapshot: async () => snapshot,
        contact: async () => ({
          email: null,
          phone: null,
          source: null,
          status: 'missing',
        }),
      } as unknown as PaymentTrackingSourceService,
      {
        getMany: async (keys: string[]) => {
          workflowKeys = keys;
          return [];
        },
        history: async () => ({ items: [], hasMore: false }),
        assignables: async () => [],
      } as unknown as PaymentTrackingStoreService,
    );
    const detailSamples = multiCurrency.slice(0, 1);
    const tlSample = multiCurrency.find((items) =>
      items.some((item) => item.identity.currency === 'TL'),
    );
    if (tlSample && !detailSamples.includes(tlSample))
      detailSamples.push(tlSample);
    const detailChecks: Array<Record<string, unknown>> = [];
    for (const expected of detailSamples) {
      const detail = await service.detail(expected[0].key);
      const expectedKeys = new Set(expected.map((item) => item.key));
      check(
        detail.portfolio.cases.length === expectedKeys.size &&
          detail.portfolio.cases.every((item) => expectedKeys.has(item.key)),
        'detail contains every exact sibling currency case',
      );
      check(
        workflowKeys.length === expectedKeys.size &&
          workflowKeys.every((key) => expectedKeys.has(key)),
        'workflow uses the original sibling case keys',
      );
      check(
        detail.portfolio.fullyPaid === expected.every(completePaid),
        'detail full closure',
      );
      check(
        detail.portfolio.installments.length ===
          expected.reduce((sum, item) => sum + item.installmentCount, 0),
        'detail contains every source line',
      );
      for (const item of expected) {
        const actual = detail.portfolio.installments.filter(
          (line) => line.caseKey === item.key,
        );
        check(
          actual.every((line) => line.currency === item.identity.currency),
          'detail lines preserve currency',
        );
        const originalShape = actual.map(
          ({ caseKey: _caseKey, currency: _currency, ...line }) => line,
        );
        check(
          JSON.stringify(originalShape) === JSON.stringify(item.installments),
          'detail lines preserve kinds and every financial source value',
        );
      }
      detailChecks.push({
        currencies: expected.map((item) => item.identity.currency).sort(),
        currencyCases: expected.length,
        sourceRows: detail.portfolio.installments.length,
        paymentKinds: kinds(expected),
        status: 'PASS',
      });
    }
    report.productionPortfolioDetails = detailChecks;
    report.productionScopeAndDetailValidation = 'PASS';

    stage = 'identity_limits';
    const specialKinds = [
      'vat',
      'transformer',
      'deposit',
      'furniture',
    ] as const;
    report.kindCoverage = specialKinds.map((kind) => {
      const selected = entities.filter((items) => kinds(items).includes(kind));
      return {
        paymentKind: kind,
        groups: selected.length,
        groupsWithSaleOrLandInSameExactPair: selected.filter((items) =>
          kinds(items).some((value) => value === 'sale' || value === 'land'),
        ).length,
        groupsWithoutSaleOrLandInSameExactPair: selected.filter(
          (items) =>
            !kinds(items).some((value) => value === 'sale' || value === 'land'),
        ).length,
        multiCurrencyGroups: selected.filter((items) => items.length > 1)
          .length,
        alternateUnitUnderSameExactCustomer: selected.filter(
          ([item]) =>
            item.identity.customerCode &&
            (byCustomer.get(item.identity.customerCode) ?? []).some(
              (other) => other.identity.unitCode !== item.identity.unitCode,
            ),
        ).length,
        alternateCustomerUnderSameExactUnit: selected.filter(
          ([item]) =>
            item.identity.unitCode &&
            (byUnit.get(item.identity.unitCode) ?? []).some(
              (other) =>
                other.identity.customerCode !== item.identity.customerCode,
            ),
        ).length,
      };
    });
    report.customersWithMultipleUnits = [...byCustomer].filter(
      ([key, items]) =>
        key && new Set(items.map((item) => item.identity.unitCode)).size > 1,
    ).length;
    report.unitsWithMultipleCustomerCodes = [...byUnit].filter(
      ([key, items]) =>
        key &&
        new Set(items.map((item) => item.identity.customerCode)).size > 1,
    ).length;
    const deposit = entities.filter((items) =>
      kinds(items).includes('deposit'),
    );
    report.depositIdentityEvidence = {
      groups: deposit.length,
      groupsWhoseUnitCodeExplicitlySaysDeposit: deposit.filter(([item]) =>
        /DEPOZ/i.test(item.identity.unitCode ?? ''),
      ).length,
      examples: deposit.slice(0, 6).map(example),
    };
    report.scopeLimit =
      'Only exact codes establish membership. Other customer/unit codes may represent separate charges, separate owners or separate property; name matching or prefix stripping is not sufficient proof.';
    report.validationRecommendations = [
      'Build related currency cases from the complete unfiltered source snapshot using the exact customer and unit pair.',
      'Keep currency sections and original case keys separate; do not add different currencies or move workflow records.',
      'Determine fully paid status from all kinds and all currency cases before applying a kind/currency list filter.',
      'Keep incomplete groups outside the fully paid section.',
      'Require an explicit source relation or reviewed mapping for postings under different customer or unit codes.',
    ];
    report.status = 'PASS';
    report.totalMs = Date.now() - started;
    report.completedAt = new Date().toISOString();
    persist();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = 'FAIL';
    report.failedStage = stage;
    if (
      error instanceof Error &&
      error.message.startsWith('Verification failed:')
    )
      report.failedCheck = error.message;
    report.totalMs = Date.now() - started;
    persist();
    console.error(JSON.stringify({ status: 'FAIL', stage, output }));
    process.exitCode = 1;
  } finally {
    source.onModuleDestroy();
    await database.onModuleDestroy();
  }
}

void main();
