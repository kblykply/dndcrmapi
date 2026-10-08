import 'reflect-metadata';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';

// Metadata SELECTs only. No credentials, contact fields or individual transactions.
async function main() {
  const settings = { ...parse(readFileSync(resolve(__dirname, '../.env'))), ...process.env };
  const config = new LogoConfigService(new ConfigService(settings));
  const database = new LogoDatabaseService(config);
  const output = resolve(__dirname, '../../output/logo-management-research-2026-10-02');
  mkdirSync(output, { recursive: true });
  const report: Record<string, unknown> = { readAt: new Date().toISOString(), mode: 'SELECT_ONLY_METADATA', configuredFirms: config.firms, configuredPeriod: config.periodNo, queries: [] };
  const queries = report.queries as Array<Record<string, unknown>>;
  try {
    for (const [name, query] of [
      ['database', `SELECT DB_NAME() AS databaseName, CONVERT(varchar(33),SYSDATETIMEOFFSET(),127) AS databaseTime, HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION') AS canViewDefinitions`],
      ['firms', `SELECT NR, NAME, TITLE, LOCALCTYP, FIRMREPCURR FROM dbo.L_CAPIFIRM ORDER BY NR`],
      ['periods', `SELECT FIRMNR, NR, BEGDATE, ENDDATE, ACTIVE FROM dbo.L_CAPIPERIOD ORDER BY FIRMNR, NR`],
      ['viewInventory', `SELECT SCHEMA_NAME(v.schema_id) AS schemaName, v.name, v.create_date AS createdAt, v.modify_date AS modifiedAt, HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(v.schema_id))+'.'+QUOTENAME(v.name),'OBJECT','SELECT') AS canRead, HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(v.schema_id))+'.'+QUOTENAME(v.name),'OBJECT','VIEW DEFINITION') AS canViewDefinition, m.definition FROM sys.views v LEFT JOIN sys.sql_modules m ON m.object_id=v.object_id WHERE v.name LIKE 'L[_]223[_]%' OR v.name LIKE 'LV[_]223[_]%CS%' OR v.name LIKE 'LV[_]223[_]%BN%' ORDER BY v.name`],
      ['financeTableInventory', `SELECT SCHEMA_NAME(t.schema_id) AS schemaName, t.name, SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS approximateRows, HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(t.schema_id))+'.'+QUOTENAME(t.name),'OBJECT','SELECT') AS canRead FROM sys.tables t LEFT JOIN sys.partitions p ON p.object_id=t.object_id WHERE t.name LIKE 'LG[_]%[_]PAYTRANS' OR t.name LIKE 'LG[_]%[_]INVOICE' OR t.name LIKE 'LG[_]%[_]CSCARD' OR t.name LIKE 'LG[_]%[_]BNFLINE' OR t.name LIKE 'LG[_]%[_]KSLINES' GROUP BY t.schema_id,t.name ORDER BY t.name`],
      ['candidateViewColumns', `SELECT v.name AS viewName, c.name AS columnName, ty.name AS dataType, c.column_id AS ordinal FROM sys.views v JOIN sys.columns c ON c.object_id=v.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE v.name IN ('L_223_SATINALMA_FAT','L_223_KAPATMA_YAPILMAYAN','L_223_CARI_DOKUM_2','L_223_CARI_HAREKET','L_223_BANKA_HAREKET','L_223_SPARIS_FATURA_HAREKET','L_223_TALEP_MALZEMEALIMI','L_223_PROJE_KODU_KONTROL','LV_223_01_CSCARD') ORDER BY v.name,c.column_id`],
    ]) {
      const started = Date.now();
      try {
        const rows = await database.query(query);
        queries.push({ name, sql: query, elapsedMs: Date.now() - started, rows });
        console.log(JSON.stringify({ name, rows: rows.length, elapsedMs: Date.now() - started }));
      } catch (error) {
        queries.push({ name, sql: query, status: 'UNAVAILABLE', error: error instanceof Error ? error.message : 'Read failed' });
        console.log(JSON.stringify({ name, status: 'UNAVAILABLE' }));
      }
    }
  } finally {
    await database.onModuleDestroy();
    report.finishedAt = new Date().toISOString();
    writeFileSync(resolve(output, 'metadata.json'), JSON.stringify(report, null, 2));
  }
}
void main();
