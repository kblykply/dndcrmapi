import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import { paymentList } from '../src/payment-tracking/payment-tracking.service';
import { buildCollectionReport } from '../src/payment-tracking/payment-collection-report.service';

// Only read Logo. Save counts and validation results, never account identities or balances.
async function main() {
  const settings = { ...parse(readFileSync(resolve('.env'))), ...process.env };
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const source = new PaymentTrackingSourceService(
    database,
    new PaymentTrackingCatalogService(database),
  );
  const started = Date.now();
  const checks: Array<Record<string, unknown>> = [];
  const actor = { id: 'read-only-validation', role: 'ADMIN' };
  try {
    const snapshot = await source.snapshot(true);
    assert.equal(snapshot.authorizationSource.status, 'available');
    assert(snapshot.cases.every((item) => item.invoiceOk));
    for (const currency of ['GBP', '__ALL__']) {
      for (const authorizationState of ['all', 'blank']) {
        const query = {
          currency,
          authorizationState,
          paymentKind: 'sale',
          scope: 'all',
        };
        const all = paymentList(snapshot, [], actor, query);
        assert.deepEqual(
          all,
          paymentList(snapshot, [], actor, { ...query, invoiceOk: 'all' }),
        );
        const reportsQuery = {
          currency,
          authorizationState,
          paymentKind: 'sale',
        };
        const allReport = buildCollectionReport(snapshot, reportsQuery);
        assert.deepEqual(
          allReport,
          buildCollectionReport(snapshot, {
            ...reportsQuery,
            invoiceOk: 'all',
          }),
        );
        const lists = all.invoiceOkOptions.map((option) =>
          paymentList(snapshot, [], actor, {
            ...query,
            invoiceOk: option.value,
          }),
        );
        const reports = all.invoiceOkOptions.map((option) =>
          buildCollectionReport(snapshot, {
            ...reportsQuery,
            invoiceOk: option.value,
          }),
        );
        assert.equal(
          lists.reduce((sum, part) => sum + part.total, 0),
          all.total,
        );
        assert.equal(
          reports.reduce((sum, part) => sum + part.detail.total, 0),
          allReport.detail.total,
        );
        for (const list of lists) {
          for (const row of list.rows) {
            const values = row.invoiceOk!;
            if (list.selectedInvoiceOk.startsWith('value:')) {
              assert.equal(values.status, 'matched');
              assert.equal(values.hasBlank, false);
              assert.deepEqual(values.values, [
                list.selectedInvoiceOk.slice(6),
              ]);
            }
          }
          checks.push({
            currency,
            authorizationState,
            filter: list.selectedInvoiceOk,
            cases: list.total,
            listRows: list.rows.length,
          });
        }
        for (const part of all.currencyBreakdown) {
          const sum = lists.reduce(
            (amount, list) =>
              amount +
              (list.currencyBreakdown.find(
                (row) => row.currency === part.currency,
              )?.filteredSummary.outstanding ?? 0),
            0,
          );
          assert(part.filteredSummary.outstanding !== null);
          assert(Math.abs(sum - part.filteredSummary.outstanding) < 0.01);
        }
        for (const part of allReport.byCurrency) {
          const filteredParts = reports.map(
            (report) =>
              report.byCurrency.find((row) => row.currency === part.currency)!,
          );
          for (const field of [
            'summary',
            'period',
            'overdue',
            'nextMonth',
          ] as const) {
            const expected = part[field].outstanding;
            assert(expected !== null);
            const actual = filteredParts.reduce(
              (sum, row) => sum + (row[field].outstanding ?? 0),
              0,
            );
            assert(Math.abs(actual - expected) < 0.01);
          }
          for (const month of [...part.monthly, ...part.historical]) {
            assert(month.outstanding !== null);
            const actual = filteredParts.reduce(
              (sum, row) =>
                sum +
                ([...row.monthly, ...row.historical].find(
                  (period) => period.month === month.month,
                )?.outstanding ?? 0),
              0,
            );
            assert(Math.abs(actual - month.outstanding) < 0.01);
          }
        }
      }
    }
    const result = {
      status: 'PASS',
      mode: 'READ_ONLY',
      checkedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      recordCount: snapshot.recordCount,
      cases: snapshot.cases.length,
      checks,
    };
    const directory = resolve('../output/payment-invoice-ok-2026-10-03');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, 'live-verification.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(JSON.stringify(result));
  } finally {
    source.onModuleDestroy();
    await database.onModuleDestroy();
  }
}
main().catch((error: unknown) => {
  const failure = error as {
    name?: string;
    code?: string;
    response?: { code?: string };
  };
  console.error(
    JSON.stringify({
      status: 'FAIL',
      code: failure.response?.code ?? failure.code ?? failure.name,
    }),
  );
  process.exitCode = 1;
});
