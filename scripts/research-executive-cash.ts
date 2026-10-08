import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';

// Aggregate SELECT research only. No account identifiers or personal fields.
async function main() {
  const database = new LogoDatabaseService(
    new LogoConfigService(
      new ConfigService({
        ...parse(readFileSync(resolve(__dirname, '../.env'))),
        ...process.env,
        LOGO_DB_REQUEST_TIMEOUT_MS: '20000',
      }),
    ),
  );
  const destination = resolve(
    __dirname,
    '../../output/executive-research-2026-10-03',
  );
  mkdirSync(destination, { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  const queries: Array<[string, string]> = [
    [
      'scope',
      `SELECT DB_NAME() AS databaseName, NR AS firm, NAME, LOCALCTYP, FIRMREPCURR FROM dbo.L_CAPIFIRM WHERE NR IN (223,326,426)`,
    ],
    [
      'bankCashSchema',
      `SELECT t.name AS tableName, c.name AS columnName, ty.name AS dataType FROM sys.tables t JOIN sys.columns c ON t.object_id=c.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE t.name IN ('LG_223_BANKACC','LG_223_01_BNTOTFIL','LG_223_01_BNFICHE','LG_223_01_KSTOTFIL') ORDER BY t.name,c.column_id`,
    ],
    [
      'financingInventory',
      `SELECT t.name AS tableName, SUM(p.rows) AS approximateRows FROM sys.tables t JOIN sys.partitions p ON t.object_id=p.object_id AND p.index_id IN (0,1) WHERE (t.name LIKE 'LG[_]223[_]%BNCR%' OR t.name LIKE 'LG[_]326[_]%BNCR%' OR t.name LIKE 'LG[_]426[_]%BNCR%' OR t.name LIKE 'LG[_]223[_]%BNTOT%' OR t.name LIKE 'LG[_]223[_]%KSTOT%') GROUP BY t.name ORDER BY t.name`,
    ],
  ];
  for (const firm of [223, 326, 426]) {
    queries.push([
      `bankProfile-${firm}`,
      `SELECT TRCODE, MODULENR, CANCELLED, SIGN, COUNT_BIG(*) AS rows, MIN(DATE_) AS firstDate, MAX(DATE_) AS lastDate, SUM(CASE WHEN PROJECTREF<>0 THEN 1 ELSE 0 END) AS withProject, SUM(CASE WHEN CLIENTREF<>0 THEN 1 ELSE 0 END) AS withClient, SUM(CASE WHEN NULLIF(LTRIM(RTRIM(SPECODE)),'') IS NOT NULL THEN 1 ELSE 0 END) AS withCategory, SUM(CASE WHEN DATE_>=@yearStart AND DATE_<@asOfEnd THEN 1 ELSE 0 END) AS yearToDateRows FROM dbo.LG_${firm}_01_BNFLINE GROUP BY TRCODE,MODULENR,CANCELLED,SIGN ORDER BY TRCODE,MODULENR,CANCELLED,SIGN`,
    ]);
    queries.push([
      `cashProfile-${firm}`,
      `SELECT TRCODE, CANCELLED, SIGN, COUNT_BIG(*) AS rows, MIN(DATE_) AS firstDate, MAX(DATE_) AS lastDate, SUM(CASE WHEN PROJECTREF<>0 THEN 1 ELSE 0 END) AS withProject, SUM(CASE WHEN NULLIF(LTRIM(RTRIM(SPECODE)),'') IS NOT NULL THEN 1 ELSE 0 END) AS withCategory, SUM(CASE WHEN DATE_>=@yearStart AND DATE_<@asOfEnd THEN 1 ELSE 0 END) AS yearToDateRows FROM dbo.LG_${firm}_01_KSLINES GROUP BY TRCODE,CANCELLED,SIGN ORDER BY TRCODE,CANCELLED,SIGN`,
    ]);
    queries.push([
      `bankMonthly-${firm}`,
      `SELECT CONVERT(char(7),DATE_,126) AS month, TRCODE,MODULENR,SIGN,TRCURR,COUNT_BIG(*) AS rows, SUM(AMOUNT) AS localAmount, SUM(TRNET) AS transactionAmount, SUM(CASE WHEN TRCURR NOT IN (0,160) AND TRNET=0 AND AMOUNT<>0 THEN 1 ELSE 0 END) AS missingForeignAmount FROM dbo.LG_${firm}_01_BNFLINE WHERE CANCELLED=0 AND DATE_>=@yearStart AND DATE_<@asOfEnd GROUP BY CONVERT(char(7),DATE_,126),TRCODE,MODULENR,SIGN,TRCURR ORDER BY month,TRCODE,MODULENR,SIGN,TRCURR`,
    ]);
  }
  queries.push(
    [
      'bankViewSeptember',
      `SELECT [IŞLEM] AS operation, DOVİZ AS currencyCode, COUNT_BIG(*) AS rows, SUM([BORÇ]) AS localDebit,SUM(ALACAK) AS localCredit,SUM([DVBORÇ]) AS currencyDebit,SUM(DVALACAK) AS currencyCredit FROM dbo.L_223_BANKA_HAREKET WHERE TARİH>=@monthStart AND TARİH<@monthEnd GROUP BY [IŞLEM],DOVİZ ORDER BY [IŞLEM],DOVİZ`,
    ],
    [
      'cashViewCoverage',
      `SELECT KAYNAK AS source, COUNT_BIG(*) AS rows, MIN(TARİH) AS firstDate,MAX(TARİH) AS lastDate FROM dbo.L_223_KASA_HAREKET GROUP BY KAYNAK`,
    ],
    [
      'bankViewJoinAudit',
      `SELECT COUNT_BIG(*) AS rawTransferRows,SUM(CASE WHEN EXISTS_ACCOUNT.LOGICALREF IS NOT NULL THEN 1 ELSE 0 END) AS rowsMatchingViewLedgerJoin, SUM(CASE WHEN b.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingBankAccount,SUM(CASE WHEN f.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingHeader,SUM(CASE WHEN f.CANCELLED<>0 THEN 1 ELSE 0 END) AS cancelledHeaders FROM dbo.LG_223_01_BNFLINE l LEFT JOIN dbo.LG_223_BANKACC b ON b.LOGICALREF=l.BNACCREF LEFT JOIN dbo.LG_223_EMUHACC EXISTS_ACCOUNT ON EXISTS_ACCOUNT.LOGICALREF=l.BNACCREF LEFT JOIN dbo.LG_223_01_BNFICHE f ON f.LOGICALREF=l.SOURCEFREF WHERE l.CANCELLED=0 AND l.TRCODE=2`,
    ],
    [
      'cashViewExclusions',
      `SELECT TRCODE,CANCELLED,COUNT_BIG(*) AS rows FROM dbo.LG_223_01_KSLINES WHERE TRCODE NOT IN (11,12,21,22,71,72,73,74) OR (TRCODE IN (21,22) AND CANCELLED<>0) GROUP BY TRCODE,CANCELLED ORDER BY TRCODE,CANCELLED`,
    ],
    [
      'categoryUniqueness',
      `SELECT SPECODETYPE,COUNT_BIG(*) AS duplicateCodeGroups FROM (SELECT SPECODETYPE,SPECODE FROM dbo.LG_223_SPECODES WHERE CODETYPE=1 AND SPECODETYPE IN (33,44) GROUP BY SPECODETYPE,SPECODE HAVING COUNT_BIG(*)>1) d GROUP BY SPECODETYPE`,
    ],
  );
  const followup = process.argv.includes('--followup');
  if (followup) {
    queries.splice(
      0,
      queries.length,
      [
        'septemberBankValidation',
        `SELECT l.TRCODE,l.TRCURR,COUNT_BIG(*) AS rows,SUM(CASE WHEN f.LOGICALREF IS NULL OR f.CANCELLED<>0 THEN 1 ELSE 0 END) AS invalidHeader,SUM(CASE WHEN b.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingBankAccount,SUM(CASE WHEN c.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingClient,SUM(CASE WHEN l.PROJECTREF<>0 THEN 1 ELSE 0 END) AS withProject,SUM(CASE WHEN l.TRCODE=3 AND l.SIGN<>0 OR l.TRCODE=4 AND l.SIGN<>1 THEN 1 ELSE 0 END) AS unexpectedDirection,SUM(CASE WHEN c.CODE LIKE '120%' THEN 1 ELSE 0 END) AS clientPrefix120Rows FROM dbo.LG_223_01_BNFLINE l LEFT JOIN dbo.LG_223_01_BNFICHE f ON f.LOGICALREF=l.SOURCEFREF LEFT JOIN dbo.LG_223_BANKACC b ON b.LOGICALREF=l.BNACCREF LEFT JOIN dbo.LG_223_CLCARD c ON c.LOGICALREF=l.CLIENTREF WHERE l.CANCELLED=0 AND l.TRCODE IN (3,4) AND l.DATE_>=@monthStart AND l.DATE_<@monthEnd GROUP BY l.TRCODE,l.TRCURR ORDER BY l.TRCODE,l.TRCURR`,
      ],
      [
        'bankLedgerClass',
        `SELECT CARDTYPE,CURRENCY,ACTIVE,COUNT_BIG(*) AS accounts FROM dbo.LG_223_BANKACC GROUP BY CARDTYPE,CURRENCY,ACTIVE ORDER BY CARDTYPE,CURRENCY,ACTIVE`,
      ],
      [
        'bankTotalGrain',
        `SELECT TOTTYP,MONTH_,MIN(YEAR_) AS minimumYear,MAX(YEAR_) AS maximumYear,COUNT_BIG(*) AS rows FROM dbo.LG_223_01_BNTOTFIL GROUP BY TOTTYP,MONTH_ ORDER BY TOTTYP,MONTH_`,
      ],
      [
        'historyFacilities',
        `SELECT t.name AS tableName,t.temporal_type,t.is_tracked_by_cdc,CASE WHEN ct.object_id IS NULL THEN 0 ELSE 1 END AS changeTrackingEnabled FROM sys.tables t LEFT JOIN sys.change_tracking_tables ct ON ct.object_id=t.object_id WHERE t.name IN ('LG_223_01_PAYTRANS','LG_223_01_INVOICE','LG_223_01_BNFLINE','LG_223_01_KSLINES') ORDER BY t.name`,
      ],
      [
        'databaseHistoryFacility',
        `SELECT is_cdc_enabled FROM sys.databases WHERE database_id=DB_ID()`,
      ],
      [
        'historyObjectInventory',
        `SELECT TOP (30) t.name AS tableName,SUM(p.rows) AS approximateRows FROM sys.tables t JOIN sys.partitions p ON t.object_id=p.object_id AND p.index_id IN (0,1) WHERE t.name LIKE '%HISTORY%' OR t.name LIKE '%AUDIT%' OR t.name LIKE '%LOGREC%' OR t.name LIKE '%LOGHIST%' GROUP BY t.name ORDER BY t.name`,
      ],
      [
        'septemberCashTransfers',
        `SELECT TRCODE,SIGN,TRCURR,COUNT_BIG(*) AS rows,SUM(AMOUNT) AS localAmount,SUM(TRNET) AS transactionAmount FROM dbo.LG_223_01_KSLINES WHERE CANCELLED=0 AND TRCODE IN (11,12) AND DATE_>=@monthStart AND DATE_<@monthEnd GROUP BY TRCODE,SIGN,TRCURR ORDER BY TRCODE,SIGN,TRCURR`,
      ],
    );
  }
  const history = process.argv.includes('--history');
  if (history) {
    queries.splice(
      0,
      queries.length,
      [
        'historyColumns',
        `SELECT t.name AS tableName,c.name AS columnName,ty.name AS dataType FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE t.name IN ('LG_223_01_HISTORY','LG_223_HISTORY') ORDER BY t.name,c.column_id`,
      ],
      [
        'relevantChangeLogObjects',
        `SELECT t.name AS tableName,SUM(p.rows) AS approximateRows FROM sys.tables t JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1) WHERE t.name LIKE 'L[_]%LOG%' OR t.name LIKE 'LG[_]223[_]%LOG%' GROUP BY t.name ORDER BY t.name`,
      ],
    );
  }
  const startedAt = new Date().toISOString();
  try {
    for (const [name, sql] of queries) {
      const started = Date.now();
      try {
        const rows = await database.query(sql, {
          yearStart: '2026-01-01',
          monthStart: '2026-09-01',
          monthEnd: '2026-10-01',
          asOfEnd: '2026-10-04',
        });
        results.push({ name, sql, elapsedMs: Date.now() - started, rows });
        console.log(
          JSON.stringify({
            name,
            rows: rows.length,
            elapsedMs: Date.now() - started,
          }),
        );
      } catch {
        results.push({
          name,
          status: 'UNAVAILABLE',
          elapsedMs: Date.now() - started,
        });
        console.log(JSON.stringify({ name, status: 'UNAVAILABLE' }));
      }
    }
  } finally {
    await database.onModuleDestroy();
    writeFileSync(
      resolve(
        destination,
        history
          ? 'history-metadata.json'
          : followup
            ? 'cash-followup.json'
            : 'cash.json',
      ),
      JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          mode: 'SEQUENTIAL_READ_ONLY_AGGREGATE_SELECT',
          scope:
            '223/326/426, period 01; separate statements not an atomic accounting snapshot',
          results,
        },
        null,
        2,
      ),
    );
  }
}
void main().catch(() => {
  console.error('Cash research failed; connection details omitted.');
  process.exitCode = 1;
});
