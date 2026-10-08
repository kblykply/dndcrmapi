import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import {
  LogoDatabaseService,
  type LogoQueryParameters,
} from '../src/logo-database/logo-database.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import {
  CONTACT_SNAPSHOT_QUERY,
  paymentSnapshotKey,
} from '../src/payment-tracking/payment-snapshot-key';

async function main() {
  const logo = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(process.env)),
  );
  const datasets = new Map<string, unknown[]>();
  const captured = {
    async query<T extends Record<string, unknown>>(
      query: string,
      parameters: LogoQueryParameters = {},
    ): Promise<T[]> {
      const rows = await logo.query<T>(query, parameters);
      datasets.set(paymentSnapshotKey(query, parameters), rows);
      return rows;
    },
  };
  const source = new PaymentTrackingSourceService(
    captured as LogoDatabaseService,
    new PaymentTrackingCatalogService(captured as LogoDatabaseService),
  );
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(resolve('supabase-ca.crt'), 'utf8'),
    },
  });
  try {
    const snapshot = await source.snapshot(true);
    if (
      snapshot.authorizationSource.status !== 'available' ||
      snapshot.authorizationSource.unmatchedCases > 0
    )
      throw new Error('Import requires complete verified invoice attributes');
    const contacts = await captured.query(CONTACT_SNAPSHOT_QUERY);
    if (contacts.length > 25000)
      throw new Error('Contact snapshot exceeds bounded import size');
    // Read contact view metadata too: runtime validates the exact columns before contact lookup.
    await new PaymentTrackingCatalogService(
      captured as LogoDatabaseService,
    ).requireView('L_223_OZET_SATIS');
    // Validate the exact JSON round trip used by PostgreSQL before activating anything.
    const replay = {
      async query<T extends Record<string, unknown>>(
        query: string,
        parameters: LogoQueryParameters = {},
      ): Promise<T[]> {
        const stored = datasets.get(paymentSnapshotKey(query, parameters));
        if (!stored) throw new Error('Snapshot query missing from import');
        return JSON.parse(JSON.stringify(stored)) as T[];
      },
    };
    const replaySource = new PaymentTrackingSourceService(
      replay as LogoDatabaseService,
      new PaymentTrackingCatalogService(replay as LogoDatabaseService),
    );
    try {
      const restored = await replaySource.snapshot(true);
      if (
        JSON.stringify(restored.cases) !== JSON.stringify(snapshot.cases) ||
        restored.recordCount !== snapshot.recordCount
      )
        throw new Error('JSON replay differs from live finance source');
    } finally {
      replaySource.onModuleDestroy();
    }
    const importedAt = new Date();
    const batchId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        readFileSync(
          resolve(
            'prisma/migrations/20261009010000_payment_source_snapshot/migration.sql',
          ),
          'utf8',
        ),
      );
      await client.query('LOCK TABLE "PaymentSourceBatch" IN EXCLUSIVE MODE');
      await client.query(
        'INSERT INTO "PaymentSourceBatch" (id,"importedAt","recordCount","caseCount") VALUES ($1,$2,$3,$4)',
        [batchId, importedAt, snapshot.recordCount, snapshot.cases.length],
      );
      for (const [key, payload] of datasets)
        await client.query(
          'INSERT INTO "PaymentSourceDataset" ("batchId",key,payload) VALUES ($1,$2,$3::jsonb)',
          [batchId, key, JSON.stringify(payload)],
        );
      await client.query(
        'UPDATE "PaymentSourceBatch" SET active=false WHERE active=true',
      );
      await client.query(
        'UPDATE "PaymentSourceBatch" SET active=true WHERE id=$1',
        [batchId],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify({
          batchId,
          importedAt: importedAt.toISOString(),
          records: snapshot.recordCount,
          cases: snapshot.cases.length,
          contactRows: contacts.length,
          datasets: datasets.size,
          jsonBytes: [...datasets.values()].reduce(
            (sum, rows) => sum + Buffer.byteLength(JSON.stringify(rows)),
            0,
          ),
        }),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    source.onModuleDestroy();
    await logo.onModuleDestroy();
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Payment snapshot import failed',
  );
  process.exitCode = 1;
});
