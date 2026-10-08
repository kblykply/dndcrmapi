import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';

// SELECT metadata only. Returned definitions are saved as text and NEVER executed.
async function main() {
  const settings = {
    ...parse(readFileSync(resolve(__dirname, '../.env'))),
    ...process.env,
  };
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const output = resolve(
    __dirname,
    '../../output/logo-view-definitions-2026-10-03',
  );
  mkdirSync(resolve(output, 'sql'), { recursive: true });
  const evidence: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    mode: 'SELECT_ONLY_METADATA',
    results: [],
  };
  const results = evidence.results as Array<Record<string, unknown>>;
  try {
    for (const [name, query] of [
      [
        'permission',
        `SELECT DB_NAME() AS databaseName, CONVERT(varchar(33),SYSDATETIMEOFFSET(),127) AS databaseTime, HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION') AS canViewDefinition`,
      ],
      [
        'views',
        `SELECT SCHEMA_NAME(v.schema_id) AS schemaName, v.name, v.create_date AS createdAt, v.modify_date AS modifiedAt, HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(v.schema_id))+'.'+QUOTENAME(v.name),'OBJECT','SELECT') AS canRead, HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(v.schema_id))+'.'+QUOTENAME(v.name),'OBJECT','VIEW DEFINITION') AS canViewDefinition, OBJECTPROPERTYEX(v.object_id,'IsEncrypted') AS isEncrypted, m.definition FROM sys.views v LEFT JOIN sys.sql_modules m ON m.object_id=v.object_id ORDER BY v.name`,
      ],
      [
        'dependencies',
        `SELECT SCHEMA_NAME(o.schema_id) AS schemaName, o.name AS objectName, o.type_desc AS objectType, d.referenced_server_name AS referencedServer, d.referenced_database_name AS referencedDatabase, d.referenced_schema_name AS referencedSchema, d.referenced_entity_name AS referencedEntity, d.is_ambiguous AS isAmbiguous FROM sys.sql_expression_dependencies d JOIN sys.objects o ON o.object_id=d.referencing_id WHERE o.type IN ('V','FN','IF','TF') ORDER BY o.name,d.referenced_entity_name`,
      ],
      [
        'functions',
        `SELECT SCHEMA_NAME(o.schema_id) AS schemaName, o.name, o.type_desc AS objectType, m.definition FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE o.type IN ('FN','IF','TF') AND o.is_ms_shipped=0 ORDER BY o.name`,
      ],
      [
        'synonyms',
        `SELECT SCHEMA_NAME(schema_id) AS schemaName, name, base_object_name AS target FROM sys.synonyms ORDER BY name`,
      ],
    ]) {
      const started = Date.now();
      try {
        const rows = await database.query<Record<string, unknown>>(query);
        results.push({ name, query, elapsedMs: Date.now() - started, rows });
        if (name === 'views' || name === 'functions') {
          for (const row of rows) {
            if (typeof row.definition !== 'string') continue;
            const filename =
              `${String(row.schemaName)}.${String(row.name)}`.replace(
                /[^A-Za-z0-9_.-]/g,
                '_',
              ) + '.sql';
            writeFileSync(resolve(output, 'sql', filename), row.definition);
            row.definitionSha256 = createHash('sha256')
              .update(row.definition)
              .digest('hex');
          }
        }
        console.log(
          JSON.stringify({
            name,
            rows: rows.length,
            visibleDefinitions:
              name === 'views' || name === 'functions'
                ? rows.filter((row) => typeof row.definition === 'string')
                    .length
                : undefined,
            permission: name === 'permission' ? rows : undefined,
            elapsedMs: Date.now() - started,
          }),
        );
      } catch (error) {
        results.push({
          name,
          status: 'UNAVAILABLE',
          error: error instanceof Error ? error.name : 'UnknownError',
        });
        console.log(JSON.stringify({ name, status: 'UNAVAILABLE' }));
      }
    }
  } finally {
    await database.onModuleDestroy();
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(
      resolve(output, 'definitions.json'),
      JSON.stringify(evidence, null, 2),
    );
  }
}
void main().catch(() => {
  console.error('Metadata research failed; connection details omitted.');
  process.exitCode = 1;
});
