import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';
import { paymentTrackingToday } from '../src/payment-tracking/payment-tracking-date';

const stage = process.argv[2] || 'profile';
const dir = resolve(
  __dirname,
  '../../output/logo-management-research-2026-10-02',
);
const settings = {
  ...parse(readFileSync(resolve(__dirname, '../.env'))),
  ...process.env,
};
const config = new LogoConfigService(new ConfigService(settings));
const database = new LogoDatabaseService(config);
const p = '[LOGO_DND].[dbo].[LG_223_01_PAYTRANS]';
const c = '[LOGO_DND].[dbo].[LG_223_CLCARD]';
const invoice = '[LOGO_DND].[dbo].[LG_223_01_INVOICE]';
const queries: Record<string, Array<[string, string]>> = {
  profile: [
    [
      'read_context',
      `SELECT DB_NAME() AS databaseName, CONVERT(varchar(33), GETDATE(), 126) AS serverTime, CONVERT(varchar(33), GETUTCDATE(), 126) AS serverUtcTime, d.is_read_committed_snapshot_on AS readCommittedSnapshot, d.snapshot_isolation_state_desc AS snapshotIsolation FROM sys.databases d WHERE d.name=DB_NAME()`,
    ],
    [
      'table_inventory',
      `SELECT TOP (250) t.name AS tableName, SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS approximateRows FROM [LOGO_DND].sys.tables t LEFT JOIN [LOGO_DND].sys.partitions p ON p.object_id=t.object_id WHERE t.name LIKE 'LG[_]%[_]PAYTRANS' OR t.name LIKE 'LG[_]223[_]01[_]CS%' OR t.name LIKE 'LG[_]223[_]01[_]%CREDIT%' OR t.name LIKE 'LG[_]223[_]01[_]%LOAN%' OR t.name IN ('LG_223_01_CLFLINE','LG_223_01_INVOICE','LG_223_01_BNFLINE') GROUP BY t.name ORDER BY t.name`,
    ],
    [
      'currency_codes',
      `SELECT FIRMNR, CURTYPE, CURCODE, CURNAME FROM [LOGO_DND].[dbo].[L_CURRENCYLIST] WHERE FIRMNR IN (0,223) AND CURTYPE IN (0,1,17,20,160) ORDER BY FIRMNR,CURTYPE`,
    ],
    [
      'paytrans_profile',
      `SELECT TOP (1000) MODULENR,TRCODE,SIGN,CANCELLED,TRCURR,COUNT(*) AS rows,COUNT(DISTINCT CARDREF) AS cards,SUM(TOTAL) AS total,SUM(PAID) AS paid,SUM(CASE WHEN TOTAL>PAID THEN TOTAL-PAID ELSE 0 END) AS openPositive,SUM(CASE WHEN TOTAL>PAID THEN 1 ELSE 0 END) AS openRows,SUM(CASE WHEN TOTAL IS NULL OR PAID IS NULL OR DATE_ IS NULL THEN 1 ELSE 0 END) AS incompleteRows,SUM(CASE WHEN PAID>TOTAL+0.00001 THEN 1 ELSE 0 END) AS overpaidRows,SUM(CASE WHEN TOTAL<0 OR PAID<0 THEN 1 ELSE 0 END) AS negativeRows,CONVERT(varchar(10),MIN(DATE_),23) AS minDue,CONVERT(varchar(10),MAX(DATE_),23) AS maxDue FROM ${p} GROUP BY MODULENR,TRCODE,SIGN,CANCELLED,TRCURR ORDER BY SIGN,CANCELLED,MODULENR,TRCODE,TRCURR`,
    ],
    [
      'invoice_paytrans_linkage',
      `SELECT TOP (250) p.SIGN,p.TRCODE AS paymentCode,p.TRCURR,i.GRPCODE,i.TRCODE AS invoiceCode,i.CANCELLED AS invoiceCancelled,COUNT(*) AS paymentRows,SUM(CASE WHEN i.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS unmatchedRows,SUM(CASE WHEN p.CARDREF<>i.CLIENTREF THEN 1 ELSE 0 END) AS customerMismatchRows,SUM(CASE WHEN p.CANCELLED<>i.CANCELLED THEN 1 ELSE 0 END) AS cancelledMismatchRows,SUM(CASE WHEN p.DATE_<>i.DATE_ THEN 1 ELSE 0 END) AS dueNotInvoiceDateRows,CONVERT(varchar(10),MIN(i.DATE_),23) AS firstInvoiceDate,CONVERT(varchar(10),MAX(i.DATE_),23) AS lastInvoiceDate FROM ${p} p LEFT JOIN ${invoice} i ON i.LOGICALREF=p.FICHEREF WHERE p.MODULENR=4 GROUP BY p.SIGN,p.TRCODE,p.TRCURR,i.GRPCODE,i.TRCODE,i.CANCELLED ORDER BY p.SIGN,p.TRCODE,p.TRCURR`,
    ],
    [
      'invoice_currency_units',
      `WITH p AS (SELECT FICHEREF,TRCURR,SUM(TOTAL) AS paymentTotal,MIN(TRRATE) AS minRate,MAX(TRRATE) AS maxRate,COUNT(*) AS paymentRows FROM ${p} WHERE MODULENR=4 AND CANCELLED=0 GROUP BY FICHEREF,TRCURR) SELECT TOP (100) p.TRCURR,i.TRCURR AS invoiceCurrency,i.GRPCODE,i.TRCODE,COUNT(*) AS invoices,SUM(p.paymentRows) AS paymentRows,SUM(p.paymentTotal) AS paymentTotal,SUM(i.NETTOTAL) AS invoiceLocalTotal,SUM(i.TRNET) AS invoiceTransactionTotal,SUM(CASE WHEN ABS(p.paymentTotal-i.NETTOTAL)<0.02 THEN 1 ELSE 0 END) AS matchesLocalTotal,SUM(CASE WHEN ABS(p.paymentTotal-i.TRNET)<0.02 THEN 1 ELSE 0 END) AS matchesTransactionTotal,SUM(CASE WHEN p.minRate=p.maxRate AND ABS(p.paymentTotal*p.minRate-i.NETTOTAL)<0.02 THEN 1 ELSE 0 END) AS convertedMatchesLocal,MIN(p.minRate) AS minRate,MAX(p.maxRate) AS maxRate FROM p INNER JOIN ${invoice} i ON i.LOGICALREF=p.FICHEREF WHERE i.CANCELLED=0 GROUP BY p.TRCURR,i.TRCURR,i.GRPCODE,i.TRCODE ORDER BY p.TRCURR,i.GRPCODE,i.TRCODE`,
    ],
    [
      'paytrans_flags',
      `SELECT TOP (250) SIGN,PAIDINCASH,OPSTAT,RECSTATUS,DEVIR,CURRDIFFCLOSED,COUNT(*) AS rows,SUM(CASE WHEN TOTAL>PAID THEN 1 ELSE 0 END) AS openRows,SUM(CASE WHEN CROSSREF>0 THEN 1 ELSE 0 END) AS crossRows,SUM(CASE WHEN MATCHDATE IS NOT NULL AND MATCHDATE>'19000101' THEN 1 ELSE 0 END) AS matchDateRows FROM ${p} WHERE CANCELLED=0 GROUP BY SIGN,PAIDINCASH,OPSTAT,RECSTATUS,DEVIR,CURRDIFFCLOSED ORDER BY SIGN,PAIDINCASH,OPSTAT,RECSTATUS,DEVIR,CURRDIFFCLOSED`,
    ],
    [
      'checks_profile',
      `SELECT TOP (250) DOC,CURRSTAT,CANCELLED,TRCURR,COUNT(*) AS rows,SUM(AMOUNT) AS localAmount,SUM(TRNET) AS transactionAmount,CONVERT(varchar(10),MIN(DUEDATE),23) AS firstDue,CONVERT(varchar(10),MAX(DUEDATE),23) AS lastDue FROM [LOGO_DND].[dbo].[LG_223_01_CSCARD] GROUP BY DOC,CURRSTAT,CANCELLED,TRCURR ORDER BY DOC,CURRSTAT,CANCELLED,TRCURR`,
    ],
    [
      'bank_and_cari_codes',
      `SELECT TOP (500) 'CLFLINE' AS source,MODULENR,TRCODE,SIGN,CANCELLED,TRCURR,COUNT(*) AS rows,SUM(AMOUNT) AS localAmount,SUM(TRNET) AS transactionAmount FROM [LOGO_DND].[dbo].[LG_223_01_CLFLINE] GROUP BY MODULENR,TRCODE,SIGN,CANCELLED,TRCURR UNION ALL SELECT TOP (250) 'BNFLINE',MODULENR,TRCODE,SIGN,CANCELLED,TRCURR,COUNT(*),SUM(AMOUNT),SUM(TRNET) FROM [LOGO_DND].[dbo].[LG_223_01_BNFLINE] GROUP BY MODULENR,TRCODE,SIGN,CANCELLED,TRCURR`,
    ],
  ],
  obligations: [
    [
      'firm_currency',
      `SELECT NR,LOCALCTYP,FIRMREPCURR FROM [LOGO_DND].[dbo].[L_CAPIFIRM] WHERE NR IN (223,326,426)`,
    ],
    [
      'extra_currency',
      `SELECT FIRMNR,CURTYPE,CURCODE,CURNAME FROM [LOGO_DND].[dbo].[L_CURRENCYLIST] WHERE FIRMNR=223 AND CURTYPE IN (11,51)`,
    ],
    [
      'instrument_columns',
      `SELECT TOP (500) t.name AS tableName,c.name AS columnName,ty.name AS dataType FROM [LOGO_DND].sys.tables t INNER JOIN [LOGO_DND].sys.columns c ON c.object_id=t.object_id INNER JOIN [LOGO_DND].sys.types ty ON ty.user_type_id=c.user_type_id WHERE t.name IN ('LG_223_01_CSTRANS','LG_223_01_CSROLL') OR t.name LIKE 'LG[_]223[_]%BNCR%' OR t.name LIKE 'LG[_]223[_]%CREDIT%' OR t.name LIKE 'LG[_]223[_]%LOAN%' ORDER BY t.name,c.column_id`,
    ],
    [
      'open_credit_card_types',
      `SELECT c.CARDTYPE,p.MODULENR,p.TRCODE,p.TRCURR,COUNT(*) AS rows,COUNT(DISTINCT p.CARDREF) AS cards,SUM(p.TOTAL-p.PAID) AS openAmount,SUM(CASE WHEN c.LOGICALREF IS NULL THEN 1 ELSE 0 END) AS missingCardRows FROM ${p} p LEFT JOIN ${c} c ON c.LOGICALREF=p.CARDREF WHERE p.SIGN=1 AND p.CANCELLED=0 AND p.TOTAL>p.PAID GROUP BY c.CARDTYPE,p.MODULENR,p.TRCODE,p.TRCURR ORDER BY c.CARDTYPE,p.MODULENR,p.TRCODE,p.TRCURR`,
    ],
    [
      'purchase_due_months',
      `SELECT TOP (1000) p.TRCURR,CONVERT(varchar(7),p.DATE_,126) AS dueMonth,COUNT(*) AS rows,COUNT(DISTINCT p.CARDREF) AS cards,COUNT(DISTINCT p.FICHEREF) AS invoices,SUM(p.TOTAL) AS total,SUM(p.PAID) AS paid,SUM(p.TOTAL-p.PAID) AS openAmount,SUM(CASE WHEN CONVERT(date,p.DATE_)<CONVERT(date,@asOf) THEN p.TOTAL-p.PAID ELSE 0 END) AS pastDueAmount FROM ${p} p INNER JOIN ${invoice} i ON i.LOGICALREF=p.FICHEREF WHERE p.CANCELLED=0 AND p.SIGN=1 AND p.MODULENR=4 AND i.CANCELLED=0 AND i.GRPCODE=1 AND i.TRCODE IN (1,4) AND p.TOTAL>p.PAID GROUP BY p.TRCURR,CONVERT(varchar(7),p.DATE_,126) ORDER BY dueMonth,p.TRCURR`,
    ],
    [
      'purchase_closing_quality',
      `SELECT p.TRCURR,COUNT(*) AS rows,COUNT(DISTINCT p.CARDREF) AS cards,COUNT(DISTINCT p.FICHEREF) AS invoices,SUM(CASE WHEN p.PAID=0 THEN 1 ELSE 0 END) AS noAllocationRows,SUM(CASE WHEN p.PAID>0 AND p.PAID<p.TOTAL THEN 1 ELSE 0 END) AS partialRows,SUM(CASE WHEN p.PAID>=p.TOTAL THEN 1 ELSE 0 END) AS fullyAllocatedRows,SUM(CASE WHEN p.CROSSREF>0 THEN 1 ELSE 0 END) AS linkedRows,SUM(CASE WHEN p.TOTAL IS NULL OR p.PAID IS NULL OR p.DATE_ IS NULL THEN 1 ELSE 0 END) AS incompleteRows,SUM(CASE WHEN p.DATE_=p.PROCDATE THEN 1 ELSE 0 END) AS dueEqualsProcessDateRows,SUM(CASE WHEN p.DATE_=i.DATE_ THEN 1 ELSE 0 END) AS dueEqualsInvoiceDateRows,MIN(DATEDIFF(day,i.DATE_,p.DATE_)) AS minimumTermDays,MAX(DATEDIFF(day,i.DATE_,p.DATE_)) AS maximumTermDays FROM ${p} p INNER JOIN ${invoice} i ON i.LOGICALREF=p.FICHEREF WHERE p.CANCELLED=0 AND p.SIGN=1 AND p.MODULENR=4 AND i.CANCELLED=0 AND i.GRPCODE=1 AND i.TRCODE IN (1,4) GROUP BY p.TRCURR ORDER BY p.TRCURR`,
    ],
    [
      'supplier_net_vs_open',
      `WITH suppliers AS (SELECT DISTINCT CLIENTREF FROM ${invoice} WHERE CANCELLED=0 AND GRPCODE=1 AND TRCODE IN (1,4)), balances AS (SELECT p.CARDREF,p.TRCURR,SUM(CASE WHEN p.SIGN=1 THEN p.TOTAL ELSE -p.TOTAL END) AS netCredit,SUM(CASE WHEN p.SIGN=1 AND p.TOTAL>p.PAID THEN p.TOTAL-p.PAID ELSE 0 END) AS openCredit,SUM(CASE WHEN p.SIGN=0 AND p.TOTAL>p.PAID THEN p.TOTAL-p.PAID ELSE 0 END) AS openDebit,SUM(CASE WHEN p.SIGN=1 AND p.MODULENR=4 AND p.TRCODE IN (1,4) AND p.TOTAL>p.PAID THEN p.TOTAL-p.PAID ELSE 0 END) AS openPurchase FROM ${p} p INNER JOIN suppliers s ON s.CLIENTREF=p.CARDREF WHERE p.CANCELLED=0 GROUP BY p.CARDREF,p.TRCURR) SELECT TRCURR,COUNT(*) AS supplierCurrencyGroups,SUM(netCredit) AS signedNetCredit,SUM(CASE WHEN netCredit>0 THEN netCredit ELSE 0 END) AS positiveNetCredit,SUM(CASE WHEN netCredit<0 THEN -netCredit ELSE 0 END) AS positiveNetDebit,SUM(openCredit) AS openCredit,SUM(openDebit) AS openDebit,SUM(openPurchase) AS openPurchase,SUM(CASE WHEN openCredit>0.01 AND openDebit>0.01 THEN 1 ELSE 0 END) AS bothSidesOpenGroups,SUM(CASE WHEN openPurchase>0.01 AND netCredit<=0.01 THEN 1 ELSE 0 END) AS openPurchaseButNoNetDebtGroups,SUM(CASE WHEN openPurchase>0.01 AND netCredit<=0.01 THEN openPurchase ELSE 0 END) AS purchaseAmountWithoutNetDebt FROM balances GROUP BY TRCURR ORDER BY TRCURR`,
    ],
    [
      'supplier_cari_balances',
      `WITH suppliers AS (SELECT DISTINCT CLIENTREF FROM ${invoice} WHERE CANCELLED=0 AND GRPCODE=1 AND TRCODE IN (1,4)), balances AS (SELECT l.CLIENTREF,l.TRCURR,SUM(CASE WHEN l.SIGN=1 THEN 1 ELSE -1 END * CASE WHEN l.TRCURR=0 THEN l.AMOUNT ELSE l.TRNET END) AS netCredit,COUNT(*) AS rows FROM [LOGO_DND].[dbo].[LG_223_01_CLFLINE] l INNER JOIN suppliers s ON s.CLIENTREF=l.CLIENTREF WHERE l.CANCELLED=0 GROUP BY l.CLIENTREF,l.TRCURR) SELECT TRCURR,COUNT(*) AS supplierCurrencyGroups,SUM(rows) AS rows,SUM(netCredit) AS signedNetCredit,SUM(CASE WHEN netCredit>0 THEN netCredit ELSE 0 END) AS positiveNetCredit,SUM(CASE WHEN netCredit<0 THEN -netCredit ELSE 0 END) AS positiveNetDebit FROM balances GROUP BY TRCURR ORDER BY TRCURR`,
    ],
    [
      'checks_due_months',
      `SELECT DOC,CURRSTAT,TRCURR,CONVERT(varchar(7),DUEDATE,126) AS dueMonth,COUNT(*) AS rows,SUM(CASE WHEN TRCURR=0 THEN AMOUNT ELSE TRNET END) AS originalCurrencyAmount,SUM(CASE WHEN CONVERT(date,DUEDATE)<CONVERT(date,@asOf) THEN CASE WHEN TRCURR=0 THEN AMOUNT ELSE TRNET END ELSE 0 END) AS pastDueAmount FROM [LOGO_DND].[dbo].[LG_223_01_CSCARD] WHERE CANCELLED=0 AND CURRSTAT<>8 GROUP BY DOC,CURRSTAT,TRCURR,CONVERT(varchar(7),DUEDATE,126) ORDER BY dueMonth,TRCURR,CURRSTAT`,
    ],
    [
      'other_firms_purchase_schedules',
      `SELECT 326 AS firm,p.TRCURR,CONVERT(varchar(7),p.DATE_,126) AS dueMonth,COUNT(*) AS rows,SUM(p.TOTAL-p.PAID) AS openAmount FROM [LOGO_DND].[dbo].[LG_326_01_PAYTRANS] p INNER JOIN [LOGO_DND].[dbo].[LG_326_01_INVOICE] i ON i.LOGICALREF=p.FICHEREF WHERE p.CANCELLED=0 AND p.SIGN=1 AND p.MODULENR=4 AND i.CANCELLED=0 AND i.GRPCODE=1 AND i.TRCODE IN (1,4) AND p.TOTAL>p.PAID GROUP BY p.TRCURR,CONVERT(varchar(7),p.DATE_,126) UNION ALL SELECT 426,p.TRCURR,CONVERT(varchar(7),p.DATE_,126),COUNT(*),SUM(p.TOTAL-p.PAID) FROM [LOGO_DND].[dbo].[LG_426_01_PAYTRANS] p INNER JOIN [LOGO_DND].[dbo].[LG_426_01_INVOICE] i ON i.LOGICALREF=p.FICHEREF WHERE p.CANCELLED=0 AND p.SIGN=1 AND p.MODULENR=4 AND i.CANCELLED=0 AND i.GRPCODE=1 AND i.TRCODE IN (1,4) AND p.TOTAL>p.PAID GROUP BY p.TRCURR,CONVERT(varchar(7),p.DATE_,126)`,
    ],
  ],
  instruments: [
    [
      'check_bank_settlement_links',
      `WITH links AS (SELECT t.CSREF,COUNT(*) AS linkedBankRows,SUM(CASE WHEN b.TRCURR=0 THEN b.AMOUNT ELSE b.TRNET END) AS bankPaid,MIN(CONVERT(varchar(10),b.DATE_,23)) AS firstBankDate,MAX(CONVERT(varchar(10),b.DATE_,23)) AS lastBankDate FROM [LOGO_DND].[dbo].[LG_223_01_CSTRANS] t INNER JOIN [LOGO_DND].[dbo].[LG_223_01_BNFLINE] b ON b.CSTRANSREF=t.LOGICALREF WHERE t.CANCELLED=0 AND b.CANCELLED=0 AND b.TRCODE=18 GROUP BY t.CSREF) SELECT c.DOC,c.CURRSTAT,c.TRCURR,COUNT(*) AS checks,COUNT(l.CSREF) AS checksWithBankPayment,SUM(ISNULL(l.linkedBankRows,0)) AS linkedBankRows,SUM(CASE WHEN c.TRCURR=0 THEN c.AMOUNT ELSE c.TRNET END) AS checkAmount,SUM(ISNULL(l.bankPaid,0)) AS linkedBankPayment,SUM(CASE WHEN l.CSREF IS NOT NULL AND ABS(ISNULL(l.bankPaid,0)-CASE WHEN c.TRCURR=0 THEN c.AMOUNT ELSE c.TRNET END)>0.02 THEN 1 ELSE 0 END) AS amountMismatchChecks FROM [LOGO_DND].[dbo].[LG_223_01_CSCARD] c LEFT JOIN links l ON l.CSREF=c.LOGICALREF WHERE c.CANCELLED=0 GROUP BY c.DOC,c.CURRSTAT,c.TRCURR ORDER BY c.CURRSTAT,c.TRCURR`,
    ],
    [
      'check_current_status_history',
      `SELECT c.CURRSTAT,t.STATUS,t.TRCODE,r.TRCODE AS rollCode,t.FROMBANK,t.FROMCASH,COUNT(*) AS movementRows,COUNT(DISTINCT c.LOGICALREF) AS checks FROM [LOGO_DND].[dbo].[LG_223_01_CSCARD] c INNER JOIN [LOGO_DND].[dbo].[LG_223_01_CSTRANS] t ON t.CSREF=c.LOGICALREF LEFT JOIN [LOGO_DND].[dbo].[LG_223_01_CSROLL] r ON r.LOGICALREF=t.ROLLREF WHERE c.CANCELLED=0 AND t.CANCELLED=0 GROUP BY c.CURRSTAT,t.STATUS,t.TRCODE,r.TRCODE,t.FROMBANK,t.FROMCASH ORDER BY c.CURRSTAT,t.STATUS,t.TRCODE`,
    ],
    [
      'check_bank_view_labels',
      `SELECT [IŞLEM] AS transactionLabel,[DOVİZ] AS currency,COUNT(*) AS rows,SUM([DVALACAK]) AS transactionCredit FROM [LOGO_DND].[dbo].[L_223_BANKA_HAREKET] WHERE [IŞLEM] LIKE N'%ek%' OR [IŞLEM] LIKE N'%enet%' GROUP BY [IŞLEM],[DOVİZ] ORDER BY [IŞLEM],[DOVİZ]`,
    ],
    [
      'bank_credit_inventory',
      `SELECT 'LG_223_BNCREDITCARD' AS source,COUNT(*) AS rows FROM [LOGO_DND].[dbo].[LG_223_BNCREDITCARD] UNION ALL SELECT 'LG_223_BNCREPAYTR',COUNT(*) FROM [LOGO_DND].[dbo].[LG_223_BNCREPAYTR] UNION ALL SELECT 'LG_223_CREDITLETTERS',COUNT(*) FROM [LOGO_DND].[dbo].[LG_223_CREDITLETTERS] UNION ALL SELECT 'LG_223_EXPCREDITCRD',COUNT(*) FROM [LOGO_DND].[dbo].[LG_223_EXPCREDITCRD]`,
    ],
    [
      'bank_credit_schedule',
      `SELECT TOP (250) c.CRESTATUS,c.CREDITTYPE,c.TRCURR,p.TRANSTYPE,p.PERNR,CONVERT(varchar(7),p.DUEDATE,126) AS dueMonth,COUNT(*) AS rows,SUM(p.TOTAL) AS total,SUM(p.INTTOTAL) AS interestTotal,SUM(p.BSMVTOTAL) AS bsmvTotal,SUM(p.KKDFTOTAL) AS kkdfTotal,SUM(CASE WHEN p.BNFCHREF>0 THEN 1 ELSE 0 END) AS bankLinkedRows FROM [LOGO_DND].[dbo].[LG_223_BNCREPAYTR] p INNER JOIN [LOGO_DND].[dbo].[LG_223_BNCREDITCARD] c ON c.LOGICALREF=p.CREDITREF GROUP BY c.CRESTATUS,c.CREDITTYPE,c.TRCURR,p.TRANSTYPE,p.PERNR,CONVERT(varchar(7),p.DUEDATE,126) ORDER BY dueMonth,c.TRCURR`,
    ],
  ],
};
async function main() {
  if (!queries[stage]) throw new Error('Unknown read-only research stage');
  mkdirSync(dir, { recursive: true });
  const evidence: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    asOf: paymentTrackingToday(),
    mode: 'SEQUENTIAL_SELECT_ONLY_NO_NOLOCK_NO_WRITES',
    isolationCaveat:
      'Separate statements, not one transaction snapshot; concurrent accounting edits may cause small cross-query differences.',
    privacy:
      'Aggregate financial amounts, code families and schema only; no names, full account codes, document numbers, bank accounts, source row identities or credentials.',
    configuration: config.publicConfiguration(),
    results: [],
  };
  const results = evidence.results as Array<Record<string, unknown>>;
  const persist = () =>
    writeFileSync(
      resolve(dir, `payables-${stage}.json`),
      JSON.stringify(evidence, null, 2),
    );
  persist();
  try {
    for (const [name, query] of queries[stage]) {
      const startedAt = new Date().toISOString();
      const started = Date.now();
      try {
        const rows = await database.query(query, {
          asOf: evidence.asOf as string,
        });
        results.push({
          name,
          query,
          startedAt,
          finishedAt: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          rowCount: rows.length,
          rows,
        });
        console.log(
          JSON.stringify({
            name,
            rows: rows.length,
            elapsedMs: Date.now() - started,
          }),
        );
      } catch (error) {
        results.push({
          name,
          query,
          startedAt,
          error: error instanceof Error ? error.name : 'UnknownError',
        });
        console.log(JSON.stringify({ name, status: 'FAILED' }));
      }
      persist();
    }
    evidence.finishedAt = new Date().toISOString();
    persist();
  } finally {
    await database.onModuleDestroy();
  }
}
void main().catch(() => {
  console.error('Read-only payables research failed');
  process.exitCode = 1;
});
