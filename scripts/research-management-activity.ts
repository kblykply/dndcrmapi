import 'reflect-metadata';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';

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
  const results: unknown[] = [];
  const queries: Array<[string, string]> = [
    [
      'columns',
      `SELECT t.name AS tableName,c.name AS columnName FROM sys.tables t JOIN sys.columns c ON t.object_id=c.object_id WHERE t.name IN ('LG_223_01_KSLINES','LG_223_KSCARD','LG_223_01_BNFLINE','LG_223_01_INVOICE','LG_SLSMAN','LG_223_PROJECT','LG_223_01_STLINE') ORDER BY t.name,c.column_id`,
    ],
    [
      'projectCodes',
      `SELECT CODE FROM dbo.LG_223_PROJECT WHERE CODE IN ('LJ','LJP','LJP1','LJP2','LV','GK-ARSA','KDV','TRAFO') ORDER BY CODE`,
    ],
    [
      'bankHeaderAudit',
      `SELECT l.TRCODE,l.MODULENR,l.SIGN,COUNT(*) AS rows,SUM(CASE WHEN f.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingHeader,SUM(CASE WHEN f.CANCELLED<>0 THEN 1 ELSE 0 END) AS cancelledHeader,SUM(CASE WHEN b.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingBankAccount, MIN(f.TRCODE) AS minHeaderCode,MAX(f.TRCODE) AS maxHeaderCode FROM dbo.LG_223_01_BNFLINE l LEFT JOIN dbo.LG_223_01_BNFICHE f ON f.LOGICALREF=l.SOURCEFREF LEFT JOIN dbo.LG_223_BANKACC b ON b.LOGICALREF=l.BNACCREF WHERE l.CANCELLED=0 AND l.DATE_>='2026-01-01' AND l.MODULENR=7 AND l.TRCODE IN (1,3,4,18) GROUP BY l.TRCODE,l.MODULENR,l.SIGN ORDER BY l.TRCODE,l.SIGN`,
    ],
  ];
  if (process.argv.includes('--cash')) {
    queries.splice(
      0,
      queries.length,
      [
        'cashLinkAudit',
        `SELECT k.TRCODE,k.SIGN,COUNT(*) AS rows,SUM(CASE WHEN s.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingCashCard,SUM(CASE WHEN cl.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingClientLine,MIN(cl.MODULENR) AS clientModuleMin,MAX(cl.MODULENR) AS clientModuleMax,MIN(cl.TRCODE) AS clientCodeMin,MAX(cl.TRCODE) AS clientCodeMax,SUM(CASE WHEN cl.CANCELLED<>0 THEN 1 ELSE 0 END) AS cancelledClientLine,SUM(CASE WHEN cl.SIGN<>k.SIGN THEN 1 ELSE 0 END) AS clientSignMismatch FROM dbo.LG_223_01_KSLINES k LEFT JOIN dbo.LG_223_KSCARD s ON s.LOGICALREF=k.CARDREF LEFT JOIN dbo.LG_223_01_CLFLINE cl ON cl.LOGICALREF=k.TRANSREF WHERE k.CANCELLED=0 AND k.TRCODE IN (11,12) AND k.DATE_>='2026-01-01' GROUP BY k.TRCODE,k.SIGN`,
      ],
      [
        'cashPurchaseAudit',
        `SELECT k.TRCODE,k.SIGN,k.TRCURR,COUNT(*) AS rows,SUM(CASE WHEN s.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingCashCard,SUM(CASE WHEN i.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingInvoice,MIN(i.TRCODE) AS invoiceCodeMin,MAX(i.TRCODE) AS invoiceCodeMax,MIN(i.FROMKASA) AS minFromCash,MAX(i.FROMKASA) AS maxFromCash,SUM(CASE WHEN i.CANCELLED<>0 THEN 1 ELSE 0 END) AS cancelledInvoice,SUM(CASE WHEN i.KASTRANSREF<>k.LOGICALREF THEN 1 ELSE 0 END) AS invoiceReverseLinkMismatch,SUM(CASE WHEN ABS(i.NETTOTAL-k.AMOUNT)>0.02 THEN 1 ELSE 0 END) AS amountMismatch,SUM(CASE WHEN i.TRCURR<>k.TRCURR THEN 1 ELSE 0 END) AS currencyMismatch FROM dbo.LG_223_01_KSLINES k LEFT JOIN dbo.LG_223_KSCARD s ON s.LOGICALREF=k.CARDREF LEFT JOIN dbo.LG_223_01_INVOICE i ON i.LOGICALREF=k.TRANSREF WHERE k.CANCELLED=0 AND k.TRCODE=31 GROUP BY k.TRCODE,k.SIGN,k.TRCURR`,
      ],
      [
        'purchaseVatAudit',
        `SELECT l.LINETYPE,l.VATINC,COUNT(*) AS rows,SUM(CASE WHEN ABS(l.LINENET-l.VATMATRAH)>0.02 THEN 1 ELSE 0 END) AS netDiffersFromTaxBase,SUM(CASE WHEN l.LINENET<0 THEN 1 ELSE 0 END) AS negativeLineNet FROM dbo.LG_223_01_STLINE l JOIN dbo.LG_223_01_INVOICE i ON i.LOGICALREF=l.INVOICEREF WHERE l.CANCELLED=0 AND i.CANCELLED=0 AND i.TRCODE IN (1,4,6) AND i.DATE_>='2026-01-01' GROUP BY l.LINETYPE,l.VATINC`,
      ],
    );
  }
  try {
    for (const [name, query] of queries) {
      try {
        const rows = await database.query(query);
        results.push({ name, rows });
        console.log(JSON.stringify({ name, rows: rows.length }));
      } catch {
        results.push({ name, status: 'UNAVAILABLE' });
        console.log(JSON.stringify({ name, status: 'UNAVAILABLE' }));
      }
    }
  } finally {
    await database.onModuleDestroy();
    const out = resolve(__dirname, '../../output/management-report-2026-10-03');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      resolve(
        out,
        process.argv.includes('--cash')
          ? 'activity-cash-research.json'
          : 'activity-source-research.json',
      ),
      JSON.stringify({ mode: 'READ_ONLY_SELECT', results }, null, 2),
    );
  }
}
void main().catch(() => {
  console.error('Read-only management research failed.');
  process.exitCode = 1;
});
