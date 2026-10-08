import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';

// Runs hand-written aggregate SELECT probes only, never captured view definitions.
async function main() {
  const settings = {
    ...parse(readFileSync(resolve(__dirname, '../.env'))),
    ...process.env,
  };
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const root = resolve(
    __dirname,
    '../../output/logo-view-definitions-2026-10-03',
  );
  const source = process.argv[2];
  if (!['collection', 'collection-followup', 'purchase'].includes(source))
    throw new Error('Unknown probe set');
  const probes = JSON.parse(
    readFileSync(resolve(root, 'analyses', `${source}-probes.json`), 'utf8'),
  ) as Array<{ name: string; sql: string }>;
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    source,
    mode: 'SEQUENTIAL_SELECT_ONLY',
    limitation:
      'Separate statements, not a transaction snapshot. No mutations and no captured DDL executed.',
    results: [],
  };
  const results = report.results as Array<Record<string, unknown>>;
  mkdirSync(resolve(root, 'checks'), { recursive: true });
  try {
    for (const probe of probes) {
      const started = Date.now();
      try {
        const rows = await database.query(probe.sql);
        results.push({
          name: probe.name,
          sql: probe.sql,
          readAt: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          rows,
        });
        console.log(
          JSON.stringify({
            name: probe.name,
            rows: rows.length,
            elapsedMs: Date.now() - started,
          }),
        );
      } catch (error) {
        results.push({
          name: probe.name,
          status: 'UNAVAILABLE',
          error: error instanceof Error ? error.name : 'UnknownError',
        });
        console.log(
          JSON.stringify({ name: probe.name, status: 'UNAVAILABLE' }),
        );
      }
    }
  } finally {
    await database.onModuleDestroy();
    report.finishedAt = new Date().toISOString();
    writeFileSync(
      resolve(root, 'checks', `${source}.json`),
      JSON.stringify(report, null, 2),
    );
  }
}
void main().catch(() => {
  console.error('Aggregate analysis failed; connection details omitted.');
  process.exitCode = 1;
});
