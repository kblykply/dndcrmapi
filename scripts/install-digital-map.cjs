#!/usr/bin/env node
/* Explicit operational installer. Default mode only reads the target database. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const ts = require('typescript');
const { Pool } = require('pg');

const API_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(API_ROOT, '..');
const MAP_ID = 'dnd-digital-map';
const ACTOR_ID = 'system:digital-map-setup';
const ACTOR_NAME = 'DND altyapı kurulumu';
const BACKUP_DIRECTORY = '/private/tmp';

class InstallError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseArguments(args) {
  const options = {
    apply: false,
    validateOnly: false,
    help: false,
    expectedVersion: undefined,
  };
  let explicitDryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') explicitDryRun = true;
    else if (arg === '--validate-only') options.validateOnly = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--expected-version') {
      const value = args[++index];
      if (
        !value ||
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) > 2_147_483_646
      ) {
        throw new InstallError(
          'INVALID_ARGUMENTS',
          '--expected-version requires an integer from 0 through 2147483646.',
        );
      }
      options.expectedVersion = Number(value);
    } else {
      throw new InstallError(
        'INVALID_ARGUMENTS',
        'Unknown argument. Use --help for supported options.',
      );
    }
  }
  if (options.apply && (explicitDryRun || options.validateOnly)) {
    throw new InstallError(
      'INVALID_ARGUMENTS',
      '--apply cannot be combined with --dry-run or --validate-only.',
    );
  }
  return options;
}

/** Compile current repository sources, so neither a copied template nor stale dist is installed. */
function sourceLoader() {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (
      !filename.startsWith(WORKSPACE_ROOT + path.sep) ||
      !filename.endsWith('.ts')
    ) {
      throw new InstallError(
        'INVALID_SOURCE',
        'A source dependency resolved outside the workspace.',
      );
    }
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        emitDecoratorMetadata: false,
      },
      fileName: filename,
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module);
    const nativeRequire = createRequire(filename);
    const localRequire = (specifier) => {
      if (!specifier.startsWith('.')) return nativeRequire(specifier);
      let resolved = path.resolve(path.dirname(filename), specifier);
      if (resolved.endsWith('.js')) resolved = resolved.slice(0, -3) + '.ts';
      else if (!resolved.endsWith('.ts')) resolved += '.ts';
      return load(resolved);
    };
    new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      compiled,
    )(module.exports, localRequire, module, filename, path.dirname(filename));
    return module.exports;
  }
  return load;
}

function buildTopology() {
  const load = sourceLoader();
  const topology = load(
    path.join(WORKSPACE_ROOT, 'web/src/app/(app)/digital-map/_lib/topology.ts'),
  );
  const validator = load(
    path.join(API_ROOT, 'src/digital-map/digital-map.dto.ts'),
  );
  try {
    const validated = validator.validateDigitalMap({
      ...topology.createDndInfrastructure('tr'),
      version: 0,
    });
    const { version: _version, ...document } = validated;
    return document;
  } catch {
    throw new InstallError(
      'TOPOLOGY_INVALID',
      'The current web topology failed the current API graph validator.',
    );
  }
}

function summary(document) {
  return {
    nodes: document.nodes.length,
    edges: document.edges.length,
    systems: new Set(
      document.nodes.map((node) => node.systemKey).filter(Boolean),
    ).size,
    sha256: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
  };
}

async function migrationStatus(client) {
  const {
    rows: [tables],
  } = await client.query(`
    SELECT to_regclass('public."DigitalMapDocument"') IS NOT NULL AS "mapTableExists",
           to_regclass('public."DigitalMapImage"') IS NOT NULL AS "imageTableExists",
           to_regclass('public._prisma_migrations') IS NOT NULL AS "migrationTableExists"
  `);
  const localMigrations = fs
    .readdirSync(path.join(API_ROOT, 'prisma/migrations'), {
      withFileTypes: true,
    })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(
          path.join(API_ROOT, 'prisma/migrations', entry.name, 'migration.sql'),
        ),
    )
    .map((entry) => entry.name)
    .sort();
  let history = [];
  if (tables.migrationTableExists) {
    ({ rows: history } = await client.query(
      'SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations',
    ));
  }
  const applied = new Set(
    history
      .filter((row) => row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name),
  );
  return {
    ...tables,
    pendingMigrations: localMigrations.filter((name) => !applied.has(name)),
    failedMigrations: history
      .filter((row) => !row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name),
  };
}

/** Use an exclusive file and durable flush: a backup failure must precede any write. */
function backupDocument(current, planned) {
  const timestamp = new Date().toISOString();
  const filename = path.join(
    BACKUP_DIRECTORY,
    `dnd-digital-map-backup-${timestamp.replace(/[:.]/g, '-')}.json`,
  );
  const file = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.fchmodSync(file, 0o600);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          backupFormatVersion: 1,
          backedUpAt: timestamp,
          documentId: MAP_ID,
          previousDocument: current,
          plannedTopology: summary(planned),
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    fs.fsyncSync(file);
  } finally {
    fs.closeSync(file);
  }
  return filename;
}

async function installWithClient(
  client,
  document,
  options,
  writeBackup = backupDocument,
) {
  await client.query(options.apply ? 'BEGIN' : 'BEGIN READ ONLY');
  let transactionOpen = true;
  let backupPath;
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const migrations = await migrationStatus(client);
    if (!migrations.mapTableExists) {
      if (options.apply)
        throw new InstallError(
          'MAP_TABLE_MISSING',
          'Apply the reviewed DigitalMapDocument migration before installing the map.',
        );
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        mode: 'dry-run',
        changed: false,
        current: null,
        planned: summary(document),
        migrations,
      };
    }

    // Existing records are locked across backup and update. A concurrent first insert
    // is resolved by the singleton primary key and cannot silently replace another save.
    const {
      rows: [current],
    } = await client.query(
      `SELECT * FROM public."DigitalMapDocument" WHERE "id" = $1${options.apply ? ' FOR UPDATE' : ''}`,
      [MAP_ID],
    );
    const currentVersion = current?.version ?? 0;
    if (
      options.expectedVersion !== undefined &&
      options.expectedVersion !== currentVersion
    ) {
      throw new InstallError(
        'VERSION_CONFLICT',
        'The map version changed since review. Run a fresh dry-run before applying.',
      );
    }
    if (
      !Number.isSafeInteger(currentVersion) ||
      currentVersion < 0 ||
      currentVersion >= 2_147_483_647
    ) {
      throw new InstallError(
        'INVALID_CURRENT_VERSION',
        'The current map version cannot be safely incremented.',
      );
    }
    const imageIds = [
      ...new Set(document.nodes.map((node) => node.imageId).filter(Boolean)),
    ];
    if (imageIds.length) {
      if (!migrations.imageTableExists)
        throw new InstallError(
          'IMAGE_TABLE_MISSING',
          'The topology references images but the image table does not exist.',
        );
      const images = await client.query(
        'SELECT id FROM public."DigitalMapImage" WHERE id = ANY($1::text[])',
        [imageIds],
      );
      if (images.rowCount !== imageIds.length)
        throw new InstallError(
          'IMAGE_NOT_FOUND',
          'The topology references an image absent from this database.',
        );
    }
    const identical = Boolean(
      current &&
      current.name === document.name &&
      isDeepStrictEqual(current.nodes, document.nodes) &&
      isDeepStrictEqual(current.edges, document.edges),
    );
    const report = {
      mode: options.apply ? 'apply' : 'dry-run',
      changed: false,
      wouldChange: !identical,
      current: {
        exists: Boolean(current),
        version: currentVersion,
        nodes: current?.nodes?.length ?? 0,
        edges: current?.edges?.length ?? 0,
      },
      planned: summary(document),
      migrations,
    };
    if (!options.apply || identical) {
      await client.query('COMMIT');
      transactionOpen = false;
      return report;
    }

    // No database mutation occurs until the complete old document is on disk.
    backupPath = writeBackup(current ?? null, document);
    const parameters = [
      document.name,
      JSON.stringify(document.nodes),
      JSON.stringify(document.edges),
      ACTOR_ID,
      ACTOR_NAME,
      MAP_ID,
    ];
    const result = current
      ? await client.query(
          `UPDATE public."DigitalMapDocument"
          SET "name" = $1, "nodes" = $2::jsonb, "edges" = $3::jsonb,
              "updatedById" = $4, "updatedByName" = $5,
              "version" = "version" + 1, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
          WHERE "id" = $6 AND "version" = $7 RETURNING "version"`,
          [...parameters, currentVersion],
        )
      : await client.query(
          `INSERT INTO public."DigitalMapDocument"
          ("name", "nodes", "edges", "updatedById", "updatedByName", "id", "version", "createdAt", "updatedAt")
          VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, 1,
                  clock_timestamp() AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC')
          RETURNING "version"`,
          parameters,
        );
    if (result.rowCount !== 1)
      throw new InstallError(
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
      'Usage: node scripts/install-digital-map.cjs [--dry-run | --apply | --validate-only] [--expected-version N]\nDefault: read-only database dry-run. --apply replaces the shared map after a private backup. No migrations or image deletions are performed.',
    );
    return;
  }
  const document = buildTopology();
  if (options.validateOnly) {
    console.log(
      JSON.stringify(
        { mode: 'validate-only', valid: true, planned: summary(document) },
        null,
        2,
      ),
    );
    return;
  }
  require('dotenv').config({ path: path.join(API_ROOT, '.env'), quiet: true });
  if (!process.env.DATABASE_URL)
    throw new InstallError(
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
        await installWithClient(client, document, options),
        null,
        2,
      ),
    );
  } finally {
    client?.release();
    await pool.end();
  }
}

module.exports = {
  parseArguments,
  buildTopology,
  summary,
  installWithClient,
  backupDocument,
};

if (require.main === module) {
  main().catch((error) => {
    const code =
      typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : 'INSTALL_FAILED';
    // Database messages/details can contain connection information or record values.
    console.error(
      JSON.stringify({
        code,
        message:
          error instanceof InstallError
            ? error.message
            : 'Installation did not complete. Check database connectivity, migrations and file permissions.',
        ...(error?.backupPath ? { backupPath: error.backupPath } : {}),
      }),
    );
    process.exitCode = 1;
  });
}
