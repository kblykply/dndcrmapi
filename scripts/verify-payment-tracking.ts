import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import { PaymentTrackingStoreService } from '../src/payment-tracking/payment-tracking-store.service';
import {
  PaymentTrackingService,
  paymentList,
} from '../src/payment-tracking/payment-tracking.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Existing source and workflow data are read only. No credentials, contacts,
// source identities or financial amounts are written to the audit output.
async function main() {
  const settings = { ...parse(readFileSync(resolve('.env'))), ...process.env };
  for (const [key, value] of Object.entries(settings))
    if (value !== undefined) process.env[key] = value;
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const prisma = new PrismaService();
  const db = prisma as unknown as PrismaClient;
  const source = new PaymentTrackingSourceService(
    database,
    new PaymentTrackingCatalogService(database),
  );
  const store = new PaymentTrackingStoreService(prisma);
  const service = new PaymentTrackingService(source, store);
  const started = Date.now();
  try {
    const snapshot = await source.snapshot(true);
    const readMs = Date.now() - started;
    assert.equal(snapshot.view, 'L_223_ODEME_PLANI');
    assert.equal(
      snapshot.cases.reduce((sum, item) => sum + item.installmentCount, 0),
      snapshot.recordCount,
    );
    assert.equal(
      new Set(snapshot.cases.map((item) => item.key)).size,
      snapshot.cases.length,
    );
    const actor = await db.user.findFirst({
      where: { isActive: true, role: 'ADMIN' },
      select: { id: true, role: true },
    });
    assert(
      actor,
      'An active admin is needed for read-only service scope checks',
    );
    const list = await service.list(actor, { scope: 'all' });
    assert(list.rows.length <= 25);
    assert(
      list.rows.every(
        (item) => item.identity.currency === list.selectedCurrency,
      ),
    );
    assert.equal(
      list.total,
      snapshot.cases.filter(
        (item) => item.identity.currency === list.selectedCurrency,
      ).length,
    );
    assert.equal(snapshot.authorizationSource.status, 'available');
    const filterChecks: Array<Record<string, unknown>> = [];
    for (const currency of list.currencies) {
      const raw = {
        scope: 'all',
        currency: currency.value ?? '__NULL__',
        pageSize: 100,
      };
      const cases = snapshot.cases.filter(
        (item) => item.identity.currency === currency.value,
      );
      const coded = paymentList(snapshot, [], actor, {
        ...raw,
        authorizationState: 'coded',
      });
      const blank = paymentList(snapshot, [], actor, {
        ...raw,
        authorizationState: 'blank',
      });
      assert.equal(
        coded.total,
        cases.filter((item) => item.authorization.codes.length > 0).length,
      );
      assert.equal(
        blank.total,
        cases.filter(
          (item) =>
            item.authorization.status === 'matched' &&
            item.authorization.hasBlank &&
            item.authorization.codes.length === 0,
        ).length,
      );
      for (const entry of coded.filterOptions.authorizationCodes) {
        const exact = paymentList(snapshot, [], actor, {
          ...raw,
          authorizationCode: entry.value,
        });
        const expected = cases.filter((item) =>
          item.authorization.codes.includes(entry.value),
        );
        assert.equal(exact.total, expected.length);
        assert.equal(entry.caseCount, expected.length);
        for (const field of ['outstanding', 'overdueAmount'] as const) {
          const known = expected
            .map((item) => item[field])
            .filter((value): value is number => value !== null);
          const total = known.length
            ? known.reduce((sum, value) => sum + value, 0)
            : expected.length
              ? null
              : 0;
          const actual = exact.filteredSummary[field];
          if (total === null || actual === null) assert.equal(actual, total);
          else
            assert(
              Math.abs(actual - total) <=
                Math.max(0.02, Math.abs(total) * 1e-9),
              'Filtered total must cover every match before pagination',
            );
        }
        for (const row of exact.rows) {
          const original = expected.find((item) => item.key === row.key);
          assert(original);
          for (const field of [
            'amount',
            'paid',
            'outstanding',
            'overdueAmount',
            'installmentCount',
          ] as const)
            assert.equal(
              row[field],
              original[field],
              'Filtering changed full case totals',
            );
        }
      }
      for (const scope of ['all', 'overdue', 'paid']) {
        const result = paymentList(snapshot, [], actor, {
          ...raw,
          authorizationState: 'blank',
          scope,
          pageSize: 25,
        });
        const expected = cases
          .filter(
            (item) =>
              item.authorization.status === 'matched' &&
              item.authorization.hasBlank &&
              item.authorization.codes.length === 0,
          )
          .filter(
            (item) =>
              scope === 'all' ||
              (scope === 'overdue'
                ? (item.overdueAmount ?? 0) > 0
                : item.outstanding === 0 && item.incompleteRows === 0),
          );
        assert.equal(result.total, expected.length);
        const known = expected
          .map((item) => item.overdueAmount)
          .filter((value): value is number => value !== null);
        const total = known.length
          ? known.reduce((sum, value) => sum + value, 0)
          : expected.length
            ? null
            : 0;
        const actual = result.filteredSummary.overdueAmount;
        if (total === null || actual === null) assert.equal(actual, total);
        else
          assert(
            Math.abs(actual - total) <= Math.max(0.02, Math.abs(total) * 1e-9),
            'Blank-code and status totals must cover the full filtered result',
          );
      }
      const candidate = cases.find(
        (item) =>
          item.identity.customerCode &&
          item.identity.unitCode &&
          item.incompleteRows === 0 &&
          item.outstanding !== null,
      );
      if (candidate) {
        const exact = paymentList(snapshot, [], actor, {
          ...raw,
          customer: candidate.identity.customerCode,
          unit: candidate.identity.unitCode,
          balanceMin: Math.floor(candidate.outstanding!),
          balanceMax: Math.ceil(candidate.outstanding!),
          ...(candidate.authorization.codes[0]
            ? { authorizationCode: candidate.authorization.codes[0] }
            : {}),
          ...(candidate.representatives[0]
            ? { representative: candidate.representatives[0] }
            : {}),
          ...(candidate.brokers[0] ? { broker: candidate.brokers[0] } : {}),
          ...(candidate.invoiceDates[0]
            ? {
                invoiceFrom: candidate.invoiceDates[0],
                invoiceTo: candidate.invoiceDates[0],
              }
            : {}),
        });
        assert(
          exact.rows.some((row) => row.key === candidate.key),
          'Combined filters lost their source case',
        );
      }
      filterChecks.push({
        currency: currency.value,
        codedCases: coded.total,
        blankCases: blank.total,
        codeOptions: coded.filterOptions.authorizationCodes.length,
        status: 'PASS',
      });
    }
    const summary = await database.query<{
      currency: string | null;
      records: number;
      amount: number | null;
      paid: number | null;
      outstanding: number | null;
      overdue: number | null;
    }>(
      `SELECT DVZ AS currency, COUNT(*) AS records,
      SUM(TUTAR) AS amount, SUM(ODENEN) AS paid,
      SUM(CASE WHEN TUTAR IS NULL OR ODENEN IS NULL THEN NULL WHEN TUTAR-ODENEN > 0 THEN TUTAR-ODENEN ELSE 0 END) AS outstanding,
      SUM(CASE WHEN TUTAR IS NULL OR ODENEN IS NULL OR (TUTAR-ODENEN > 0 AND VADE IS NULL) THEN NULL WHEN TUTAR-ODENEN > 0 AND VADE < @today THEN TUTAR-ODENEN ELSE 0 END) AS overdue
      FROM [LOGO_DND].[dbo].[L_223_ODEME_PLANI] GROUP BY DVZ`,
      { today: new Date(snapshot.asOf + 'T00:00:00.000Z') },
    );
    const checks: Array<{
      currency: string | null;
      records: number;
      cases: number;
      status: string;
    }> = [];
    for (const group of summary) {
      const cases = snapshot.cases.filter(
        (item) => item.identity.currency === group.currency,
      );
      assert.equal(
        cases.reduce((total, item) => total + item.installmentCount, 0),
        group.records,
        'Source counts changed or do not reconcile',
      );
      for (const field of [
        'amount',
        'paid',
        'outstanding',
        'overdue',
      ] as const) {
        const key = field === 'overdue' ? 'overdueAmount' : field;
        const known = cases
          .map((item) => item[key])
          .filter((value): value is number => value !== null);
        const total = known.length
          ? known.reduce((sum, value) => sum + value, 0)
          : null;
        const expected = group[field];
        if (total === null || expected === null)
          assert.equal(total, expected, `Null ${field} mismatch`);
        else
          assert(
            Math.abs(total - expected) <=
              Math.max(0.02, Math.abs(expected) * 1e-9),
            `${field} totals do not reconcile`,
          );
      }
      checks.push({
        currency: group.currency,
        records: group.records,
        cases: cases.length,
        status: 'PASS',
      });
    }
    const candidate = list.rows.find((item) => item.canTrack);
    let detailCheck: Record<string, unknown> | null = null;
    if (candidate) {
      const detail = await service.detail(candidate.key);
      assert.equal(detail.item.key, candidate.key);
      assert.equal(detail.installments.length, detail.item.installmentCount);
      detailCheck = {
        status: 'PASS',
        installments: detail.installments.length,
        contactStatus: detail.contact.status,
        historyItems: detail.history.length,
      };
    }
    const output = {
      checkedAt: new Date().toISOString(),
      mode: 'READ_ONLY',
      database: snapshot.database,
      view: snapshot.view,
      sourceRows: snapshot.recordCount,
      cases: snapshot.cases.length,
      readOnlyCases: snapshot.cases.filter((item) => !item.canTrack).length,
      sourceReadMs: readMs,
      authorization: snapshot.authorizationSource,
      filters: filterChecks,
      currencies: checks,
      list: { status: 'PASS', pageSize: list.pageSize, total: list.total },
      detail: detailCheck,
      note: 'No workflow mutation or external communication was performed. Financial totals were reconciled internally and are not included in this report.',
    };
    writeFileSync(
      resolve(
        process.argv[2] ??
          '../output/finance-reset-2026-10-02/payment-tracking-logo-live-verification.json',
      ),
      JSON.stringify(output, null, 2) + '\n',
    );
    console.log(JSON.stringify(output));
  } finally {
    await database.onModuleDestroy();
    await prisma.onModuleDestroy();
  }
}
main().catch((error: unknown) => {
  const failure = error as {
    code?: string;
    name?: string;
    response?: { code?: string };
  };
  console.error(
    JSON.stringify({
      errorCode:
        failure.response?.code ||
        failure.code ||
        failure.name ||
        'CHECK_FAILED',
    }),
  );
  process.exitCode = 1;
});
