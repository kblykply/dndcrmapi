import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import * as ts from 'typescript';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import {
  LogoDatabaseService,
  type LogoQueryParameters,
} from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import {
  buildCollectionReport,
  PaymentCollectionReportService,
} from '../src/payment-tracking/payment-collection-report.service';
import { paymentProjectGroups } from '../src/payment-tracking/payment-tracking-project';
import type {
  PaymentInstallment,
  PaymentProjectGroup,
  PaymentSourceCase,
  PaymentSourceSnapshot,
} from '../src/payment-tracking/payment-tracking.types';
import type {
  CollectionBreakdown,
  CollectionPerformanceTotals,
  CollectionTotals,
  PaymentCollectionReport,
} from '../src/payment-tracking/payment-collection-report.types';

const output = resolve(
  __dirname,
  '../../output/collection-report-premium-2026-10-03/live-verification.json',
);
const evidence: Record<string, unknown> = {
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  mode: 'ONE_SELECT_ONLY_SOURCE_SNAPSHOT_THEN_IN_MEMORY_ANALYTICS',
  privacy:
    'Only counts, durations and pass/fail are persisted. No customer names, identities, representative names, source rows or monetary values are logged.',
  independence:
    'The oracle filters original source cases and installment lines, recomputes clamped balances, weighted completion and distinct case counts. Only the previously verified canonical project classifier is shared. Frontend contract functions are loaded directly from current source files.',
};
function persist() {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
}
let assertionCount = 0;
function ensure(condition: unknown, label: string): asserts condition {
  assertionCount++;
  if (!condition) throw new Error(`Verification failed: ${label}`);
}
function numeric(
  actual: number | null,
  expected: number | null,
  label: string,
) {
  ensure(
    actual === null || expected === null
      ? actual === expected
      : Number.isFinite(actual) &&
          Number.isFinite(expected) &&
          Math.abs(actual - expected) <=
            Math.max(1e-6, Math.abs(expected) * 1e-10),
    label,
  );
}
function sum(values: Array<number | null>): number | null {
  if (!values.length) return 0;
  const known = values.filter((value): value is number => value !== null);
  ensure(known.every(Number.isFinite), 'finite oracle input');
  return known.length ? known.reduce((left, right) => left + right, 0) : null;
}
function balance(row: PaymentInstallment) {
  return row.amount === null || row.paid === null
    ? null
    : Math.max(row.amount - row.paid, 0);
}
type Line = {
  item: PaymentSourceCase;
  row: PaymentInstallment;
  project: PaymentProjectGroup;
};
function originalTotals(
  lines: Line[],
  asOf: string,
): CollectionPerformanceTotals {
  const scheduled = sum(lines.map(({ row }) => row.amount));
  const paidToDate = sum(lines.map(({ row }) => row.paid));
  const incompleteRows = lines.filter(
    ({ item, row }) =>
      row.amount === null ||
      row.paid === null ||
      row.outstanding === null ||
      row.dueDate === null ||
      !item.identity.currency?.trim(),
  ).length;
  const signed = lines.some(({ row }) =>
    [row.amount, row.paid, row.outstanding].some(
      (value) => value !== null && value < 0,
    ),
  );
  const completionPercent =
    scheduled !== null &&
    scheduled > 0 &&
    paidToDate !== null &&
    !incompleteRows &&
    !signed
      ? Math.round((paidToDate / scheduled) * 10000) / 100
      : null;
  return {
    scheduled,
    paidToDate,
    outstanding: sum(lines.map(({ row }) => balance(row))),
    overdue: sum(
      lines.map(({ row }) => {
        const value = balance(row);
        if (value === 0) return 0;
        return row.dueDate === null ? null : row.dueDate < asOf ? value : 0;
      }),
    ),
    caseCount: new Set(lines.map(({ item }) => item.key)).size,
    installmentCount: lines.length,
    incompleteRows,
    completionPercent:
      completionPercent !== null && Number.isFinite(completionPercent)
        ? completionPercent
        : null,
  };
}
function checkTotals(
  actual: CollectionTotals,
  lines: Line[],
  asOf: string,
  performanceRate = false,
) {
  const expected = originalTotals(lines, asOf);
  for (const key of [
    'scheduled',
    'paidToDate',
    'outstanding',
    'overdue',
  ] as const)
    numeric(actual[key], expected[key], `oracle ${key}`);
  for (const key of [
    'caseCount',
    'installmentCount',
    'incompleteRows',
  ] as const)
    ensure(actual[key] === expected[key], `oracle ${key}`);
  if (performanceRate)
    numeric(
      (actual as CollectionPerformanceTotals).completionPercent,
      expected.completionPercent,
      'weighted completion rate',
    );
}
function names(item: PaymentSourceCase) {
  return [
    ...new Set(item.representatives.filter((name) => name.trim().length > 0)),
  ];
}
function ownership(item: PaymentSourceCase) {
  const distinct = names(item);
  return distinct.length === 0
    ? 'unassigned'
    : distinct.length > 1
      ? 'multiple'
      : `single:${distinct[0]}`;
}
function advanceMonth(day: string, offset: number) {
  const [year, month] = day.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1, 12))
    .toISOString()
    .slice(0, 7);
}
function isOverdue(line: Line, asOf: string) {
  return (
    line.row.dueDate !== null &&
    line.row.dueDate < asOf &&
    (balance(line.row) === null || balance(line.row)! > 0)
  );
}
function checkBreakdown(
  group: CollectionBreakdown,
  rows: Line[],
  report: PaymentCollectionReport,
) {
  const selected = rows.filter(
    ({ row }) =>
      row.dueDate !== null && report.periods.includes(row.dueDate.slice(0, 7)),
  );
  checkTotals(group.period, selected, report.source.asOf, true);
  checkTotals(
    group.overdue,
    rows.filter((row) => isOverdue(row, report.source.asOf)),
    report.source.asOf,
  );
  checkTotals(
    group.nextMonth,
    rows.filter(({ row }) => row.dueDate?.startsWith(report.nextMonth)),
    report.source.asOf,
  );
  ensure(
    group.monthly.length === report.periods.length,
    'monthly group axis length',
  );
  group.monthly.forEach((value, index) => {
    ensure(value.month === report.periods[index], 'monthly group axis order');
    checkTotals(
      value,
      rows.filter(({ row }) => row.dueDate?.startsWith(value.month)),
      report.source.asOf,
      true,
    );
  });
}

type Frontend = {
  readReportFilters: (query: URLSearchParams) => Record<string, unknown>;
  hasReportContract: (
    report: PaymentCollectionReport,
    query: Record<string, unknown>,
    now: number,
  ) => boolean;
};
function loadFrontend(): Frontend {
  const base = resolve(__dirname, '../../web/src');
  const cache = new Map<string, Record<string, unknown>>();
  function load(file: string): Record<string, unknown> {
    ensure(
      file.startsWith(base + sep) && file.endsWith('.ts'),
      'frontend loader remains in source tree',
    );
    const existing = cache.get(file);
    if (existing) return existing;
    const exports: Record<string, unknown> = {};
    cache.set(file, exports);
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- Execute only repository TypeScript, bounded to the frontend source tree above.
    new Function('exports', 'require', compiled)(exports, (name: string) => {
      ensure(
        name.startsWith('.') || name.startsWith('@/'),
        'frontend loader uses only local modules',
      );
      return load(
        name.startsWith('@/')
          ? resolve(base, `${name.slice(2)}.ts`)
          : resolve(dirname(file), `${name}.ts`),
      );
    });
    return exports;
  }
  return load(
    resolve(base, 'app/(app)/finance/collection-report/_lib/report.ts'),
  ) as unknown as Frontend;
}

const queries: Array<{
  index: number;
  elapsedMs: number;
  rowCount?: number;
  passed: boolean;
}> = [];
class MeasuredDatabase extends LogoDatabaseService {
  override async query<T extends Record<string, unknown>>(
    sql: string,
    parameters: LogoQueryParameters = {},
  ): Promise<T[]> {
    ensure(
      queries.length < 5,
      'single cold snapshot is bounded to five SELECTs',
    );
    const entry = {
      index: queries.length + 1,
      elapsedMs: 0,
      passed: false,
      rowCount: undefined as number | undefined,
    };
    queries.push(entry);
    const started = performance.now();
    try {
      const rows = await super.query<T>(sql, parameters);
      entry.passed = true;
      entry.rowCount = rows.length;
      return rows;
    } finally {
      entry.elapsedMs = Math.round((performance.now() - started) * 100) / 100;
      evidence.queries = queries;
      persist();
    }
  }
}

function verify(
  report: PaymentCollectionReport,
  snapshot: PaymentSourceSnapshot,
  query: Record<string, unknown>,
  frontend: Frontend,
) {
  const projects = paymentProjectGroups(snapshot.cases);
  const filtered = snapshot.cases
    .filter((item) => {
      if (
        typeof query.invoiceOk === 'string' &&
        query.invoiceOk.startsWith('value:')
      ) {
        const selected = query.invoiceOk.slice('value:'.length);
        if (
          item.invoiceOk?.status !== 'matched' ||
          item.invoiceOk.hasBlank ||
          item.invoiceOk.values.length !== 1 ||
          item.invoiceOk.values[0] !== selected
        )
          return false;
      }
      if (
        report.currencyMode === 'single' &&
        item.identity.currency !== report.selectedCurrency
      )
        return false;
      if (query.projectGroup && projects.get(item.key) !== query.projectGroup)
        return false;
      if (
        typeof query.representative === 'string' &&
        query.representative &&
        !names(item).includes(query.representative)
      )
        return false;
      if (
        query.representativeState &&
        ownership(item) !== query.representativeState
      )
        return false;
      if (query.authorizationState === 'all') return true;
      return (
        item.authorization.status === 'matched' &&
        item.authorization.hasBlank &&
        item.authorization.codes.length === 0
      );
    })
    .flatMap((item) =>
      item.installments
        .filter(
          (row) =>
            query.paymentKind === 'all' ||
            row.paymentKind === (query.paymentKind ?? 'sale'),
        )
        .map(
          (row) =>
            ({
              item,
              row,
              project: projects.get(item.key) ?? 'UNKNOWN',
            }) as Line,
        ),
    );
  for (const line of filtered)
    numeric(line.row.outstanding, balance(line.row), 'source clamped balance');
  for (const part of report.byCurrency) {
    const rows = filtered.filter(
      ({ item }) => item.identity.currency === part.currency,
    );
    checkTotals(part.summary, rows, snapshot.asOf);
    checkBreakdown(part, rows, report);
    for (const [index, bounds] of [
      [1, 30],
      [31, 60],
      [61, 90],
      [91, Infinity],
    ].entries()) {
      const selected = rows.filter((line) => {
        if (!isOverdue(line, snapshot.asOf)) return false;
        const age =
          (Date.parse(`${snapshot.asOf}T12:00:00Z`) -
            Date.parse(`${line.row.dueDate!}T12:00:00Z`)) /
          86400000;
        return age >= bounds[0] && age <= bounds[1];
      });
      ensure(
        part.aging[index]?.key === ['1_30', '31_60', '61_90', '90_plus'][index],
        'aging key and order',
      );
      checkTotals(part.aging[index], selected, snapshot.asOf);
    }
    for (const month of part.historical)
      checkTotals(
        month,
        rows.filter(({ row }) => row.dueDate?.startsWith(month.month)),
        snapshot.asOf,
        true,
      );
    const expectedProjects = new Set(rows.map((row) => row.project));
    ensure(
      part.projectBreakdown.length === expectedProjects.size,
      'project disjoint partition size',
    );
    ensure(
      new Set(part.projectBreakdown.map((group) => group.projectGroup)).size ===
        expectedProjects.size,
      'project unique groups',
    );
    for (const group of part.projectBreakdown) {
      ensure(
        expectedProjects.has(group.projectGroup),
        'project identity remains canonical',
      );
      checkBreakdown(
        group,
        rows.filter((row) => row.project === group.projectGroup),
        report,
      );
    }
    const expectedRepresentatives = new Set(
      rows.map(({ item }) => ownership(item)),
    );
    ensure(
      part.representativeBreakdown.length === expectedRepresentatives.size,
      'representative disjoint partition size',
    );
    ensure(
      new Set(part.representativeBreakdown.map((group) => group.key)).size ===
        expectedRepresentatives.size,
      'representative unique groups',
    );
    for (const group of part.representativeBreakdown) {
      ensure(
        expectedRepresentatives.has(group.key),
        'representative ownership is disjoint',
      );
      checkBreakdown(
        group,
        rows.filter(({ item }) => ownership(item) === group.key),
        report,
      );
    }
  }
  const detailRows = filtered.filter((line) => {
    if (report.detail.scope === 'undated') return line.row.dueDate === null;
    if (report.detail.scope === 'period')
      return (
        !!line.row.dueDate &&
        report.periods.includes(line.row.dueDate.slice(0, 7))
      );
    if (report.detail.scope === 'month')
      return line.row.dueDate?.slice(0, 7) === report.detail.month;
    if (!isOverdue(line, snapshot.asOf)) return false;
    if (!report.detail.agingBucket) return true;
    const age =
      (Date.parse(`${snapshot.asOf}T12:00:00Z`) -
        Date.parse(`${line.row.dueDate!}T12:00:00Z`)) /
      86400000;
    return report.detail.agingBucket === '1_30'
      ? age <= 30
      : report.detail.agingBucket === '31_60'
        ? age >= 31 && age <= 60
        : report.detail.agingBucket === '61_90'
          ? age >= 61 && age <= 90
          : age >= 91;
  });
  ensure(
    report.detail.total ===
      new Set(detailRows.map(({ item }) => item.key)).size,
    'scoped detail exact case count',
  );
  for (const row of report.detail.rows) {
    const selected = detailRows.filter(({ item }) => item.key === row.key);
    ensure(selected.length > 0, 'scoped detail case membership');
    checkTotals(row.totals, selected, snapshot.asOf);
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    params.set(key, String(value));
  const requested = frontend.readReportFilters(params);
  ensure(
    frontend.hasReportContract(report, requested, Date.now()),
    'live payload passes current frontend report and analytics contract',
  );
}

async function main() {
  const config = new LogoConfigService(
    new ConfigService({
      ...parse(readFileSync(resolve(__dirname, '../.env'))),
      ...process.env,
    }),
  );
  const database = new MeasuredDatabase(config);
  const source = new PaymentTrackingSourceService(
    database,
    new PaymentTrackingCatalogService(database),
  );
  try {
    persist();
    const frontend = loadFrontend();
    const coldStarted = performance.now();
    const snapshot = await source.snapshot(true);
    const coldMs = performance.now() - coldStarted;
    ensure(
      snapshot.authorizationSource.status === 'available',
      'live representative metadata available',
    );
    ensure(
      queries.length <= 5 && queries.every((query) => query.passed),
      'bounded read-only source snapshot',
    );
    const readsBefore = queries.length;
    const warmStarted = performance.now();
    const warm = await new PaymentCollectionReportService(source).report();
    const warmMs = performance.now() - warmStarted;
    ensure(
      queries.length === readsBefore,
      'warm report uses zero additional SQL',
    );
    ensure(
      warm.source.generatedAt === snapshot.generatedAt,
      'warm report shares the verified source snapshot',
    );
    evidence.source = {
      asOf: snapshot.asOf,
      generatedAt: snapshot.generatedAt,
      sourceRows: snapshot.recordCount,
      sourceCases: snapshot.cases.length,
      coldMs,
      warmMs,
      coldQueries: readsBefore,
      warmQueries: queries.length - readsBefore,
    };
    const currency = snapshot.cases.some(
      (item) => item.identity.currency === 'GBP',
    )
      ? 'GBP'
      : (snapshot.cases.find((item) => item.identity.currency)?.identity
          .currency ?? '__NULL__');
    const scenarios: Array<{ name: string; query: Record<string, unknown> }> =
      [];
    for (const currencyMode of [currency, '__ALL__'])
      for (const paymentKind of ['sale', 'all'])
        for (const authorizationState of ['blank', 'all'])
          for (const months of [6, 12, 24])
            scenarios.push({
              name: `scope-${scenarios.length + 1}`,
              query: {
                currency: currencyMode,
                paymentKind,
                authorizationState,
                months,
              },
            });
    const projects = [
      ...new Set(paymentProjectGroups(snapshot.cases).values()),
    ].slice(0, 2);
    for (const projectGroup of projects)
      scenarios.push({
        name: `project-${scenarios.length + 1}`,
        query: { currency: '__ALL__', projectGroup, paymentKind: 'all' },
      });
    const representatives = [...new Set(snapshot.cases.flatMap(names))].slice(
      0,
      2,
    );
    for (const representative of representatives)
      scenarios.push({
        name: `representative-${scenarios.length + 1}`,
        query: {
          currency: '__ALL__',
          representative,
          authorizationState: 'all',
        },
      });
    for (const representativeState of ['multiple', 'unassigned'])
      scenarios.push({
        name: `ownership-${representativeState}`,
        query: {
          currency: '__ALL__',
          representativeState,
          authorizationState: 'all',
          paymentKind: 'all',
        },
      });
    for (const months of [12, 24])
      scenarios.push({
        name: `historical-${months}`,
        query: {
          currency: '__ALL__',
          months,
          startMonth: advanceMonth(snapshot.asOf, -6),
          detailMonth: advanceMonth(snapshot.asOf, -1),
          paymentKind: 'all',
          authorizationState: 'all',
        },
      });
    for (const detailScope of ['overdue', 'period', 'undated'])
      scenarios.push({
        name: `detail-${detailScope}`,
        query: {
          currency: '__ALL__',
          detailScope,
          paymentKind: 'all',
          authorizationState: 'all',
        },
      });
    for (const agingBucket of ['1_30', '31_60', '61_90', '90_plus'])
      scenarios.push({
        name: `aging-${agingBucket}`,
        query: {
          currency: '__ALL__',
          detailScope: 'overdue',
          agingBucket,
          paymentKind: 'all',
          authorizationState: 'all',
        },
      });
    scenarios.push({
      name: 'dnd-aging',
      query: {
        currency,
        invoiceOk: 'value:DND',
        detailScope: 'overdue',
        agingBucket: '90_plus',
      },
    });
    const results: Array<Record<string, unknown>> = [];
    for (const scenario of scenarios) {
      const started = performance.now();
      const query = {
        invoiceOk: 'all',
        detailScope: 'month',
        agingBucket: '',
        ...scenario.query,
      };
      const report = buildCollectionReport(snapshot, query);
      const reportMs = performance.now() - started;
      const checksBefore = assertionCount;
      verify(report, snapshot, query, frontend);
      results.push({
        name: scenario.name,
        passed: true,
        reportMs: Math.round(reportMs * 100) / 100,
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        currencyCount: report.byCurrency.length,
        projectGroups: report.byCurrency.reduce(
          (sum, part) => sum + part.projectBreakdown.length,
          0,
        ),
        representativeGroups: report.byCurrency.reduce(
          (sum, part) => sum + part.representativeBreakdown.length,
          0,
        ),
        assertions: assertionCount - checksBefore,
      });
      evidence.scenarios = results;
      persist();
    }
    ensure(
      queries.length === readsBefore,
      'all analytical scenarios use zero additional SQL',
    );
    evidence.status = 'PASSED';
    evidence.assertions = assertionCount;
    evidence.finishedAt = new Date().toISOString();
    persist();
    console.log(
      JSON.stringify({
        status: 'PASSED',
        scenarios: results.length,
        assertions: assertionCount,
        sourceRows: snapshot.recordCount,
        sourceCases: snapshot.cases.length,
        coldMs,
        warmMs,
        queries: queries.length,
        output,
      }),
    );
  } catch (error) {
    evidence.status = 'FAILED';
    evidence.finishedAt = new Date().toISOString();
    evidence.failure =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: 'UnknownError' };
    persist();
    console.log(
      JSON.stringify({
        status: 'FAILED',
        failure: evidence.failure,
        queries: queries.length,
        output,
      }),
    );
    process.exitCode = 1;
  } finally {
    source.onModuleDestroy();
    await database.onModuleDestroy();
  }
}
void main();
