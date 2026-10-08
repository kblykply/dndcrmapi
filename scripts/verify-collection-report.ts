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
import { paymentProjectGroups } from '../src/payment-tracking/payment-tracking-project';
import { buildCollectionReport } from '../src/payment-tracking/payment-collection-report.service';
import type {
  CollectionTotals,
  PaymentCollectionReport,
} from '../src/payment-tracking/payment-collection-report.types';
import type {
  PaymentInstallment,
  PaymentSourceCase,
  PaymentSourceSnapshot,
} from '../src/payment-tracking/payment-tracking.types';

// One SELECT-only snapshot, no workflow database or outbound messaging. Monthly
// aggregation, calendar arithmetic, authorizations, and detail grouping below
// are independent from production report helpers. The already-audited project
// classifier is reused only for the canonical project identity dimension.
const output = resolve(
  __dirname,
  '../../output/collection-report-2026-10-02/source-audit.json',
);
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  mode: 'ONE_SELECT_ONLY_SOURCE_SNAPSHOT_ALL_REPORT_COMBINATIONS_IN_MEMORY',
  privacy:
    'No customer identities, representative values, financial amounts or source rows persisted',
  basis:
    'Original source due date; paidToDate is allocation to those installments, never cash received during that month',
  independence:
    'Independent line-level calendar/financial/filter/detail oracle; only canonical project identity reuses paymentProjectGroups',
};
function persist() {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
}
function check(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${name}`);
}
const moneyFields = [
  'scheduled',
  'paidToDate',
  'outstanding',
  'overdue',
] as const;
const countFields = [
  'caseCount',
  'installmentCount',
  'incompleteRows',
] as const;
function knownSum(values: Array<number | null>): number | null {
  if (!values.length) return 0;
  const known = values.filter((value): value is number => value !== null);
  check(known.every(Number.isFinite), 'finite known source money');
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}
function sameMoney(actual: number | null, expected: number | null) {
  check(
    actual === null || expected === null
      ? actual === expected
      : Number.isFinite(actual) &&
          Math.abs(actual - expected) <=
            Math.max(0.000001, Math.abs(expected) * 1e-10),
    'line-level money and known/null sum semantics',
  );
}
function sameTotals(actual: CollectionTotals, expected: CollectionTotals) {
  for (const field of moneyFields) sameMoney(actual[field], expected[field]);
  for (const field of countFields)
    check(
      actual[field] === expected[field],
      'exact distinct-case, installment and incomplete counts',
    );
}
function shiftMonth(value: string, offset: number): string {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1, 12))
    .toISOString()
    .slice(0, 7);
}
function authorized(item: PaymentSourceCase, state: string): boolean {
  const { codes, hasBlank, status } = item.authorization;
  if (state === 'all') return true;
  if (state === 'blank')
    return status === 'matched' && hasBlank && codes.length === 0;
  if (state === 'coded') return codes.length > 0;
  if (state === 'mixed')
    return status === 'matched' && hasBlank && codes.length > 0;
  if (state === 'multiple') return codes.length > 1;
  return status === 'unmatched';
}
type Line = { item: PaymentSourceCase; row: PaymentInstallment };
function remaining(row: PaymentInstallment): number | null {
  return row.amount === null || row.paid === null
    ? null
    : Math.max(row.amount - row.paid, 0);
}
function sumLines(lines: Line[], asOf: string): CollectionTotals {
  const balances = lines.map(({ row }) => remaining(row));
  const overdue = lines.map(({ row }, index) => {
    const value = balances[index];
    if (value === 0) return 0;
    if (row.dueDate === null) return null;
    return row.dueDate < asOf ? value : 0;
  });
  return {
    scheduled: knownSum(lines.map(({ row }) => row.amount)),
    paidToDate: knownSum(lines.map(({ row }) => row.paid)),
    outstanding: knownSum(balances),
    overdue: knownSum(overdue),
    caseCount: new Set(lines.map(({ item }) => item.key)).size,
    installmentCount: lines.length,
    incompleteRows: lines.filter(
      ({ item, row }) =>
        row.amount === null ||
        row.paid === null ||
        row.dueDate === null ||
        !item.identity.currency?.trim(),
    ).length,
  };
}
type Query = Record<string, string | number>;
function expectedLines(
  snapshot: PaymentSourceSnapshot,
  raw: Query,
  selectedCurrency: string | null,
  projectByKey: Map<string, string>,
): Line[] {
  return snapshot.cases.flatMap((item): Line[] => {
    if (
      raw.currency !== '__ALL__' &&
      item.identity.currency !== selectedCurrency
    )
      return [];
    if (raw.projectGroup && projectByKey.get(item.key) !== raw.projectGroup)
      return [];
    if (
      raw.representative &&
      !item.representatives.includes(String(raw.representative))
    )
      return [];
    if (!authorized(item, String(raw.authorizationState ?? 'blank'))) return [];
    const kind = raw.paymentKind ?? 'sale';
    return item.installments
      .filter((row) => kind === 'all' || row.paymentKind === kind)
      .map((row) => ({ item, row }));
  });
}
function dateMonth(line: Line) {
  return line.row.dueDate?.slice(0, 7) ?? null;
}
function verifyBuckets(
  actual: PaymentCollectionReport['byCurrency'][number],
  lines: Line[],
  asOf: string,
  periods: string[],
) {
  const currentNext = shiftMonth(asOf.slice(0, 7), 1);
  const buckets = new Map<string, Line[]>();
  for (const line of lines) {
    const month = dateMonth(line);
    const key =
      month === null
        ? 'undated'
        : month < periods[0]
          ? 'before'
          : month > periods.at(-1)!
            ? 'after'
            : month;
    const bucket = buckets.get(key) ?? [];
    bucket.push(line);
    buckets.set(key, bucket);
  }
  sameTotals(actual.summary, sumLines(lines, asOf));
  sameTotals(actual.undated, sumLines(buckets.get('undated') ?? [], asOf));
  sameTotals(actual.beforeWindow, sumLines(buckets.get('before') ?? [], asOf));
  sameTotals(actual.afterWindow, sumLines(buckets.get('after') ?? [], asOf));
  sameTotals(
    actual.overdue,
    sumLines(
      lines.filter(
        ({ row }) =>
          row.dueDate !== null &&
          row.dueDate < asOf &&
          (remaining(row) === null || remaining(row)! > 0),
      ),
      asOf,
    ),
  );
  sameTotals(
    actual.nextMonth,
    sumLines(
      lines.filter((line) => dateMonth(line) === currentNext),
      asOf,
    ),
  );
  check(
    actual.monthly.length === periods.length,
    'complete period cells including empty months',
  );
  actual.monthly.forEach((cell, index) => {
    check(
      cell.month === periods[index],
      'chronological civil-month allocation',
    );
    sameTotals(cell, sumLines(buckets.get(periods[index]) ?? [], asOf));
  });
  const parts = [
    actual.undated,
    actual.beforeWindow,
    actual.afterWindow,
    ...actual.monthly,
  ];
  check(
    parts.reduce((total, entry) => total + entry.installmentCount, 0) ===
      actual.summary.installmentCount,
    'each installment occurs once in the window/outside/undated partition',
  );
  check(
    parts.reduce((total, entry) => total + entry.incompleteRows, 0) ===
      actual.summary.incompleteRows,
    'incomplete source rows partition exactly',
  );
  const nonempty = parts.filter((entry) => entry.installmentCount > 0);
  for (const field of moneyFields)
    sameMoney(
      actual.summary[field],
      knownSum(nonempty.map((entry) => entry[field])),
    );
  // Distinct case counts intentionally cannot be summed across months.
}
function verifyDetail(
  snapshot: PaymentSourceSnapshot,
  raw: Query,
  actual: PaymentCollectionReport,
  lines: Line[],
) {
  const expectedMonth = String(
    raw.detailMonth ?? shiftMonth(snapshot.asOf.slice(0, 7), 1),
  );
  check(
    actual.detail.month === expectedMonth,
    'detail month independent of displayed window start',
  );
  const grouped = new Map<string, Line[]>();
  for (const line of lines)
    if (dateMonth(line) === expectedMonth) {
      const items = grouped.get(line.item.key) ?? [];
      items.push(line);
      grouped.set(line.item.key, items);
    }
  const rows = [...actual.detail.rows];
  for (let page = 2; page <= actual.detail.totalPages; page++) {
    const next = buildCollectionReport(snapshot, {
      ...raw,
      page,
      pageSize: actual.detail.pageSize,
    });
    check(
      next.detail.total === actual.detail.total && next.detail.page === page,
      'detail pagination count stable',
    );
    rows.push(...next.detail.rows);
  }
  check(
    rows.length === grouped.size &&
      rows.length === actual.detail.total &&
      new Set(rows.map((row) => row.key)).size === rows.length,
    'detail pages contain every distinct case/month once',
  );
  for (const row of rows) {
    const expected = grouped.get(row.key);
    check(expected, 'detail uses original case keys');
    const item = expected[0].item;
    check(
      row.currency === item.identity.currency &&
        row.customerCode === item.identity.customerCode &&
        row.unitCode === item.identity.unitCode,
      'detail preserves source identity and currency',
    );
    sameTotals(row.totals, sumLines(expected, snapshot.asOf));
    const dates = expected.map((line) => line.row.dueDate!).sort();
    check(
      row.earliestDueDate === dates[0] && row.lastDueDate === dates.at(-1),
      'detail due bounds describe only selected month installments',
    );
  }
  for (let index = 1; index < rows.length; index++) {
    const a = rows[index - 1],
      b = rows[index];
    if (a.currency !== b.currency)
      check(
        a.currency !== null &&
          (b.currency === null ||
            a.currency.localeCompare(b.currency, 'en') < 0),
        'detail currency order ascending, unknown last',
      );
    else if (a.totals.outstanding === null || b.totals.outstanding === null)
      check(
        a.totals.outstanding !== null || b.totals.outstanding === null,
        'detail unknown remaining ordered last',
      );
    else
      check(
        a.totals.outstanding >= b.totals.outstanding,
        'detail remaining descending within each currency',
      );
  }
  return { paginated: actual.detail.totalPages > 1, rows: rows.length };
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
    const projectByKey = paymentProjectGroups(snapshot.cases);
    const counts = new Map<string | null, number>();
    for (const item of snapshot.cases)
      counts.set(
        item.identity.currency,
        (counts.get(item.identity.currency) ?? 0) + item.installments.length,
      );
    const currencies = [...counts]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([currency]) => currency);
    const dominant = currencies[0] ?? null;
    const allLines = snapshot.cases.flatMap((item) =>
      item.installments.map((row) => ({ item, row })),
    );
    for (const { row } of allLines) sameMoney(row.outstanding, remaining(row));
    report.observedQuality = {
      undatedRows: allLines.filter(({ row }) => row.dueDate === null).length,
      nullAmountRows: allLines.filter(
        ({ row }) => row.amount === null || row.paid === null,
      ).length,
      unknownCurrencyRows: allLines.filter(
        ({ item }) => !item.identity.currency?.trim(),
      ).length,
      negativeMoneyRows: allLines.filter(
        ({ row }) => (row.amount ?? 0) < 0 || (row.paid ?? 0) < 0,
      ).length,
      overpaidRows: allLines.filter(
        ({ row }) =>
          row.amount !== null &&
          row.paid !== null &&
          row.paid > row.amount + 0.000001,
      ).length,
    };
    report.multiMonthCurrencyCases = snapshot.cases.filter(
      (item) =>
        new Set(
          item.installments
            .map((row) => row.dueDate?.slice(0, 7))
            .filter(Boolean),
        ).size > 1,
    ).length;
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
    const reps = [
      ...new Set(snapshot.cases.flatMap((item) => item.representatives)),
    ];
    const scenarios: Query[] = [{}];
    for (const currency of [
      '__ALL__',
      ...currencies.map((value) => value ?? '__NULL__'),
    ])
      for (const paymentKind of kinds)
        for (const authorizationState of ['blank', 'all'])
          scenarios.push({ currency, paymentKind, authorizationState });
    for (const projectGroup of [...PROJECT_TYPES, 'UNKNOWN'])
      for (const paymentKind of ['all', 'sale'])
        scenarios.push({ currency: '__ALL__', projectGroup, paymentKind });
    for (const representative of reps)
      scenarios.push({ currency: '__ALL__', representative });
    for (const authorizationState of [
      'coded',
      'mixed',
      'unmatched',
      'multiple',
    ])
      scenarios.push({
        currency: '__ALL__',
        paymentKind: 'all',
        authorizationState,
      });
    const month = snapshot.asOf.slice(0, 7),
      year = Number(month.slice(0, 4));
    const starts = [
      shiftMonth(month, -12),
      `${year - 1}-12`,
      month,
      `${year}-12`,
      `${year + 1}-01`,
      shiftMonth(month, 72),
    ];
    for (const startMonth of starts)
      for (const months of [6, 12, 24])
        scenarios.push({
          currency: '__ALL__',
          paymentKind: 'all',
          authorizationState: 'all',
          startMonth,
          months,
          detailMonth: shiftMonth(startMonth, Math.min(months - 1, 1)),
        });
    scenarios.push({
      currency: '__ALL__',
      paymentKind: 'all',
      authorizationState: 'all',
      pageSize: 25,
    });
    stage = 'independent_monthly_financial_oracle';
    let combinations = 0,
      detailRowsChecked = 0,
      paginatedDetails = 0,
      crossCurrencyChecks = 0;
    for (const raw of scenarios) {
      const actual = buildCollectionReport(snapshot, {
        ...raw,
        pageSize: raw.pageSize ?? 100,
      });
      const selected =
        raw.currency === '__ALL__' || raw.currency === '__NULL__'
          ? null
          : raw.currency === undefined
            ? dominant
            : String(raw.currency);
      const expectedCurrencies =
        raw.currency === '__ALL__'
          ? currencies
          : currencies.filter((value) => value === selected);
      check(
        actual.basis === 'original' &&
          actual.currencyMode ===
            (raw.currency === '__ALL__' ? 'all' : 'single') &&
          actual.selectedCurrency === selected,
        'original-due and explicit currency-mode contract',
      );
      check(
        actual.selectedPaymentKind === (raw.paymentKind ?? 'sale') &&
          actual.selectedAuthorizationState ===
            (raw.authorizationState ?? 'blank') &&
          actual.selectedProjectGroup === (raw.projectGroup ?? '') &&
          actual.selectedRepresentative === (raw.representative ?? ''),
        'echoed report filters and defaults',
      );
      check(
        actual.byCurrency.length === expectedCurrencies.length &&
          actual.byCurrency.every((entry) =>
            expectedCurrencies.includes(entry.currency),
          ),
        'each selected currency has a separate report',
      );
      check(
        !('summary' in actual) && !('outstanding' in actual),
        'response has no cross-currency monetary total',
      );
      const periods = Array.from(
        { length: Number(raw.months ?? 6) },
        (_, index) =>
          shiftMonth(String(raw.startMonth ?? shiftMonth(month, 1)), index),
      );
      check(
        JSON.stringify(actual.periods) === JSON.stringify(periods) &&
          actual.nextMonth === shiftMonth(month, 1),
        'year rollover, period boundaries and next source-calendar month',
      );
      const lines = expectedLines(snapshot, raw, selected, projectByKey);
      for (const entry of actual.byCurrency)
        verifyBuckets(
          entry,
          lines.filter(({ item }) => item.identity.currency === entry.currency),
          snapshot.asOf,
          periods,
        );
      const details = verifyDetail(
        snapshot,
        { ...raw, pageSize: raw.pageSize ?? 100 },
        actual,
        lines,
      );
      detailRowsChecked += details.rows;
      paginatedDetails += Number(details.paginated);
      if (raw.currency === '__ALL__')
        for (const entry of actual.byCurrency) {
          const single = buildCollectionReport(snapshot, {
            ...raw,
            currency: entry.currency ?? '__NULL__',
            pageSize: 100,
          });
          const matching = single.byCurrency[0];
          check(
            matching.currency === entry.currency,
            'standalone report currency unchanged',
          );
          for (const field of [
            'summary',
            'overdue',
            'nextMonth',
            'undated',
            'beforeWindow',
            'afterWindow',
          ] as const)
            sameTotals(entry[field], matching[field]);
          entry.monthly.forEach((cell, index) =>
            sameTotals(cell, matching.monthly[index]),
          );
          crossCurrencyChecks++;
        }
      combinations++;
    }
    report.reportCombinationsVerified = combinations;
    report.standaloneCurrencyEquivalenceChecks = crossCurrencyChecks;
    report.detailRowsCheckedAcrossScenarios = detailRowsChecked;
    report.paginatedDetailScenarios = paginatedDetails;
    report.verification = {
      independentSourceLineFinancialAmountsAndNullSemantics: 'PASS',
      fullPeriodWindowPartitionAndNoDuplicatedInstallments: 'PASS',
      originalDueMonthNotActualCashReceiptMonth: 'PASS',
      originalCaseKeysWithOnlyRequestedMonthFinancialRows: 'PASS',
      nextCalendarMonthIndependentFromVisibleWindow: 'PASS',
      sixTwelveTwentyFourMonthAndDecemberJanuaryWindows: 'PASS',
      kindProjectAuthorizationRepresentativeIntersections: 'PASS',
      allCurrenciesEqualIndividualCurrencyReports: 'PASS',
      noCombinedCurrencyMoney: 'PASS',
      detailPaginationAndCurrencyThenRemainingOrder: 'PASS',
    };
    report.status = 'PASS';
    report.elapsedMs = Date.now() - started;
    persist();
    console.log(
      JSON.stringify({
        status: report.status,
        sourceRows: snapshot.recordCount,
        currencyCases: snapshot.cases.length,
        combinations,
        crossCurrencyChecks,
        paginatedDetails,
        elapsedMs: report.elapsedMs,
      }),
    );
  } catch (error) {
    report.status = 'FAIL';
    report.failedStage = stage;
    report.reason =
      error instanceof Error && error.message.startsWith('Verification failed:')
        ? error.message
        : 'Read-only verification unavailable; sensitive details intentionally omitted';
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
