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
import { paymentList } from '../src/payment-tracking/payment-tracking.service';
import type {
  PaymentKind,
  PaymentKindFilter,
  PaymentTrackingRow,
} from '../src/payment-tracking/payment-tracking.types';

// SELECT only. Source values, identities, credentials and money stay in memory.
// This oracle intentionally does not import the production kind classifier/projection.
const kinds: PaymentKind[] = [
  'sale',
  'land',
  'vat',
  'transformer',
  'furniture',
  'deposit',
  'other',
];
const moneyFields = ['amount', 'paid', 'outstanding', 'overdueAmount'] as const;
type MoneyField = (typeof moneyFields)[number];
type Totals = Record<MoneyField, number | null> & { records: number };
interface SqlGroup extends Record<string, unknown>, Totals {
  projectCode: string | null;
  currency: string | null;
}

function check(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${name}`);
}

function observedKind(projectCode: string | null): PaymentKind {
  const code = (projectCode ?? '').trim().toLocaleUpperCase('tr-TR');
  const named = new Map<string, PaymentKind>([
    ['TRAFO', 'transformer'],
    ['KDV', 'vat'],
    ['ESYA', 'furniture'],
    ['EŞYA', 'furniture'],
    ['DEPOZİTO ELEKTRİK', 'deposit'],
    ['DEPOZITO ELEKTRIK', 'deposit'],
  ]);
  const direct = named.get(code);
  if (direct) return direct;
  if (code.startsWith('GK-ARSA') && /^\d+$/.test(code.slice(7))) return 'land';
  const [prefix, ...parts] = code.split('-');
  if (
    ['LJP', 'LJP2', 'LJ', 'LV', 'S'].includes(prefix) &&
    parts.length > 0 &&
    parts.every((part) => /^[A-Z]\d+[A-Z]?$/.test(part))
  )
    return 'sale';
  return 'other';
}

function sumKnown(values: Array<number | null>): number | null {
  if (!values.length) return 0;
  const known = values.filter((value): value is number => value !== null);
  check(known.every(Number.isFinite), 'all known aggregates are finite');
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function sameMoney(
  actual: number | null,
  expected: number | null,
  name: string,
) {
  if (actual === null || expected === null) {
    check(actual === expected, `${name}: null semantics`);
    return;
  }
  check(
    Number.isFinite(actual) && Number.isFinite(expected),
    `${name}: finite`,
  );
  check(
    Math.abs(actual - expected) <= Math.max(0.02, Math.abs(expected) * 1e-9),
    `${name}: tolerance`,
  );
}

function totals(groups: Totals[]): Totals {
  return {
    records: groups.reduce((sum, group) => sum + group.records, 0),
    amount: sumKnown(groups.map((group) => group.amount)),
    paid: sumKnown(groups.map((group) => group.paid)),
    outstanding: sumKnown(groups.map((group) => group.outstanding)),
    overdueAmount: sumKnown(groups.map((group) => group.overdueAmount)),
  };
}

const output = resolve(
  __dirname,
  '../../output/payment-simple-filters-2026-10-02/live-kind-verification.json',
);
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  mode: 'SELECT_ONLY_NO_WORKFLOW_DATABASE',
  source: 'LOGO_DND.dbo.L_223_ODEME_PLANI',
  independentOracle:
    'SQL sums by exact raw project/currency, independent JS code mapping',
  consistency:
    'Sequential live reads, not a historical or atomic database snapshot',
  status: 'RUNNING',
};
function persist() {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
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
    // Do not invoke lifecycle bootstrap: this verifier needs no refresh timer.
    const snapshot = await source.snapshot(true);
    report.sourceReadMs = Date.now() - started;
    report.sourceRows = snapshot.recordCount;
    report.sourceCases = snapshot.cases.length;
    const before = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');
    const dayParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Famagusta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (name: string) =>
      dayParts.find((value) => value.type === name)?.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    check(snapshot.asOf === today, 'source civil day matches Famagusta');
    report.asOf = today;
    stage = 'independent_sql';
    const sqlStarted = Date.now();
    const sqlGroups = await database.query<SqlGroup>(
      `SELECT [PROJE KOD] AS [projectCode], [DVZ] AS [currency], COUNT(*) AS [records],
       SUM([TUTAR]) AS [amount], SUM([ODENEN]) AS [paid],
       SUM(CASE WHEN [TUTAR] IS NULL OR [ODENEN] IS NULL THEN NULL WHEN [TUTAR]-[ODENEN]>0 THEN [TUTAR]-[ODENEN] ELSE 0 END) AS [outstanding],
       SUM(CASE WHEN [TUTAR] IS NULL OR [ODENEN] IS NULL OR ([TUTAR]-[ODENEN]>0 AND [VADE] IS NULL) THEN NULL WHEN [TUTAR]-[ODENEN]>0 AND [VADE]<@today THEN [TUTAR]-[ODENEN] ELSE 0 END) AS [overdueAmount]
       FROM [LOGO_DND].[dbo].[L_223_ODEME_PLANI]
       GROUP BY [PROJE KOD], CONVERT(varbinary(max), [PROJE KOD]), [DVZ], CONVERT(varbinary(max), [DVZ])`,
      { today: new Date(`${today}T00:00:00.000Z`) },
    );
    report.independentSqlMs = Date.now() - sqlStarted;
    report.independentSqlGroups = sqlGroups.length;
    check(
      sqlGroups.every(
        (row) => Number.isSafeInteger(row.records) && row.records > 0,
      ),
      'SQL counts are positive integers',
    );
    check(
      totals(sqlGroups).records === snapshot.recordCount,
      'independent raw row count',
    );
    check(
      snapshot.cases.reduce(
        (sum, item) => sum + item.installments.length,
        0,
      ) === snapshot.recordCount,
      'every source row is preserved',
    );
    const originals = new Map(snapshot.cases.map((item) => [item.key, item]));
    check(
      originals.size === snapshot.cases.length,
      'source case keys are unique',
    );
    const currencies = [
      ...new Set(snapshot.cases.map((item) => item.identity.currency)),
    ];
    const sqlCurrencies = new Set(sqlGroups.map((row) => row.currency));
    check(
      currencies.length === sqlCurrencies.size &&
        currencies.every((currency) => sqlCurrencies.has(currency)),
      'SQL and source currencies match exactly',
    );
    for (const item of snapshot.cases)
      for (const row of item.installments)
        check(
          row.paymentKind === observedKind(row.projectCode),
          'line classification',
        );

    stage = 'kind_projections';
    const actor = { id: 'read-only-kind-verifier', role: 'ADMIN' };
    const checks: Array<Record<string, unknown>> = [];
    for (const currency of currencies) {
      const raw = {
        currency: currency ?? '__NULL__',
        scope: 'all',
        pageSize: 100,
      };
      const originalCases = snapshot.cases.filter(
        (item) => item.identity.currency === currency,
      );
      const independent = sqlGroups.filter(
        (group) => group.currency === currency,
      );
      const allSql = totals(independent);
      const actualKindTotals: Totals[] = [];
      const unionKeys = new Set<string>();
      const defaultList = paymentList(snapshot, [], actor, raw);
      const explicitAll = paymentList(snapshot, [], actor, {
        ...raw,
        paymentKind: 'all',
      });
      check(
        JSON.stringify(defaultList) === JSON.stringify(explicitAll),
        'default remains all',
      );
      for (const kind of ['all', ...kinds] as PaymentKindFilter[]) {
        const expectedSql = totals(
          independent.filter(
            (group) =>
              kind === 'all' || observedKind(group.projectCode) === kind,
          ),
        );
        const expectedCases = originalCases.filter(
          (item) =>
            kind === 'all' ||
            item.installments.some(
              (row) => observedKind(row.projectCode) === kind,
            ),
        );
        const expectedKeys = new Set(expectedCases.map((item) => item.key));
        const first = paymentList(snapshot, [], actor, {
          ...raw,
          paymentKind: kind,
        });
        check(first.total === expectedKeys.size, 'kind case count');
        const rows: PaymentTrackingRow[] = [...first.rows];
        for (let page = 2; page <= first.totalPages; page++) {
          const result = paymentList(snapshot, [], actor, {
            ...raw,
            paymentKind: kind,
            page,
          });
          check(result.total === first.total, 'pagination count');
          rows.push(...result.rows);
        }
        check(rows.length === first.total, 'all matching pages were checked');
        check(
          new Set(rows.map((row) => row.key)).size === rows.length,
          'pagination unique keys',
        );
        for (const row of rows) {
          check(
            expectedKeys.has(row.key),
            'filtered key belongs to the original case',
          );
          const original = originals.get(row.key)!;
          check(
            JSON.stringify(row.identity) === JSON.stringify(original.identity),
            'case identity unchanged',
          );
          const selected = original.installments.filter(
            (line) => kind === 'all' || observedKind(line.projectCode) === kind,
          );
          check(
            row.installmentCount === selected.length,
            'case selected line count',
          );
          const independentRows: Totals[] = selected.map((line) => {
            const outstanding =
              line.amount === null || line.paid === null
                ? null
                : Math.max(line.amount - line.paid, 0);
            const overdueAmount =
              outstanding === null || (outstanding > 0 && line.dueDate === null)
                ? null
                : line.dueDate !== null && line.dueDate < today
                  ? outstanding
                  : 0;
            return {
              records: 1,
              amount: line.amount,
              paid: line.paid,
              outstanding,
              overdueAmount,
            };
          });
          const expected = totals(independentRows);
          for (const field of moneyFields)
            sameMoney(row[field], expected[field], `case ${field}`);
          if (kind !== 'all') unionKeys.add(row.key);
        }
        const actual = totals(
          rows.map((row) => ({ ...row, records: row.installmentCount })),
        );
        check(actual.records === expectedSql.records, 'kind raw row count');
        for (const field of moneyFields)
          sameMoney(actual[field], expectedSql[field], `SQL kind ${field}`);
        sameMoney(
          first.filteredSummary.outstanding,
          expectedSql.outstanding,
          'summary outstanding',
        );
        sameMoney(
          first.filteredSummary.overdueAmount,
          expectedSql.overdueAmount,
          'summary overdue',
        );
        if (kind !== 'all' && actual.records > 0) actualKindTotals.push(actual);
        checks.push({
          currency,
          paymentKind: kind,
          cases: rows.length,
          sourceRows: actual.records,
          pages: first.totalPages,
          status: 'PASS',
        });
      }
      const partition = totals(actualKindTotals);
      check(
        partition.records === allSql.records,
        'all equals seven-kind line partition',
      );
      for (const field of moneyFields)
        sameMoney(partition[field], allSql[field], `partition ${field}`);
      check(
        unionKeys.size === originalCases.length &&
          originalCases.every((item) => unionKeys.has(item.key)),
        'kind key union covers unfiltered cases',
      );
      // Cases may contain multiple kinds, so category case counts must not be added.
    }
    check(
      createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') ===
        before,
      'source snapshot unchanged',
    );
    report.checks = checks;
    report.currencyCount = currencies.length;
    report.kindChecks = checks.length;
    report.partition = 'PASS';
    report.caseKeyPreservation = 'PASS';
    report.sourceImmutability = 'PASS';
    report.defaultAllUnchanged = 'PASS';
    report.moneyAndNullSemantics = 'PASS';
    report.caseCountsAreNotAdditive = true;
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
