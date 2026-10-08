import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import * as ts from 'typescript';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import { PaymentTrackingService } from '../src/payment-tracking/payment-tracking.service';
import { PaymentTrackingStoreService } from '../src/payment-tracking/payment-tracking-store.service';
import type {
  PaymentSourceCase,
  PaymentTrackingDetail,
  PaymentKind,
} from '../src/payment-tracking/payment-tracking.types';

// Only source SELECTs execute. Workflow/contact lookups are in-memory stubs.
// Customer identities, draft bodies and financial values never leave memory.
const output = resolve(
  __dirname,
  '../../output/payment-whatsapp-template-2026-10-02/source-template-audit.json',
);
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  mode: 'SELECT_ONLY_DRAFTS_IN_MEMORY_NO_MESSAGES_OR_EXTERNAL_LINKS',
  source: 'LOGO_DND.dbo.L_223_ODEME_PLANI',
  identity:
    'Exact customerCode + unitCode; all original currency cases preserved',
  privacy: 'Only counts, timings and verification outcomes are persisted',
};
function persist() {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
}
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${label}`);
}

// The browser helper uses @/ aliases. Resolve only local web modules; never load
// an app entry point, construct a WhatsApp URL, or invoke a network client.
const webRoot = resolve(__dirname, '../../web/src');
const moduleCache = new Map<string, { exports: any }>();
function webModule(filename: string): any {
  const file = filename.endsWith('.ts') ? filename : `${filename}.ts`;
  check(
    file.startsWith(`${webRoot}/`),
    'web helper module stays inside source',
  );
  const cached = moduleCache.get(file);
  if (cached) return cached.exports;
  const module = { exports: {} };
  moduleCache.set(file, module);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const localRequire = (request: string) => {
    if (request.startsWith('@/'))
      return webModule(resolve(webRoot, request.slice(2)));
    if (request.startsWith('.'))
      return webModule(resolve(dirname(file), request));
    throw new Error(
      'Verification failed: unexpected nonlocal web helper import',
    );
  };
  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}
type Builder = (
  detail: PaymentTrackingDetail,
  options: { tr: boolean; scope: 'portfolio' | 'selected' },
) => { body: string; incomplete: boolean; tooLong: boolean };
const DAY = 86_400_000;
function civil(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const epoch = Date.UTC(year, month - 1, day);
  const date = new Date(epoch);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? epoch / DAY
    : null;
}
const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);
const equal = (left: number | null, right: number) =>
  left !== null && Number.isFinite(left) && Math.abs(left - right) <= 0.000001;
const kindLabels: Record<PaymentKind, [string, string]> = {
  sale: ['Normal satış', 'Normal sale'],
  land: ['Arsa', 'Land'],
  vat: ['KDV', 'VAT'],
  transformer: ['Trafo', 'Transformer'],
  furniture: ['Eşya', 'Furniture'],
  deposit: ['Depozito', 'Deposit'],
  other: ['Diğer', 'Other'],
};
type Month = {
  key: string;
  remaining: number;
  maxDays: number;
  kinds: Set<PaymentKind>;
};
type Oracle = {
  currency: string | null;
  reasons: Set<string>;
  remaining: number;
  overdue: number;
  future: number;
  maxDays: number;
  months: Month[];
  overdueRows: number;
};
// Independent oracle reads original line amounts and civil dates, then compares
// the source case summaries. It never calls the browser helper's aggregators.
function oracle(item: PaymentSourceCase, asOf: string): Oracle {
  const reasons = new Set<string>();
  const day = civil(asOf);
  if (day === null) reasons.add('invalidSourceDay');
  if (
    !['GBP', 'EUR', 'USD', 'TL', 'TRY'].includes(item.identity.currency ?? '')
  )
    reasons.add('unrecognizedCurrency');
  if (!item.identity.customerCode?.trim() || !item.identity.unitCode?.trim())
    reasons.add('missingIdentity');
  if (item.incompleteRows !== 0) reasons.add('sourceIncompleteRows');
  if (item.installmentCount !== item.installments.length)
    reasons.add('sourceRowCountMismatch');
  let remaining = 0,
    overdue = 0,
    future = 0,
    dueToday = 0,
    maxDays = 0,
    overdueRows = 0;
  const months = new Map<string, Month>();
  for (const row of item.installments) {
    const due = civil(row.dueDate);
    if (due === null) reasons.add('invalidDueDate');
    if (!Object.hasOwn(kindLabels, row.paymentKind))
      reasons.add('unknownPaymentKind');
    if (
      [row.amount, row.paid, row.outstanding].some(
        (value) => value === null || !Number.isFinite(value),
      )
    ) {
      reasons.add('missingOrNonfiniteMoney');
      continue;
    }
    if ([row.amount!, row.paid!, row.outstanding!].some((value) => value < 0))
      reasons.add('negativeMoney');
    if (row.paid! - row.amount! > 0.000001) reasons.add('overpaidLine');
    const balance = Math.max(row.amount! - row.paid!, 0);
    if (!equal(row.outstanding, balance))
      reasons.add('sourceRemainingMismatch');
    remaining += balance;
    if (balance <= 0 || due === null || day === null) continue;
    if (due >= day) {
      future += balance;
      if (due === day) dueToday += balance;
      continue;
    }
    overdue += balance;
    overdueRows++;
    maxDays = Math.max(maxDays, day - due);
    const key = row.dueDate!.slice(0, 7);
    const month = months.get(key) ?? {
      key,
      remaining: 0,
      maxDays: 0,
      kinds: new Set<PaymentKind>(),
    };
    month.remaining += balance;
    month.maxDays = Math.max(month.maxDays, day - due);
    month.kinds.add(row.paymentKind);
    months.set(key, month);
  }
  const aggregate: Array<[number | null, number]> = [
    [
      item.amount,
      sum(item.installments.map((line) => line.amount ?? Number.NaN)),
    ],
    [item.paid, sum(item.installments.map((line) => line.paid ?? Number.NaN))],
    [item.outstanding, remaining],
    [item.overdueAmount, overdue],
    [item.dueTodayAmount, dueToday],
  ];
  if (aggregate.some(([actual, expected]) => !equal(actual, expected)))
    reasons.add('sourceSummaryMismatch');
  if (!equal(remaining, overdue + future))
    reasons.add('dueDatePartitionMismatch');
  if (
    !equal(overdue, sum([...months.values()].map((month) => month.remaining)))
  )
    reasons.add('monthPartitionMismatch');
  return {
    currency: item.identity.currency,
    reasons,
    remaining,
    overdue,
    future,
    maxDays,
    months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    overdueRows,
  };
}
function statistics(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const quantile = (fraction: number) =>
    ordered[
      Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))
    ] ?? 0;
  return {
    count: values.length,
    min: ordered[0] ?? 0,
    median: quantile(0.5),
    p90: quantile(0.9),
    p95: quantile(0.95),
    max: ordered.at(-1) ?? 0,
  };
}
function validateDraft(body: string, values: Oracle[], tr: boolean) {
  const lines = body.split('\n');
  const format = new Intl.NumberFormat(tr ? 'tr-TR' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const monthFormat = new Intl.DateTimeFormat(tr ? 'tr-TR' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  let expectedMonthlyLines = 0,
    expectedTotalLines = 0;
  for (const value of values) {
    // Observed source currencies are unambiguous code labels. Every case has a
    // separate section even when another currency has incomplete information.
    const header = value.currency;
    check(
      header !== null && lines.includes(header),
      'currency section present',
    );
    const start = lines.indexOf(header);
    const otherStarts = values
      .filter((other) => other.currency !== header)
      .map((other) => lines.indexOf(other.currency ?? ''))
      .filter((index) => index > start);
    const section = lines.slice(
      start,
      otherStarts.length ? Math.min(...otherStarts) : lines.length,
    );
    if (value.reasons.size) {
      check(
        !section.some((line) =>
          /^(Toplam açık bakiye:|Total outstanding:|Vadesi geçmiş:|Overdue:|• )/.test(
            line,
          ),
        ),
        'incomplete currency suppresses financial assertions',
      );
      continue;
    }
    const money = (amount: number) => `${format.format(amount)} ${header}`;
    const expected = tr
      ? [
          `Toplam açık bakiye: ${money(value.remaining)}`,
          `Vadesi geçmiş: ${money(value.overdue)}`,
          `Bugün ve gelecek vadeli: ${money(value.future)}`,
          `En uzun gecikme: ${value.maxDays} gün`,
        ]
      : [
          `Total outstanding: ${money(value.remaining)}`,
          `Overdue: ${money(value.overdue)}`,
          `Due today and in the future: ${money(value.future)}`,
          `Longest delay: ${value.maxDays} ${value.maxDays === 1 ? 'day' : 'days'}`,
        ];
    check(
      expected.every((line) => section.includes(line)),
      'currency totals and maximum civil-day delay',
    );
    expectedTotalLines++;
    let previousLine = -1;
    for (const month of value.months) {
      const label = monthFormat.format(
        new Date(`${month.key}-01T00:00:00.000Z`),
      );
      const kinds = Object.keys(kindLabels)
        .filter((kind) => month.kinds.has(kind as PaymentKind))
        .map((kind) => kindLabels[kind as PaymentKind][tr ? 0 : 1])
        .join(', ');
      const expectedLine = tr
        ? `• ${label}: ${money(month.remaining)} · ${kinds} · en fazla ${month.maxDays} gün gecikme`
        : `• ${label}: ${money(month.remaining)} · ${kinds} · up to ${month.maxDays} ${month.maxDays === 1 ? 'day' : 'days'} overdue`;
      const position = section.indexOf(expectedLine);
      check(
        position > previousLine,
        'monthly amounts, types, order and delays',
      );
      previousLine = position;
      expectedMonthlyLines++;
    }
  }
  check(
    lines.filter((line) => line.startsWith('• ')).length ===
      expectedMonthlyLines,
    'no omitted or extra monthly payment assertions',
  );
  check(
    lines.filter((line) =>
      /^(Toplam açık bakiye:|Total outstanding:)/.test(line),
    ).length === expectedTotalLines,
    'no omitted or extra currency total assertions',
  );
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
  let stage = 'read_source';
  const started = Date.now();
  try {
    const snapshot = await source.snapshot(true);
    report.sourceReadMs = Date.now() - started;
    report.sourceRows = snapshot.recordCount;
    report.currencyCases = snapshot.cases.length;
    report.asOf = snapshot.asOf;
    stage = 'independent_source_oracle';
    const byCase = new Map(
      snapshot.cases.map((item) => [item.key, oracle(item, snapshot.asOf)]),
    );
    const groups = new Map<string, PaymentSourceCase[]>();
    for (const item of snapshot.cases) {
      const pair =
        item.identity.customerCode?.trim() && item.identity.unitCode?.trim()
          ? JSON.stringify([item.identity.customerCode, item.identity.unitCode])
          : item.key;
      groups.set(pair, [...(groups.get(pair) ?? []), item]);
    }
    report.exactCustomerUnitGroups = groups.size;
    const reasonCounts: Record<string, number> = {};
    for (const value of byCase.values())
      for (const reason of value.reasons)
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    report.incompleteCurrencyReasons = reasonCounts;
    const groupOracles = [...groups.values()].map((items) =>
      items.map((item) => byCase.get(item.key)!),
    );
    report.overdueDistribution = {
      portfoliosWithOverdue: groupOracles.filter((values) =>
        values.some((value) => value.overdueRows > 0),
      ).length,
      portfoliosWithOverdueInMultipleCurrencies: groupOracles.filter(
        (values) => values.filter((value) => value.overdueRows > 0).length > 1,
      ).length,
      currencyMonthRows: statistics(
        groupOracles.map((values) =>
          sum(values.map((value) => value.months.length)),
        ),
      ),
      overdueSourceRows: statistics(
        groupOracles.map((values) =>
          sum(values.map((value) => value.overdueRows)),
        ),
      ),
      incompletePortfolios: groupOracles.filter((values) =>
        values.some((value) => value.reasons.size),
      ).length,
    };
    stage = 'in_memory_production_drafts';
    const build = webModule(
      resolve(
        webRoot,
        'app/(app)/finance/payment-tracking/_lib/payment-message',
      ),
    ).buildPaymentMessage as Builder;
    check(typeof build === 'function', 'browser draft helper export');
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
        getMany: async () => [],
        history: async () => ({ items: [], hasMore: false }),
        assignables: async () => [],
      } as unknown as PaymentTrackingStoreService,
    );
    const variants = new Map<
      string,
      { lengths: number[]; incomplete: number; tooLong: number }
    >();
    const seenGroups = new Set<string>();
    let detailsVerified = 0;
    for (const item of snapshot.cases) {
      const detail = await service.detail(item.key);
      const pair =
        item.identity.customerCode?.trim() && item.identity.unitCode?.trim()
          ? JSON.stringify([item.identity.customerCode, item.identity.unitCode])
          : item.key;
      const expectedCases = groups.get(pair)!;
      check(
        detail.portfolio.cases.length === expectedCases.length &&
          expectedCases.every((value) =>
            detail.portfolio.cases.some((entry) => entry.key === value.key),
          ),
        'production detail exact portfolio cases',
      );
      check(
        detail.portfolio.installments.length ===
          sum(expectedCases.map((value) => value.installments.length)),
        'production detail complete installment count',
      );
      for (const expected of expectedCases) {
        const rows = detail.portfolio.installments.filter(
          (row) => row.caseKey === expected.key,
        );
        check(
          rows.every((row) => row.currency === expected.identity.currency),
          'detail source currency preserved',
        );
        check(
          JSON.stringify(
            rows.map(({ caseKey: _key, currency: _currency, ...row }) => row),
          ) === JSON.stringify(expected.installments),
          'detail preserves source financial rows',
        );
      }
      detailsVerified++;
      const scopes: Array<'portfolio' | 'selected'> = seenGroups.has(pair)
        ? ['selected']
        : ['portfolio', 'selected'];
      seenGroups.add(pair);
      for (const scope of scopes)
        for (const tr of [true, false]) {
          const expected = (scope === 'portfolio' ? expectedCases : [item]).map(
            (entry) => byCase.get(entry.key)!,
          );
          const before = JSON.stringify(detail);
          const draft = build(detail, { tr, scope });
          check(
            JSON.stringify(detail) === before,
            'builder does not mutate detail',
          );
          check(
            draft.incomplete ===
              expected.some((value) => value.reasons.size > 0),
            'incomplete flag matches independent source audit',
          );
          check(
            draft.tooLong === draft.body.length > 4000,
            'length flag matches exact character count',
          );
          validateDraft(draft.body, expected, tr);
          const key = `${scope}_${tr ? 'tr' : 'en'}`;
          const variant = variants.get(key) ?? {
            lengths: [],
            incomplete: 0,
            tooLong: 0,
          };
          variant.lengths.push(draft.body.length);
          variant.incomplete += Number(draft.incomplete);
          variant.tooLong += Number(draft.tooLong);
          variants.set(key, variant);
        }
    }
    report.productionDetailsVerified = detailsVerified;
    report.draftVariants = Object.fromEntries(
      [...variants].map(([key, value]) => [
        key,
        {
          characters: statistics(value.lengths),
          incomplete: value.incomplete,
          above4000Characters: value.tooLong,
        },
      ]),
    );
    report.verification = {
      exactIdentityAndSourceRows: 'PASS',
      independentCurrencyTotalsAndMonthlySums: 'PASS',
      independentMonthTypesOrderingAndCivilDayDelays: 'PASS',
      portfolioAndSelectedCurrencyScopesInBothLanguages: 'PASS',
      incompleteAndLengthFlags: 'PASS',
      sourceInputUnchanged: 'PASS',
      noWorkflowReadsOrWritesAndNoOutboundMessages: 'PASS',
    };
    report.status = 'PASS';
    report.elapsedMs = Date.now() - started;
    persist();
    console.log(
      JSON.stringify({
        status: report.status,
        sourceRows: snapshot.recordCount,
        currencyCases: snapshot.cases.length,
        portfolios: groups.size,
        draftsVerified: sum(
          [...variants.values()].map((value) => value.lengths.length),
        ),
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
