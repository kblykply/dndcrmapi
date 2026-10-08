#!/usr/bin/env node
/* Update three Windows/Logo DATA edges atomically in the current map; never reinstall the template. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const ts = require('typescript');
const { Pool } = require('pg');
const {
  buildTopology,
  backupDocument,
  parseArguments,
} = require('./install-digital-map.cjs');

const API_ROOT = path.resolve(__dirname, '..');
const MAP_ID = 'dnd-digital-map';
const FLOW_DEFINITIONS = [
  {
    id: 'data-talep-restoran-logo',
    source: 'service-talep-restoran-windows',
    target: 'service-logo-windows',
  },
  {
    id: 'data-talep-insaat-logo',
    source: 'service-talep-insaat-windows',
    target: 'service-logo-windows',
  },
  {
    id: 'data-logo-muhasebe-crm',
    source: 'service-logo-windows',
    target: 'service-muhasebe-crm-windows',
  },
];
const ACTOR_ID = 'system:digital-map-setup';
const ACTOR_NAME = 'DND altyapı kurulumu';

class FlowError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function loadValidator() {
  const filename = path.join(API_ROOT, 'src/digital-map/digital-map.dto.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', compiled)(
    module.exports,
    createRequire(filename),
    module,
  );
  return module.exports.validateDigitalMap;
}

function assertIntendedEdges(edges) {
  const byId = new Map(
    Array.isArray(edges) ? edges.map((edge) => [edge.id, edge]) : [],
  );
  if (
    !Array.isArray(edges) ||
    edges.length !== FLOW_DEFINITIONS.length ||
    byId.size !== FLOW_DEFINITIONS.length ||
    FLOW_DEFINITIONS.some((flow) => {
      const edge = byId.get(flow.id);
      return (
        !edge ||
        edge.source !== flow.source ||
        edge.target !== flow.target ||
        edge.kind !== 'DATA' ||
        edge.bidirectional === true
      );
    })
  ) {
    throw new FlowError(
      'SOURCE_EDGES_INVALID',
      'Only the three confirmed one-way Windows/Logo DATA connections may be changed.',
    );
  }
}

function getIntendedEdges() {
  const ids = new Set(FLOW_DEFINITIONS.map((flow) => flow.id));
  const edges = buildTopology().edges.filter((edge) => ids.has(edge.id));
  assertIntendedEdges(edges);
  return edges;
}

function mergeCurrent(current, intendedEdges, validate = loadValidator()) {
  if (!current)
    throw new FlowError(
      'MAP_NOT_FOUND',
      'The shared map does not exist. This updater never creates or reinstalls a map.',
    );
  if (!Array.isArray(current.nodes) || !Array.isArray(current.edges)) {
    throw new FlowError(
      'CURRENT_MAP_INVALID',
      'The stored map must contain node and edge arrays.',
    );
  }
  assertIntendedEdges(intendedEdges);
  const nodeIds = new Set(current.nodes.map((node) => node.id));
  if (
    FLOW_DEFINITIONS.some(
      (flow) => !nodeIds.has(flow.source) || !nodeIds.has(flow.target),
    )
  ) {
    throw new FlowError(
      'ENDPOINT_MISSING',
      'The stored map is missing a required Talep, Logo or Muhasebe CRM service. No template replacement will be performed.',
    );
  }
  const replacements = new Map(intendedEdges.map((edge) => [edge.id, edge]));
  const existingIds = new Set(current.edges.map((edge) => edge.id));
  const edges = current.edges.map((edge) => replacements.get(edge.id) ?? edge);
  for (const edge of intendedEdges)
    if (!existingIds.has(edge.id)) edges.push(edge);
  const merged = { name: current.name, nodes: current.nodes, edges };
  try {
    // Validate the complete merged graph without replacing existing objects with
    // the validator's whitelisted copy; unrelated fields must remain untouched.
    validate({ ...merged, version: current.version });
  } catch {
    throw new FlowError(
      'MERGED_MAP_INVALID',
      'The current map with the three Windows/Logo connections failed API graph validation.',
    );
  }
  return merged;
}

async function applyWithClient(
  client,
  intendedEdges,
  options,
  writeBackup = backupDocument,
) {
  await client.query(options.apply ? 'BEGIN' : 'BEGIN READ ONLY');
  let transactionOpen = true;
  let backupPath;
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const {
      rows: [current],
    } = await client.query(
      `SELECT * FROM public."DigitalMapDocument" WHERE "id" = $1${options.apply ? ' FOR UPDATE' : ''}`,
      [MAP_ID],
    );
    if (!current)
      throw new FlowError(
        'MAP_NOT_FOUND',
        'The shared map does not exist. This updater never creates or reinstalls a map.',
      );
    if (
      options.expectedVersion !== undefined &&
      options.expectedVersion !== current.version
    ) {
      throw new FlowError(
        'VERSION_CONFLICT',
        'The map version changed since review. Run a fresh dry-run before applying.',
      );
    }
    if (
      !Number.isSafeInteger(current.version) ||
      current.version < 1 ||
      current.version > 2_147_483_646
    ) {
      throw new FlowError(
        'INVALID_CURRENT_VERSION',
        'The current map version cannot be safely incremented.',
      );
    }
    const merged = mergeCurrent(current, intendedEdges);
    const identical = isDeepStrictEqual(current.edges, merged.edges);
    const report = {
      mode: options.apply ? 'apply' : 'dry-run',
      changed: false,
      wouldChange: !identical,
      current: {
        version: current.version,
        nodes: current.nodes.length,
        edges: current.edges.length,
      },
      planned: {
        nodes: merged.nodes.length,
        edges: merged.edges.length,
        connections: intendedEdges,
      },
    };
    if (!options.apply || identical) {
      await client.query('COMMIT');
      transactionOpen = false;
      return report;
    }

    // The complete original row is backed up while its update lock is held.
    // If the private backup fails, no database write has happened.
    backupPath = writeBackup(current, merged);
    const result = await client.query(
      `UPDATE public."DigitalMapDocument"
      SET "edges" = $1::jsonb,
          "updatedById" = $2, "updatedByName" = $3,
          "version" = "version" + 1, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
      WHERE "id" = $4 AND "version" = $5 RETURNING "version"`,
      [
        JSON.stringify(merged.edges),
        ACTOR_ID,
        ACTOR_NAME,
        MAP_ID,
        current.version,
      ],
    );
    if (result.rowCount !== 1)
      throw new FlowError(
        'VERSION_CONFLICT',
        'The map changed while applying. The transaction has been rolled back.',
      );
    await client.query('COMMIT');
    transactionOpen = false;
    return {
      ...report,
      changed: true,
      version: result.rows[0].version,
      backupPath,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* Connection may already be closed. */
      }
    }
    if (backupPath) error.backupPath = backupPath;
    throw error;
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log(
      'Usage: node scripts/add-windows-logo-flows.cjs [--dry-run | --apply | --validate-only] [--expected-version N]\nDefault: read-only dry-run. Updates only the three confirmed Windows/Logo DATA edges atomically in the current shared map after a private backup.',
    );
    return;
  }
  const intendedEdges = getIntendedEdges();
  if (options.validateOnly) {
    console.log(
      JSON.stringify(
        { mode: 'validate-only', valid: true, connections: intendedEdges },
        null,
        2,
      ),
    );
    return;
  }
  require('dotenv').config({ path: path.join(API_ROOT, '.env'), quiet: true });
  if (!process.env.DATABASE_URL)
    throw new FlowError(
      'DATABASE_URL_MISSING',
      'DATABASE_URL must be configured in the API environment.',
    );
  const caPath = path.join(API_ROOT, 'supabase-ca.crt');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: fs.existsSync(caPath)
      ? { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 1000,
  });
  let client;
  try {
    client = await pool.connect();
    console.log(
      JSON.stringify(
        await applyWithClient(client, intendedEdges, options),
        null,
        2,
      ),
    );
  } finally {
    client?.release();
    await pool.end();
  }
}

module.exports = { getIntendedEdges, mergeCurrent, applyWithClient };

if (require.main === module) {
  main().catch((error) => {
    const code =
      typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : 'FLOW_UPDATE_FAILED';
    console.error(
      JSON.stringify({
        code,
        message:
          error instanceof FlowError
            ? error.message
            : 'The flow update did not complete. Check connectivity, map validation and backup permissions.',
        ...(error?.backupPath ? { backupPath: error.backupPath } : {}),
      }),
    );
    process.exitCode = 1;
  });
}
