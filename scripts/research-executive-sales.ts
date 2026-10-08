import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';

const probes = [
  {
    name: 'invoiceTypes',
    sql: `SELECT TRCODE, CANCELLED, TRCURR, COUNT(*) AS invoiceCount, MIN(DATE_) AS firstDate, MAX(DATE_) AS lastDate,
      SUM(CASE WHEN TRCURR<>0 AND TRRATE<=0 THEN 1 ELSE 0 END) AS nonLocalWithoutRate,
      SUM(CASE WHEN TRCURR<>0 AND ABS(TRNET-NETTOTAL/NULLIF(TRRATE,0))>1 THEN 1 ELSE 0 END) AS transactionNetRateMismatch
      FROM dbo.LG_223_01_INVOICE GROUP BY TRCODE,CANCELLED,TRCURR ORDER BY TRCODE,CANCELLED,TRCURR`,
  },
  {
    name: 'monthlyInvoiceActivity',
    sql: `SELECT CONVERT(char(7),DATE_,126) AS month, TRCODE, TRCURR, COUNT(*) AS invoiceCount,
      ROUND(SUM(CASE WHEN TRCURR=0 THEN NETTOTAL ELSE TRNET END),2) AS nativeInvoiceTotal
      FROM dbo.LG_223_01_INVOICE WHERE CANCELLED=0 AND TRCODE IN (2,3,7,8)
      AND DATE_>='2026-01-01' AND DATE_<'2026-10-04' GROUP BY CONVERT(char(7),DATE_,126),TRCODE,TRCURR
      ORDER BY month,TRCODE,TRCURR`,
  },
  {
    name: 'salesInvoiceDimensions',
    sql: `SELECT COUNT(*) AS invoices,
      SUM(CASE WHEN ISNULL(i.SALESMANREF,0)=0 THEN 1 ELSE 0 END) AS missingRepresentative,
      SUM(CASE WHEN ISNULL(i.PROJECTREF,0)=0 THEN 1 ELSE 0 END) AS missingProject,
      SUM(CASE WHEN NULLIF(LTRIM(RTRIM(i.TRADINGGRP)),'') IS NULL THEN 1 ELSE 0 END) AS missingBroker,
      SUM(CASE WHEN NULLIF(LTRIM(RTRIM(i.CYPHCODE)),'') IS NULL THEN 1 ELSE 0 END) AS blankAuthorization,
      COUNT(DISTINCT NULLIF(i.SALESMANREF,0)) AS representatives,
      COUNT(DISTINCT NULLIF(i.PROJECTREF,0)) AS rawProjectReferences,
      SUM(CASE WHEN p.CODE='KDV' THEN 1 ELSE 0 END) AS vatProjectInvoices,
      SUM(CASE WHEN p.CODE LIKE '%TRAFO%' THEN 1 ELSE 0 END) AS transformerProjectInvoices
      FROM dbo.LG_223_01_INVOICE i LEFT JOIN dbo.LG_223_PROJECT p ON p.LOGICALREF=i.PROJECTREF
      WHERE i.CANCELLED=0 AND i.TRCODE IN (7,8)`,
  },
  {
    name: 'salesLineMultiplicity',
    sql: `WITH s AS (SELECT i.LOGICALREF,COUNT(*) AS lineCount,COUNT(DISTINCT l.STOCKREF) AS stocks,
      SUM(CASE WHEN ISNULL(l.SALESMANREF,0)=0 THEN 1 ELSE 0 END) AS linesWithoutRepresentative,
      SUM(CASE WHEN l.SALESMANREF<>i.SALESMANREF AND l.SALESMANREF>0 THEN 1 ELSE 0 END) AS representativeMismatch
      FROM dbo.LG_223_01_INVOICE i JOIN dbo.LG_223_01_STLINE l ON l.INVOICEREF=i.LOGICALREF
      WHERE i.CANCELLED=0 AND l.CANCELLED=0 AND i.TRCODE IN (2,3,7,8) AND l.LINETYPE=0 GROUP BY i.LOGICALREF)
      SELECT COUNT(*) AS invoicesWithMaterialLines,SUM(lineCount) AS lines,SUM(CASE WHEN lineCount>1 THEN 1 ELSE 0 END) AS multipleLines,
      MAX(lineCount) AS maxLines,SUM(linesWithoutRepresentative) AS linesWithoutRepresentative,SUM(representativeMismatch) AS representativeMismatch FROM s`,
  },
  {
    name: 'salesViewSemantics',
    sql: `SELECT [TÜR] AS invoiceKind,DVZ,COUNT(*) AS records,COUNT(DISTINCT [FATURA NO]) AS invoiceNumbers,
      SUM(CASE WHEN [SATIR TUTAR]>0 THEN 1 ELSE 0 END) AS positiveLineValues,
      SUM(CASE WHEN [SATIR TUTAR]<0 THEN 1 ELSE 0 END) AS negativeLineValues,
      SUM(CASE WHEN TOPLAM>0 THEN 1 ELSE 0 END) AS positiveHeaderTotals
      FROM dbo.L_223_DB_SATISLAR GROUP BY [TÜR],DVZ ORDER BY [TÜR],DVZ`,
  },
  {
    name: 'ordersBase',
    sql: `SELECT o.TRCODE,o.LINETYPE,o.CANCELLED,COUNT(*) AS orderLines,COUNT(DISTINCT o.ORDFICHEREF) AS orderHeaders,
      SUM(CASE WHEN i.LOGICALREF IS NOT NULL AND s.LOGICALREF IS NOT NULL THEN 1 ELSE 0 END) AS itemAndServiceReferenceCollision,
      SUM(CASE WHEN o.AMOUNT<>o.SHIPPEDAMOUNT THEN 1 ELSE 0 END) AS orderedDiffersFromShipped,
      MIN(o.DATE_) AS firstDate,MAX(o.DATE_) AS lastDate
      FROM dbo.LG_223_01_ORFLINE o LEFT JOIN dbo.LG_223_ITEMS i ON i.LOGICALREF=o.STOCKREF
      LEFT JOIN dbo.LG_223_SRVCARD s ON s.LOGICALREF=o.STOCKREF
      GROUP BY o.TRCODE,o.LINETYPE,o.CANCELLED ORDER BY o.TRCODE,o.LINETYPE,o.CANCELLED`,
  },
  {
    name: 'orderViewCoverage',
    sql: `SELECT [SİP_TÜRÜ] AS orderType,COUNT(*) AS viewRows,COUNT(DISTINCT [SİP_FİŞİ_NO]) AS orderNumbers,
      SUM(CASE WHEN FAT_NO IS NULL THEN 1 ELSE 0 END) AS rowsWithoutInvoice,
      COUNT(DISTINCT FAT_NO) AS invoiceNumbers,
      SUM(CASE WHEN [SİP_DÖV_TÜRÜ]<>FAT_DV THEN 1 ELSE 0 END) AS crossCurrencyRows,
      SUM(CASE WHEN SAY>1 THEN 1 ELSE 0 END) AS rowsWithMultipleLinkedLines
      FROM dbo.L_223_SPARIS_FATURA_HAREKET GROUP BY [SİP_TÜRÜ]`,
  },
  {
    name: 'itemInventory',
    sql: `SELECT CARDTYPE,ACTIVE,COUNT(*) AS cards,
      SUM(CASE WHEN ISNULL(PROJECTREF,0)=0 THEN 1 ELSE 0 END) AS missingProject,
      SUM(CASE WHEN CODE LIKE 'LJ-%' OR CODE LIKE 'LJP-%' OR CODE LIKE 'LJP2-%' OR CODE LIKE 'LV-%' THEN 1 ELSE 0 END) AS knownProjectPrefix
      FROM dbo.LG_223_ITEMS GROUP BY CARDTYPE,ACTIVE ORDER BY CARDTYPE,ACTIVE`,
  },
  {
    name: 'knownPrefixItemActivity',
    sql: `WITH a AS (SELECT l.STOCKREF,
      SUM(CASE WHEN i.TRCODE IN (7,8) THEN 1 ELSE 0 END) AS saleLines,
      SUM(CASE WHEN i.TRCODE IN (2,3) THEN 1 ELSE 0 END) AS returnLines,
      SUM(CASE WHEN i.TRCODE IN (7,8) THEN l.AMOUNT WHEN i.TRCODE IN (2,3) THEN -l.AMOUNT ELSE 0 END) AS netInvoiceQuantity
      FROM dbo.LG_223_01_STLINE l JOIN dbo.LG_223_01_INVOICE i ON i.LOGICALREF=l.INVOICEREF
      WHERE l.LINETYPE=0 AND l.CANCELLED=0 AND i.CANCELLED=0 AND i.TRCODE IN (2,3,7,8) GROUP BY l.STOCKREF)
      SELECT COUNT(*) AS knownPrefixCards,
      SUM(CASE WHEN a.STOCKREF IS NULL THEN 1 ELSE 0 END) AS noSaleOrReturnInvoice,
      SUM(CASE WHEN a.returnLines>0 THEN 1 ELSE 0 END) AS cardsWithReturns,
      SUM(CASE WHEN a.saleLines>1 THEN 1 ELSE 0 END) AS multipleSaleLines,
      SUM(CASE WHEN a.netInvoiceQuantity>1 THEN 1 ELSE 0 END) AS netQuantityOverOne,
      SUM(CASE WHEN a.netInvoiceQuantity<0 THEN 1 ELSE 0 END) AS negativeNetQuantity
      FROM dbo.LG_223_ITEMS i LEFT JOIN a ON a.STOCKREF=i.LOGICALREF
      WHERE i.CODE LIKE 'LJ-%' OR i.CODE LIKE 'LJP-%' OR i.CODE LIKE 'LJP2-%' OR i.CODE LIKE 'LV-%'`,
  },
  {
    name: 'stockAccountingBalances',
    sql: `WITH s AS (SELECT STOCKREF,SUM(ONHAND) AS onHand,SUM(RESERVED) AS reserved
      FROM dbo.LV_223_01_STINVTOT WHERE INVENNO=-1 GROUP BY STOCKREF)
      SELECT COUNT(*) AS knownPrefixCards,SUM(CASE WHEN s.STOCKREF IS NULL THEN 1 ELSE 0 END) AS noStockTotals,
      SUM(CASE WHEN s.onHand<0 THEN 1 ELSE 0 END) AS negativeStock,
      SUM(CASE WHEN s.onHand=0 THEN 1 ELSE 0 END) AS zeroStock,
      SUM(CASE WHEN s.onHand>0 THEN 1 ELSE 0 END) AS positiveStock,
      SUM(CASE WHEN s.reserved<>0 THEN 1 ELSE 0 END) AS reservedStock
      FROM dbo.LG_223_ITEMS i LEFT JOIN s ON s.STOCKREF=i.LOGICALREF
      WHERE i.CODE LIKE 'LJ-%' OR i.CODE LIKE 'LJP-%' OR i.CODE LIKE 'LJP2-%' OR i.CODE LIKE 'LV-%'`,
  },
  {
    name: 'orderCommitmentMetadata',
    sql: `SELECT OBJECT_NAME(c.object_id) AS tableName,c.name AS columnName
      FROM sys.columns c WHERE c.object_id IN (OBJECT_ID('dbo.LG_223_01_ORFLINE'),OBJECT_ID('dbo.LG_223_01_ORFICHE'))
      AND c.name IN ('CLOSED','STATUS','DUEDATE','CANCELLED','WITHPAYTRANS','PAYDEFREF')
      ORDER BY tableName,columnName`,
  },
  {
    name: 'orderOutstandingLines',
    sql: `SELECT o.TRCODE,o.TRCURR,o.CLOSED,f.STATUS,COUNT(*) AS orderLines,
      SUM(CASE WHEN o.AMOUNT>o.SHIPPEDAMOUNT THEN 1 ELSE 0 END) AS notFullyReceivedLines,
      SUM(CASE WHEN o.AMOUNT<o.SHIPPEDAMOUNT THEN 1 ELSE 0 END) AS overReceivedLines,
      COUNT(DISTINCT CASE WHEN o.AMOUNT>o.SHIPPEDAMOUNT THEN o.ORDFICHEREF END) AS notFullyReceivedOrderHeaders
      FROM dbo.LG_223_01_ORFLINE o JOIN dbo.LG_223_01_ORFICHE f ON f.LOGICALREF=o.ORDFICHEREF
      WHERE o.CANCELLED=0 AND f.CANCELLED=0 GROUP BY o.TRCODE,o.TRCURR,o.CLOSED,f.STATUS ORDER BY o.TRCODE,o.TRCURR,o.CLOSED,f.STATUS`,
  },
];

async function main() {
  const settings = {
    ...parse(readFileSync(resolve(__dirname, '../.env'))),
    ...process.env,
    LOGO_DB_REQUEST_TIMEOUT_MS: '15000',
    LOGO_DB_CONNECTION_TIMEOUT_MS: '10000',
  };
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const root = resolve(__dirname, '../../output/executive-research-2026-10-03');
  mkdirSync(root, { recursive: true });
  const selectedNames = process.argv.slice(2);
  if (
    selectedNames.some((name) => !probes.some((probe) => probe.name === name))
  )
    throw new Error('Unknown aggregate probe');
  const report: Record<string, unknown> = selectedNames.length
    ? (JSON.parse(readFileSync(resolve(root, 'sales.json'), 'utf8')) as Record<
        string,
        unknown
      >)
    : {
        startedAt: new Date().toISOString(),
        database: 'LOGO_DND',
        firm: 223,
        period: 1,
        mode: 'SEQUENTIAL_SELECT_ONLY_AGGREGATES',
        limitation:
          'Read-only aggregate statements, not a transaction snapshot. No names, contacts, account numbers or customer/unit identifiers.',
        results: [],
      };
  const results = report.results as Array<Record<string, unknown>>;
  try {
    for (const probe of probes.filter(
      (probe) => !selectedNames.length || selectedNames.includes(probe.name),
    )) {
      const start = Date.now();
      try {
        const rows = await database.query(probe.sql);
        const oldIndex = results.findIndex(
          (result) => result.name === probe.name,
        );
        if (oldIndex >= 0) results.splice(oldIndex, 1);
        results.push({
          name: probe.name,
          sql: probe.sql,
          rows,
          elapsedMs: Date.now() - start,
        });
        console.log(
          JSON.stringify({
            name: probe.name,
            rowCount: rows.length,
            elapsedMs: Date.now() - start,
          }),
        );
      } catch {
        results.push({ name: probe.name, status: 'UNAVAILABLE' });
        console.log(
          JSON.stringify({ name: probe.name, status: 'UNAVAILABLE' }),
        );
      }
    }
  } finally {
    await database.onModuleDestroy();
    report.finishedAt = new Date().toISOString();
    writeFileSync(resolve(root, 'sales.json'), JSON.stringify(report, null, 2));
  }
}

void main().catch(() => {
  console.error('Executive sales research failed; connection details omitted.');
  process.exitCode = 1;
});
