import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';

// Aggregate-only, sequential SELECT research. No account/customer identities.
async function main() {
  const settings = {
    ...parse(readFileSync(resolve(__dirname, '../.env'))),
    ...process.env,
    LOGO_DB_REQUEST_TIMEOUT_MS: '10000',
  };
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const queries: Array<{ name: string; sql: string }> = [];
  for (const firm of [223, 326, 426]) {
    queries.push({
      name: `invoice_scope_${firm}`,
      sql: `SELECT ${firm} AS firm, YEAR(DATE_) AS invoiceYear, TRCODE, TRCURR,
        COUNT_BIG(*) AS invoices, MIN(DATE_) AS firstDate, MAX(DATE_) AS lastDate,
        SUM(CASE WHEN ISNULL(PROJECTREF,0)=0 THEN 1 ELSE 0 END) AS missingHeaderProject,
        SUM(CASE WHEN ISNULL(ACCOUNTED,0)=0 THEN 1 ELSE 0 END) AS notAccounted,
        SUM(CASE WHEN ISNULL(ACCFICHEREF,0)=0 THEN 1 ELSE 0 END) AS missingLedgerLink,
        SUM(CASE WHEN NULLIF(LTRIM(RTRIM(CYPHCODE)),'') IS NOT NULL THEN 1 ELSE 0 END) AS withAuthorization,
        SUM(NETTOTAL) AS localGross, SUM(TOTALVAT) AS localVat,
        SUM(CASE WHEN TRCURR IN (0,160) THEN NETTOTAL ELSE TRNET END) AS originalGross
        FROM dbo.LG_${firm}_01_INVOICE WHERE CANCELLED=0
        GROUP BY YEAR(DATE_),TRCODE,TRCURR ORDER BY invoiceYear,TRCODE,TRCURR`,
    });
    queries.push({
      name: `purchase_line_scope_2026_${firm}`,
      sql: `SELECT ${firm} AS firm, i.TRCODE, l.LINETYPE, l.TRCURR,
        COUNT_BIG(*) AS sourceLines, COUNT(DISTINCT i.LOGICALREF) AS invoices,
        SUM(CASE WHEN ISNULL(l.PROJECTREF,0)=0 THEN 1 ELSE 0 END) AS missingLineProject,
        SUM(CASE WHEN ISNULL(l.CENTERREF,0)=0 THEN 1 ELSE 0 END) AS missingLineCostCenter,
        SUM(CASE WHEN ISNULL(l.ACCOUNTREF,0)=0 THEN 1 ELSE 0 END) AS missingLedgerAccount,
        SUM(CASE WHEN l.TRCURR NOT IN (0,160) AND ISNULL(l.TRRATE,0)<=0 THEN 1 ELSE 0 END) AS invalidForeignRate,
        SUM(l.LINENET) AS localNet, SUM(l.VATAMNT) AS localVat
        FROM dbo.LG_${firm}_01_INVOICE i
        INNER JOIN dbo.LG_${firm}_01_STLINE l ON l.INVOICEREF=i.LOGICALREF
        WHERE i.CANCELLED=0 AND l.CANCELLED=0 AND i.TRCODE IN (1,4,6)
        AND i.DATE_>='20260101' AND i.DATE_<'20261004'
        GROUP BY i.TRCODE,l.LINETYPE,l.TRCURR ORDER BY i.TRCODE,l.LINETYPE,l.TRCURR`,
    });
    queries.push({
      name: `general_ledger_2026_${firm}`,
      sql: `SELECT ${firm} AS firm, LEFT(ACCOUNTCODE,3) AS accountClass,
        COUNT_BIG(*) AS rows, MIN(DATE_) AS firstDate, MAX(DATE_) AS lastDate,
        SUM(CASE WHEN ISNULL(PROJECTREF,0)=0 THEN 1 ELSE 0 END) AS missingProject,
        SUM(CASE WHEN ISNULL(CENTERREF,0)=0 THEN 1 ELSE 0 END) AS missingCostCenter,
        SUM(DEBIT) AS localDebit,SUM(CREDIT) AS localCredit,
        SUM(CASE WHEN TRCODE=1 THEN 1 ELSE 0 END) AS openingCodeRows,
        SUM(CASE WHEN TRCODE=7 THEN 1 ELSE 0 END) AS closingCodeRows
        FROM dbo.LG_${firm}_01_EMFLINE
        WHERE CANCELLED=0 AND DATE_>='20260101' AND DATE_<'20261004'
        GROUP BY LEFT(ACCOUNTCODE,3) ORDER BY accountClass`,
    });
  }
  queries.push({
    name: 'distribution_multiplicity_223',
    sql: `WITH d AS (
      SELECT FICHEREF, PREVLINEREF, COUNT_BIG(*) AS distributionRows,
        SUM(CASE WHEN ISNULL(PROJECTREF,0)=0 THEN 1 ELSE 0 END) AS missingProject
      FROM dbo.LG_223_01_PREACCDISTDETLINE WHERE PREVLINETYPE=1
      GROUP BY FICHEREF,PREVLINEREF)
      SELECT COUNT_BIG(*) AS allocatedLines,SUM(distributionRows) AS distributionRows,
        SUM(CASE WHEN distributionRows>1 THEN 1 ELSE 0 END) AS multiplyAllocatedLines,
        MAX(distributionRows) AS maximumAllocationsPerLine,
        SUM(missingProject) AS missingProjectAllocations FROM d`,
  });
  const followupQueries = [
    {
      name: 'purchase_account_classes_2026_223',
      sql: `SELECT LEFT(a.CODE,3) AS accountClass,l.TRCURR,
      COUNT_BIG(*) AS sourceLines,SUM(l.LINENET) AS localNet,
      SUM(CASE WHEN ISNULL(l.PROJECTREF,0)=0 THEN l.LINENET ELSE 0 END) AS localNetMissingDirectProject
      FROM dbo.LG_223_01_INVOICE i
      INNER JOIN dbo.LG_223_01_STLINE l ON l.INVOICEREF=i.LOGICALREF
      LEFT JOIN dbo.LG_223_EMUHACC a ON a.LOGICALREF=l.ACCOUNTREF
      WHERE i.CANCELLED=0 AND l.CANCELLED=0 AND i.TRCODE IN (1,4)
      AND i.DATE_>='20260101' AND i.DATE_<'20261004'
      GROUP BY LEFT(a.CODE,3),l.TRCURR ORDER BY accountClass,l.TRCURR`,
    },
    {
      name: 'account_class_labels_223',
      sql: `SELECT CODE AS accountClass,DEFINITION_ AS classLabel FROM dbo.LG_223_EMUHACC
      WHERE LEN(CODE)=3 AND CODE IN ('151','255','280','350','600','610','730','760','780')
      ORDER BY CODE`,
    },
  ];
  const output = resolve(
    __dirname,
    '../../output/executive-research-2026-10-03',
  );
  mkdirSync(output, { recursive: true });
  const followup = process.argv.includes('--followup');
  const report: Record<string, unknown> = followup
    ? (JSON.parse(
        readFileSync(resolve(output, 'costs.json'), 'utf8'),
      ) as Record<string, unknown>)
    : {
        startedAt: new Date().toISOString(),
        database: 'LOGO_DND',
        mode: 'SEQUENTIAL_AGGREGATE_SELECT_ONLY',
        limitation:
          'Separate reads; invoice values are accruals, not cash; missing direct project may be allocated in distribution records. No consolidated net profit asserted.',
        results: [],
      };
  const results = report.results as Array<Record<string, unknown>>;
  try {
    for (const query of followup ? followupQueries : queries) {
      const started = Date.now();
      try {
        const rows = await database.query(query.sql);
        results.push({ ...query, elapsedMs: Date.now() - started, rows });
        console.log(
          JSON.stringify({
            name: query.name,
            rows: rows.length,
            elapsedMs: Date.now() - started,
          }),
        );
      } catch {
        results.push({
          name: query.name,
          status: 'UNAVAILABLE',
          elapsedMs: Date.now() - started,
        });
        console.log(
          JSON.stringify({ name: query.name, status: 'UNAVAILABLE' }),
        );
      }
    }
  } finally {
    await database.onModuleDestroy();
    report.finishedAt = new Date().toISOString();
    writeFileSync(
      resolve(output, 'costs.json'),
      JSON.stringify(report, null, 2),
    );
  }
}
void main().catch(() => {
  console.error('Aggregate research failed; connection details omitted.');
  process.exitCode = 1;
});
