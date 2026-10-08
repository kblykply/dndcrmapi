#!/usr/bin/env node
/* Optional one-member bootstrap. The default mode never writes to the database. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const API_ROOT = path.resolve(__dirname, '..');
const TARGET_NAME = 'Kubilay Kuplay';
const MEMBER_TITLE = 'Bilgi Teknolojileri';

class BootstrapError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseArguments(args) {
  const options = { apply: false, help: false };
  let explicitDryRun = false;
  for (const arg of args) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') explicitDryRun = true;
    else if (arg === '--help') options.help = true;
    else {
      throw new BootstrapError(
        'INVALID_ARGUMENTS',
        'Unknown argument. Use --help for supported options.',
      );
    }
  }
  if (options.apply && explicitDryRun) {
    throw new BootstrapError(
      'INVALID_ARGUMENTS',
      '--apply cannot be combined with --dry-run.',
    );
  }
  return options;
}

// Treat composed accents, Turkish dotted/dotless I, case and whitespace equally.
// The complete normalized name must match; partial/fuzzy matching is never used.
function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .trim()
    .replace(/\s+/gu, ' ');
}

function selectAccount(accounts) {
  const expectedName = normalizeName(TARGET_NAME);
  const matches = accounts.filter(
    (account) =>
      account.isActive === true &&
      account.role === 'ADMIN' &&
      normalizeName(account.name) === expectedName,
  );
  if (matches.length !== 1) {
    throw new BootstrapError(
      matches.length ? 'AMBIGUOUS_ACCOUNT' : 'ACCOUNT_NOT_FOUND',
      matches.length
        ? 'Multiple active ADMIN accounts match Kubilay Kuplay. Review the accounts before retrying.'
        : 'Exactly one active ADMIN account named Kubilay Kuplay is required. No accounts or permissions were changed.',
    );
  }
  return matches[0];
}

async function bootstrapWithClient(client, options = {}) {
  const apply = options.apply === true;
  await client.query(
    apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  let transactionOpen = true;
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const { rows: tables } = await client.query(
      `SELECT to_regclass('public."DigitalTeamMember"') IS NOT NULL AS "memberTableExists"`,
    );
    const report = {
      mode: apply ? 'apply' : 'dry-run',
      changed: false,
      targetName: TARGET_NAME,
    };
    if (!tables[0]?.memberTableExists) {
      if (apply) {
        throw new BootstrapError(
          'MIGRATION_REQUIRED',
          'DigitalTeamMember is missing. Apply the reviewed Digital Team migration before using --apply.',
        );
      }
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        ...report,
        status: 'MIGRATION_REQUIRED',
        message:
          'DigitalTeamMember is missing. No changes made; this script does not run migrations.',
      };
    }

    if (apply) {
      // A very short operational transaction: block account changes and member
      // writes while checking normalized names (which have no unique DB index).
      // Both locks are acquired before reading accounts or existing members.
      await client.query('LOCK TABLE public."User" IN SHARE MODE');
      await client.query(
        'LOCK TABLE public."DigitalTeamMember" IN SHARE ROW EXCLUSIVE MODE',
      );
    }
    const { rows: accounts } = await client.query(
      'SELECT "id", "name", "role", "isActive" FROM public."User" WHERE "role" = $1 AND "isActive" = true',
      ['ADMIN'],
    );
    const account = selectAccount(accounts);
    const { rows: members } = await client.query(
      'SELECT "id", "userId", "name" FROM public."DigitalTeamMember"',
    );
    const linkedMember = members.find((member) => member.userId === account.id);
    if (linkedMember) {
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        ...report,
        status: 'ALREADY_PRESENT',
        memberId: linkedMember.id,
      };
    }
    if (
      members.some(
        (member) => normalizeName(member.name) === normalizeName(TARGET_NAME),
      )
    ) {
      throw new BootstrapError(
        'MEMBER_REVIEW_REQUIRED',
        'A team member with this name already exists without the matching account link. Review that member before retrying.',
      );
    }
    const plannedMember = {
      name: account.name,
      title: MEMBER_TITLE,
      contact: '',
    };
    if (!apply) {
      await client.query('COMMIT');
      transactionOpen = false;
      return { ...report, status: 'READY', plannedMember };
    }

    // IDs are opaque Prisma String values; raw SQL must supply its own ID because
    // Prisma's cuid() is a client default, rather than a PostgreSQL default.
    const result = await client.query(
      `INSERT INTO public."DigitalTeamMember"
        ("id", "userId", "name", "title", "contact", "isActive", "version", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("userId") DO NOTHING
       RETURNING "id"`,
      [randomUUID(), account.id, account.name, MEMBER_TITLE, ''],
    );
    if (!result.rows.length) {
      // Defense in depth for a concurrent or repeated linked-member creation.
      const { rows: existing } = await client.query(
        'SELECT "id" FROM public."DigitalTeamMember" WHERE "userId" = $1',
        [account.id],
      );
      if (!existing[0]) {
        throw new BootstrapError(
          'MEMBER_CONFLICT',
          'Member creation conflicted with another change. No changes committed; rerun the dry-run.',
        );
      }
      await client.query('COMMIT');
      transactionOpen = false;
      return { ...report, status: 'ALREADY_PRESENT', memberId: existing[0].id };
    }
    await client.query('COMMIT');
    transactionOpen = false;
    return {
      ...report,
      status: 'CREATED',
      changed: true,
      memberId: result.rows[0].id,
      member: plannedMember,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original safe error remains the result if the connection is gone.
      }
    }
    if (error?.code === '23505') {
      throw new BootstrapError(
        'MEMBER_CONFLICT',
        'Member creation hit a unique constraint. No changes committed; rerun the dry-run.',
      );
    }
    throw error;
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log(
      'Usage: node scripts/bootstrap-digital-team.cjs [--dry-run | --apply]\nDefault: read-only dry-run. --apply creates at most one member linked to the unique active ADMIN named Kubilay Kuplay. Existing linked members are unchanged. No users, permissions, projects or migrations are modified.',
    );
    return;
  }
  require('dotenv').config({ path: path.join(API_ROOT, '.env'), quiet: true });
  if (!process.env.DATABASE_URL) {
    throw new BootstrapError(
      'DATABASE_URL_MISSING',
      'DATABASE_URL must be configured in the API environment.',
    );
  }
  const { Pool } = require('pg');
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
      JSON.stringify(await bootstrapWithClient(client, options), null, 2),
    );
  } finally {
    client?.release();
    await pool.end();
  }
}

module.exports = {
  BootstrapError,
  parseArguments,
  normalizeName,
  selectAccount,
  bootstrapWithClient,
};

if (require.main === module) {
  main().catch((error) => {
    // Never print database details, record values, environment values or URLs.
    console.error(
      JSON.stringify({
        code: error instanceof BootstrapError ? error.code : 'BOOTSTRAP_FAILED',
        message:
          error instanceof BootstrapError
            ? error.message
            : 'Bootstrap did not complete. Check database connectivity, migrations and permissions; rerun the dry-run before retrying.',
      }),
    );
    process.exitCode = 1;
  });
}
