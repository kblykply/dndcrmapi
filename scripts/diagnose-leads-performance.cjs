// Read-only local diagnostic. It prints timing/counts, never lead data or credentials.
// Run from api/: node scripts/diagnose-leads-performance.cjs
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const base = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(base, '.env'));
const options = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ca: fs.readFileSync(path.join(base, 'supabase-ca.crt'), 'utf8'),
    rejectUnauthorized: true,
  },
  options: '-c default_transaction_read_only=on -c statement_timeout=10000',
  connectionTimeoutMillis: 12000,
};
const round = (value) => Math.round(value * 100) / 100;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stage = 'initializing';

async function idleProbe(name, min, idleTimeoutMillis) {
  const pool = new Pool({ ...options, max: 2, min, idleTimeoutMillis });
  let connections = 0;
  pool.on('connect', () => connections++);
  try {
    stage = name;
    const first = performance.now();
    await pool.query('SELECT 1');
    const initialMs = round(performance.now() - first);
    await pause(6100);
    const before = performance.now();
    await pool.query('SELECT 1');
    return {
      name,
      initialMs,
      afterIdleMs: round(performance.now() - before),
      connectionsCreated: connections,
    };
  } finally {
    await pool.end();
  }
}

(async () => {
  const pool = new Pool({
    ...options,
    max: 2,
    min: 1,
    idleTimeoutMillis: 60000,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: [{ emit: 'event', level: 'query' }],
  });
  let current = [];
  prisma.$on('query', (event) =>
    current.push({
      userRelation: event.query.includes('"User"'),
      durationMs: event.duration,
    }),
  );
  const where = {
    archivedAt: null,
    AND: [{ activities: { none: { callOutcome: 'NOT_INTERESTED' } } }],
  };
  const orderBy = [
    { nextFollowUpAt: 'asc' },
    { lastActivityAt: 'desc' },
    { createdAt: 'desc' },
    { id: 'asc' },
  ];
  const owner = { select: { id: true, name: true, email: true } };
  const samples = [];
  let baselineIds;
  try {
    // Some hosted poolers ignore startup options; enforce read-only on the transaction.
    await prisma.$transaction(
      async (tx) => {
        stage = 'verify-read-only';
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");
        const readonly = await tx.$queryRawUnsafe('SHOW transaction_read_only');
        if (readonly[0].transaction_read_only !== 'on')
          throw new Error('Read-only session required');
        // Warm up both baseline and optimized paths before comparing durations.
        for (let iteration = 0; iteration < 3; iteration++) {
          for (const mode of [
            'before',
            'after-first-page',
            'after-cached-total-page',
          ]) {
            stage = `${mode}-${iteration}`;
            current = [];
            const started = performance.now();
            const rows = await tx.lead.findMany({
              where,
              orderBy,
              take: 25,
              skip: 0,
              ...(mode === 'before'
                ? {
                    include: {
                      ownerCallCenter: owner,
                      assignedManager: owner,
                      assignedSales: owner,
                    },
                  }
                : {}),
            });
            const total =
              mode === 'after-cached-total-page'
                ? undefined
                : await tx.lead.count({ where });
            const elapsedMs = round(performance.now() - started);
            const ids = rows.map((row) => row.id).join('|');
            if (baselineIds === undefined) baselineIds = ids;
            if (ids !== baselineIds)
              throw new Error('List changed while benchmarking; compare again');
            if (iteration > 0)
              samples.push({
                mode,
                elapsedMs,
                rows: rows.length,
                total,
                sqlQueries: current.length,
                ownerQueries: current.filter((q) => q.userRelation).length,
                payloadBytes: Buffer.byteLength(
                  JSON.stringify({ items: rows, total }),
                ),
              });
          }
        }
      },
      { maxWait: 20000, timeout: 60000 },
    );
  } finally {
    await prisma.$disconnect();
    if (!pool.ended) await pool.end();
  }
  const idle = [];
  idle.push(await idleProbe('before-min0-idle5s', 0, 5000));
  idle.push(await idleProbe('after-min1-idle60s', 1, 60000));
  const report = {
    capturedAt: new Date().toISOString(),
    scope:
      'Local process to the configured remote database; read-only, same 25-row filtered page, no HTTP/browser timing.',
    sameRowsVerified: true,
    samples,
    idle,
  };
  const output = '/private/tmp/crm-leads-optimization-performance.json';
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(
    JSON.stringify({
      name: error.name,
      code: error.code,
      message: 'Read-only benchmark failed; no data was modified.',
    }),
  );
  console.error(
    JSON.stringify({
      stage,
      reason: [
        'Read-only session required',
        'List changed while benchmarking; compare again',
        'Called end on pool more than once',
      ].includes(error.message)
        ? error.message
        : 'Driver or connection error',
    }),
  );
  process.exitCode = 1;
});
