import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import {
  LogoDatabaseService,
  type LogoQueryParameters,
} from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import { PaymentTrackingStoreService } from '../src/payment-tracking/payment-tracking-store.service';
import { PaymentTrackingService } from '../src/payment-tracking/payment-tracking.service';
import type { PaymentTrackingList } from '../src/payment-tracking/payment-tracking.types';
import { PrismaService } from '../src/prisma/prisma.service';

// Read-only timings. Never output source values, identities, tokens or contacts.
const timings: Array<{ step: string; ms: number; rows?: number }> = [];
let stage = 'initialization';
class TimedDatabase extends LogoDatabaseService {
  override async query<T extends Record<string, unknown>>(
    query: string,
    parameters: LogoQueryParameters = {},
  ): Promise<T[]> {
    const start = performance.now();
    const issuedDuring = stage;
    const name = query.includes('[sys].')
      ? 'metadata'
      : query.includes('[L_223_ODEME_PLANI]')
        ? 'payments'
        : query.includes('[L_223_FATURA_VADE]')
          ? 'authorization'
          : 'other';
    const rows = await super.query<T>(query, parameters);
    timings.push({
      step: `${issuedDuring}.${name}`,
      ms: Math.round(performance.now() - start),
      rows: rows.length,
    });
    return rows;
  }
}
async function main() {
  const label = process.argv[2] ?? 'baseline';
  assert(['baseline', 'optimized'].includes(label));
  const settings = { ...parse(readFileSync(resolve('.env'))), ...process.env };
  for (const [key, value] of Object.entries(settings))
    if (value !== undefined) process.env[key] = value;
  const database = new TimedDatabase(
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
  const measure = async <T>(
    step: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    stage = step;
    const started = performance.now();
    const result = await run();
    const timing = { step, ms: Math.round(performance.now() - started) };
    timings.push(timing);
    console.log(JSON.stringify(timing));
    return result;
  };
  try {
    const actor = await measure('crmConnection', () =>
      db.user.findFirst({
        where: { isActive: true, role: 'ADMIN' },
        select: { id: true, role: true },
      }),
    );
    assert(actor);
    const cold = await measure('coldList', () =>
      service.list(actor, { scope: 'all' }),
    );
    // Source ready, but an independent store prevents crediting an already-warm assignee cache.
    const firstUserService = new PaymentTrackingService(
      source,
      new PaymentTrackingStoreService(prisma),
    );
    await measure('preparedFirstList', () =>
      firstUserService.list(actor, { scope: 'all' }),
    );
    const filter = await measure('warmBlankFilter', () =>
      service.list(actor, { scope: 'all', authorizationState: 'blank' }),
    );
    if (cold.rows[0])
      await measure('warmDetail', () => service.detail(cold.rows[0].key));
    for (let sample = 1; sample <= 5; sample += 1) {
      const repeated: PaymentTrackingList = await measure<PaymentTrackingList>(
        `warmFilterSample${sample}`,
        () =>
          service.list(actor, { scope: 'all', authorizationState: 'blank' }),
      );
      assert.deepEqual(repeated.rows, filter.rows);
      assert.deepEqual(repeated.filteredSummary, filter.filteredSummary);
    }
    const local = await measure('workflowReads', async () => {
      await store.getMany();
      await store.assignables();
    });
    void local;
    await new Promise((resolve) => setTimeout(resolve, 35_000));
    await measure('filterAfter35Seconds', () =>
      service.list(actor, { scope: 'all', authorizationState: 'blank' }),
    );
    // Await any coalesced refresh before disconnecting. Forced reads never use stale data.
    await measure('explicitRefresh', () =>
      service.list(actor, { scope: 'all', refresh: 'true' }),
    );
    const report = {
      checkedAt: new Date().toISOString(),
      mode: 'READ_ONLY',
      label,
      sourceRows: cold.source.recordCount,
      selectedCurrencyCases: cold.total,
      blankCases: filter.total,
      listPayloadBytes: Buffer.byteLength(JSON.stringify(cold)),
      timings,
    };
    writeFileSync(
      resolve(
        process.argv[3] ?? `docs/payment-tracking-performance-${label}.json`,
      ),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
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
      stage,
      errorCode:
        failure.response?.code ||
        failure.code ||
        failure.name ||
        'CHECK_FAILED',
    }),
  );
  process.exitCode = 1;
});
