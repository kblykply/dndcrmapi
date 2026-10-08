import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { PROJECT_TYPES } from '../src/common/projects';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import {
  parsePaymentQuery,
  paymentList,
} from '../src/payment-tracking/payment-tracking.service';
import type {
  PaymentSourceSnapshot,
  PaymentTrackingRow,
  PaymentTrackingSummary,
} from '../src/payment-tracking/payment-tracking.types';

// One read-only live source snapshot; every filter combination runs in memory.
// Nothing persists besides counts, check outcomes and timing metadata.
const output = resolve(
  __dirname,
  '../../output/payment-all-currencies-2026-10-02/source-audit.json',
);
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  mode: 'ONE_SELECT_ONLY_SOURCE_SNAPSHOT_NO_WORKFLOW_OR_OUTBOUND_ACTIONS',
  privacy:
    'No identities, names, filter values from source, or amounts persisted',
};
function persist() {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
}
function check(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${name}`);
}
const actor = { id: 'synthetic-readonly-auditor', role: 'ACCOUNTING' };
const moneyFields = [
  'outstanding',
  'overdueAmount',
  'actionableAmount',
] as const;
type MoneyField = (typeof moneyFields)[number];
const countFields: Array<Exclude<keyof PaymentTrackingSummary, MoneyField>> = [
  'closedCount',
  'openCount',
  'overdueCount',
  'actionableCount',
  'deferredCount',
  'todayCount',
  'unassignedCount',
  'incompleteRows',
];
const sourceMoneyFields = [
  'amount',
  'paid',
  'outstanding',
  'overdueAmount',
  'dueTodayAmount',
] as const;
function sameSummary(
  actual: PaymentTrackingSummary,
  expected: PaymentTrackingSummary,
) {
  for (const field of countFields)
    check(
      actual[field] === expected[field],
      'per-currency summary counts equal standalone query',
    );
  for (const field of moneyFields) {
    const left = actual[field],
      right = expected[field];
    check(
      left === null || right === null
        ? left === right
        : Number.isFinite(left) &&
            Number.isFinite(right) &&
            Math.abs(left - right) <=
              Math.max(0.000001, Math.abs(right) * 1e-10),
      'per-currency summary money and null semantics equal standalone query',
    );
  }
}
function completeList(
  snapshot: PaymentSourceSnapshot,
  raw: Record<string, unknown>,
) {
  const first = paymentList(snapshot, [], actor, {
    scope: 'all',
    ...raw,
    pageSize: 100,
    page: 1,
  });
  const rows = [...first.rows];
  for (let page = 2; page <= first.totalPages; page++) {
    const next = paymentList(snapshot, [], actor, {
      scope: 'all',
      ...raw,
      pageSize: 100,
      page,
    });
    check(
      next.total === first.total && next.page === page,
      'pagination count and requested page stable',
    );
    rows.push(...next.rows);
  }
  check(
    rows.length === first.total &&
      new Set(rows.map((row) => row.key)).size === rows.length,
    'pagination has complete unique case keys',
  );
  return { first, rows };
}
function compareRows(
  actual: PaymentTrackingRow[],
  expected: PaymentTrackingRow[],
) {
  const expectedMap = new Map(expected.map((row) => [row.key, row]));
  check(
    actual.length === expected.length,
    'all-currency filtered row count equals currency union',
  );
  for (const row of actual) {
    const single = expectedMap.get(row.key);
    check(single, 'all-currency preserves exact case keys');
    check(
      JSON.stringify(row.identity) === JSON.stringify(single.identity),
      'all-currency preserves exact source identity',
    );
    for (const field of sourceMoneyFields)
      check(
        row[field] === single[field],
        'per-case financial values unchanged',
      );
    check(
      row.installmentCount === single.installmentCount &&
        row.incompleteRows === single.incompleteRows &&
        row.fullyPaid === single.fullyPaid &&
        row.projectGroup === single.projectGroup,
      'per-case source counts, full closure and project unchanged',
    );
  }
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
  let stage = 'read_one_source_snapshot';
  try {
    const snapshot = await source.snapshot(true);
    report.sourceReadMs = Date.now() - started;
    report.sourceRows = snapshot.recordCount;
    report.currencyCases = snapshot.cases.length;
    report.asOf = snapshot.asOf;
    const currencies = [
      ...new Set(snapshot.cases.map((row) => row.identity.currency)),
    ];
    const reps = [
      ...new Set(snapshot.cases.flatMap((row) => row.representatives)),
    ];
    report.currencyCount = currencies.length;
    report.exactCustomerUnitGroups = new Set(
      snapshot.cases.map((row) =>
        JSON.stringify([row.identity.customerCode, row.identity.unitCode]),
      ),
    ).size;
    stage = 'all_currency_partition_and_summaries';
    const scenarios: Array<Record<string, unknown>> = [];
    const kinds = [
      'all',
      'sale',
      'land',
      'vat',
      'transformer',
      'furniture',
      'deposit',
      'other',
    ];
    const scopes = [
      'all',
      'actionable',
      'open',
      'overdue',
      'today',
      'upcoming',
      'paid',
      'closed',
    ];
    for (const paymentKind of kinds)
      for (const scope of scopes) scenarios.push({ paymentKind, scope });
    for (const projectGroup of [...PROJECT_TYPES, 'UNKNOWN'])
      for (const paymentKind of kinds)
        scenarios.push({
          projectGroup,
          paymentKind,
          authorizationState: 'blank',
          scope: 'overdue',
        });
    for (const representative of reps)
      for (const scope of ['all', 'overdue', 'closed'])
        scenarios.push({
          representative,
          scope,
          authorizationState: 'blank',
          paymentKind: 'all',
        });
    for (const authorizationState of [
      'all',
      'blank',
      'coded',
      'mixed',
      'unmatched',
      'multiple',
    ])
      scenarios.push({ authorizationState, paymentKind: 'sale', scope: 'all' });
    scenarios.push(
      { overdueDaysMin: '1', scope: 'overdue' },
      {
        overdueDaysMin: '31',
        overdueDaysMax: '365',
        paymentKind: 'sale',
        authorizationState: 'blank',
      },
      { dueTo: snapshot.asOf, scope: 'all' },
      { dueFrom: snapshot.asOf, scope: 'all' },
      { paymentState: 'unknown', dataQuality: 'incomplete' },
      { trackingRecord: 'none', assignee: 'unassigned' },
      { q: '__audit_no_matching_text__' },
    );
    let combinationsVerified = 0,
      paginatedCombinations = 0;
    for (const query of scenarios) {
      const all = completeList(snapshot, { ...query, currency: '__ALL__' });
      // Runtime access keeps this verifier runnable while DTO edits are in flight.
      const response = all.first as typeof all.first & {
        currencyMode: string;
        currencyBreakdown: Array<{
          currency: string | null;
          total: number;
          summary: PaymentTrackingSummary;
          filteredSummary: PaymentTrackingSummary;
        }>;
      };
      check(
        response.currencyMode === 'all' && response.selectedCurrency === null,
        'explicit all-currency response contract',
      );
      check(
        Array.isArray(response.currencyBreakdown),
        'currency breakdown exists',
      );
      check(
        response.currencyBreakdown.length === currencies.length &&
          new Set(response.currencyBreakdown.map((entry) => entry.currency))
            .size === currencies.length,
        'one breakdown for every source currency',
      );
      for (const summary of [response.summary, response.filteredSummary])
        for (const field of moneyFields)
          check(
            summary[field] === null,
            'all-currency upper summary never mixes monetary amounts',
          );
      const singles = currencies.map((currency) =>
        completeList(snapshot, { ...query, currency: currency ?? '__NULL__' }),
      );
      compareRows(
        all.rows,
        singles.flatMap((single) => single.rows),
      );
      for (let i = 0; i < currencies.length; i++) {
        const single = singles[i].first;
        const entry = response.currencyBreakdown.find(
          (value) => value.currency === currencies[i],
        );
        check(
          entry && entry.total === single.total,
          'per-currency filtered totals equal standalone query',
        );
        sameSummary(entry.summary, single.summary);
        sameSummary(entry.filteredSummary, single.filteredSummary);
      }
      for (const field of countFields) {
        check(
          response.summary[field] ===
            singles.reduce(
              (total, single) => total + single.first.summary[field],
              0,
            ),
          'all-currency scope-navigation counts equal currency partition sum',
        );
        check(
          response.filteredSummary[field] ===
            singles.reduce(
              (total, single) => total + single.first.filteredSummary[field],
              0,
            ),
          'all-currency filtered counts equal currency partition sum',
        );
      }
      if (all.first.totalPages > 1) paginatedCombinations++;
      combinationsVerified++;
    }
    report.partitionCombinationsVerified = combinationsVerified;
    report.paginatedCombinationsVerified = paginatedCombinations;
    stage = 'money_filter_rejection_and_currency_order';
    let rejectedMoneyRanges = 0;
    for (const field of [
      'balanceMin',
      'balanceMax',
      'overdueAmountMin',
      'overdueAmountMax',
    ]) {
      let rejected = false;
      try {
        paymentList(snapshot, [], actor, { currency: '__ALL__', [field]: '0' });
      } catch (error) {
        rejected =
          typeof (error as { getStatus?: () => number }).getStatus ===
            'function' &&
          (error as { getStatus: () => number }).getStatus() === 400;
      }
      check(
        rejected,
        'mixed-currency monetary range rejected with client validation error',
      );
      rejectedMoneyRanges++;
    }
    const days = parsePaymentQuery({
      currency: '__ALL__',
      overdueDaysMin: '0',
      overdueDaysMax: '365',
    });
    check(
      days.overdueDaysMin === 0 && days.overdueDaysMax === 365,
      'day filters remain available across currencies',
    );
    let sortCombinationsVerified = 0;
    for (const sortBy of ['amount', 'paid', 'outstanding', 'overdueAmount'])
      for (const sortDir of ['asc', 'desc'])
        for (const scope of ['all', 'open']) {
          const all = completeList(snapshot, {
            currency: '__ALL__',
            paymentKind: 'all',
            sortBy,
            sortDir,
            scope,
          });
          for (let index = 1; index < all.rows.length; index++) {
            const left = all.rows[index - 1],
              right = all.rows[index];
            if (scope === 'all' && left.fullyPaid !== right.fullyPaid) {
              check(
                !left.fullyPaid && right.fullyPaid,
                'fully closed portfolios stay last in all scope',
              );
              continue;
            }
            const currencyOrder =
              left.identity.currency === right.identity.currency
                ? 0
                : left.identity.currency === null
                  ? 1
                  : right.identity.currency === null
                    ? -1
                    : left.identity.currency.localeCompare(
                        right.identity.currency,
                        'en',
                      );
            check(
              currencyOrder <= 0,
              'money sorting groups currencies ascending before comparing amounts',
            );
            if (currencyOrder !== 0) continue;
            const a = left[sortBy as (typeof sourceMoneyFields)[number]],
              b = right[sortBy as (typeof sourceMoneyFields)[number]];
            if (a === null || b === null)
              check(
                a !== null || b === null,
                'unknown amount ordered after known amount',
              );
            else
              check(
                sortDir === 'asc' ? a <= b : a >= b,
                'money sorted only within the same currency and closure partition',
              );
          }
          sortCombinationsVerified++;
        }
    report.rejectedMoneyRangeChecks = rejectedMoneyRanges;
    report.moneySortCombinationsVerified = sortCombinationsVerified;
    report.verification = {
      completeExactCaseUnionAndPagination: 'PASS',
      perCurrencyMoneyAndCountsEqualStandaloneQueries: 'PASS',
      upperMoneyNullAndCountsPartitioned: 'PASS',
      projectKindAuthorizationRepresentativeScopeIntersections: 'PASS',
      moneyRangesRejectedDayRangesAllowed: 'PASS',
      moneySortingWithinAscendingCurrencyGroupsAndClosedLast: 'PASS',
    };
    report.status = 'PASS';
    report.elapsedMs = Date.now() - started;
    persist();
    console.log(
      JSON.stringify({
        status: report.status,
        sourceRows: snapshot.recordCount,
        currencyCases: snapshot.cases.length,
        combinationsVerified,
        sortCombinationsVerified,
        elapsedMs: report.elapsedMs,
      }),
    );
  } catch (error) {
    report.status = 'FAIL';
    report.failedStage = stage;
    report.reason =
      error instanceof Error && error.message.startsWith('Verification failed:')
        ? error.message
        : 'Read-only verification unavailable; error details intentionally omitted';
    report.elapsedMs = Date.now() - started;
    persist();
    console.error(
      JSON.stringify({ status: report.status, stage, reason: report.reason }),
    );
    process.exitCode = 1;
  } finally {
    source.onModuleDestroy();
    await database.onModuleDestroy();
  }
}
void main();
