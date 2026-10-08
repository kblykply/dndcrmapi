import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';

const outputDirectory = resolve(
  __dirname,
  '../../output/collection-analytics-2026-10-03',
);
const output = resolve(outputDirectory, 'downpayment-research.json');
const settings = {
  ...parse(readFileSync(resolve(__dirname, '../.env'))),
  ...process.env,
};
const database = new LogoDatabaseService(
  new LogoConfigService(new ConfigService(settings)),
);
const stage = process.argv[2] || 'metadata';
const evidence: Record<string, unknown> =
  stage === 'metadata'
    ? {
        startedAt: new Date().toISOString(),
        mode: 'READ_ONLY_PARAMETERIZED_SELECT',
        privacy:
          'No names, unit/customer codes, source record identities or raw financial descriptions are persisted. Workbook instructions/formulas are not executed.',
        temporalCaveat:
          'Excel monthly lists are saved report snapshots. The database is current as of the query time; amount differences are not cash receipt evidence.',
      }
    : JSON.parse(readFileSync(output, 'utf8'));

type Sample = {
  id: number;
  sheet: string;
  row: number;
  marked: boolean;
  unit: string;
  customer: string;
  due: string;
  outstanding: number;
};
function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .toUpperCase()
    .trim();
}
function textKind(value: unknown) {
  const text = norm(value);
  // "Peşin" can describe a cash/immediate payment plan, not a contract deposit.
  return !text
    ? 'EMPTY'
    : /PESIN|DOWN\s*PAY|DEPOSIT/.test(text)
      ? 'DOWNPAYMENT_OR_CASH_WORD_ONLY'
      : /TAKSIT|INSTALL?MENT/.test(text)
        ? 'INSTALLMENT_WORD_ONLY'
        : 'OTHER';
}
function anonymousValue(value: unknown): string {
  return !String(value ?? '').trim()
    ? 'EMPTY'
    : createHash('sha256')
        .update(String(value).trim())
        .digest('hex')
        .slice(0, 10);
}
function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function main() {
  if (stage === 'metadata') {
    const rows = await database.query<{
      tableName: string;
      columnName: string;
      dataType: string;
    }>(`
      SELECT t.name AS tableName,c.name AS columnName,ty.name AS dataType
      FROM [LOGO_DND].sys.tables t
      INNER JOIN [LOGO_DND].sys.columns c ON c.object_id=t.object_id
      INNER JOIN [LOGO_DND].sys.types ty ON ty.user_type_id=c.user_type_id
      WHERE t.name IN ('LG_223_01_PAYTRANS','LG_223_01_INVOICE','LG_223_01_STLINE','LG_223_CLCARD','LG_223_ITEMS')
      OR t.name LIKE 'LG[_]223[_]%PAY%'
      ORDER BY t.name,c.column_id`);
    evidence.metadata = rows;
    console.log(
      JSON.stringify({
        stage,
        tableCount: new Set(rows.map((r) => r.tableName)).size,
        columnCount: rows.length,
      }),
    );
  }
  if (stage === 'samples') {
    const samples: Sample[] = JSON.parse(
      execFileSync(
        'python3',
        [resolve(__dirname, 'collection-downpayment-samples.py')],
        { encoding: 'utf8' },
      ),
    );
    const parameters: Record<string, string | number> = {};
    const values = samples
      .map((sample) => {
        parameters[`id${sample.id}`] = sample.id;
        parameters[`unit${sample.id}`] = sample.unit;
        return `(@id${sample.id},@unit${sample.id})`;
      })
      .join(',');
    const rows = await database.query<Record<string, any>>(
      `WITH Samples AS (
      SELECT sampleId,unitCode FROM (VALUES ${values}) AS V(sampleId,unitCode)
    ), Invoices AS (
      SELECT DISTINCT S.sampleId,I.LOGICALREF AS invoiceId,I.CLIENTREF,I.DATE_ AS invoiceDate,
        I.CANCELLED AS invoiceCancelled,I.TRCODE AS invoiceCode,I.SPECODE AS invoiceSpecode,
        I.PAYDEFREF AS invoicePayplan,I.PAYMENTTYPE AS invoicePaymentType,I.DEVIR AS invoiceTransfer,
        I.GENEXP1,I.GENEXP2,I.GENEXP3,I.GENEXP4,I.GENEXP5,I.GENEXP6,
        ST.LINEEXP AS stockLineDescription,ST.SPECODE AS stockSpecode,ST.SPECODE2 AS stockSpecode2,
        ST.PAYDEFREF AS stockPayplan,ST.CANCELLED AS stockCancelled,PR.CODE AS projectCode,
        C.DEFINITION_ AS customerName,C.PAYMENTREF AS customerPayplan,C.PAYMENTTYPE AS customerPaymentType
      FROM Samples S
      INNER JOIN [LOGO_DND].[dbo].[LG_223_ITEMS] IT ON IT.CODE=S.unitCode
      INNER JOIN [LOGO_DND].[dbo].[LG_223_01_STLINE] ST ON ST.STOCKREF=IT.LOGICALREF AND ST.LINETYPE=0
      INNER JOIN [LOGO_DND].[dbo].[LG_223_01_INVOICE] I ON I.LOGICALREF=ST.INVOICEREF
      INNER JOIN [LOGO_DND].[dbo].[LG_223_CLCARD] C ON C.LOGICALREF=I.CLIENTREF
      LEFT JOIN [LOGO_DND].[dbo].[LG_223_PROJECT] PR ON PR.LOGICALREF=ST.PROJECTREF
      WHERE I.GRPCODE=2 AND I.TRCODE IN (7,8)
    ) SELECT TOP (5001) I.*,P.LOGICALREF AS paymentId,P.CARDREF,P.DATE_ AS dueDate,P.PROCDATE,
      P.CANCELLED AS paymentCancelled,P.TRCURR,P.TOTAL,P.PAID,P.PAYNO,P.PAYMENTTYPE,P.INSTALTYPE,
      P.INSTALREF,P.MAININSTALREF,P.REPAYPLANREF,P.SPECODE AS paymentSpecode,P.LINEEXP AS paymentDescription,
      P.DEVIR AS paymentTransfer,P.PAIDINCASH,P.STLINEREF,P.FICHELINEREF,
      PP.CODE AS planCode,PP.DEFINITION_ AS planDescription,PP.SPECODE AS planSpecode,
      CASE WHEN EXISTS (SELECT 1 FROM [LOGO_DND].[dbo].[LG_223_01_STLINE] O
        INNER JOIN [LOGO_DND].[dbo].[LG_223_01_STLINE] R ON R.SOURCELINK=O.LOGICALREF
        INNER JOIN [LOGO_DND].[dbo].[LG_223_01_INVOICE] RI ON RI.LOGICALREF=R.INVOICEREF
        WHERE O.INVOICEREF=I.invoiceId AND O.LINETYPE=0 AND R.CANCELLED=0 AND RI.CANCELLED=0 AND RI.TRCODE IN (2,3)
      ) THEN 1 ELSE 0 END AS hasReturnLink
    FROM Invoices I
    INNER JOIN [LOGO_DND].[dbo].[LG_223_01_PAYTRANS] P ON P.FICHEREF=I.invoiceId AND P.MODULENR=4
    LEFT JOIN [LOGO_DND].[dbo].[LG_223_PAYPLANS] PP ON PP.LOGICALREF=I.invoicePayplan
    ORDER BY I.sampleId,I.invoiceId,P.DATE_,P.LOGICALREF`,
      parameters,
    );
    if (rows.length >= 5001) throw new Error('Sample row limit exceeded');
    const date = (value: unknown) =>
      new Date(String(value)).toISOString().slice(0, 10);
    const numericFields = [
      'invoiceCode',
      'invoicePaymentType',
      'invoiceTransfer',
      'stockCancelled',
      'customerPaymentType',
      'TRCURR',
      'PAYNO',
      'PAYMENTTYPE',
      'INSTALTYPE',
      'INSTALREF',
      'MAININSTALREF',
      'REPAYPLANREF',
      'paymentTransfer',
      'PAIDINCASH',
    ];
    const referenceFields = [
      'invoicePayplan',
      'stockPayplan',
      'customerPayplan',
      'STLINEREF',
      'FICHELINEREF',
    ];
    const textFields = [
      'invoiceSpecode',
      'GENEXP1',
      'GENEXP2',
      'GENEXP3',
      'GENEXP4',
      'GENEXP5',
      'GENEXP6',
      'stockLineDescription',
      'stockSpecode',
      'stockSpecode2',
      'paymentSpecode',
      'paymentDescription',
      'planCode',
      'planDescription',
      'planSpecode',
    ];
    const results = samples.map((sample) => {
      const unitRows = rows.filter((row) => row.sampleId === sample.id);
      const matchingCustomer = unitRows.filter(
        (row) => norm(row.customerName) === norm(sample.customer),
      );
      const matchingDue = matchingCustomer.filter(
        (row) =>
          date(row.dueDate) === sample.due &&
          row.TRCURR === 17 &&
          row.invoiceCancelled === 0 &&
          row.stockCancelled === 0 &&
          row.paymentCancelled === 0,
      );
      const dedup = [
        ...new Map(matchingDue.map((row) => [row.paymentId, row])).values(),
      ];
      const remaining = dedup.reduce(
        (sum, row) => sum + Math.max(0, row.TOTAL - row.PAID),
        0,
      );
      const linkedRows = matchingCustomer.filter(
        (row) =>
          dedup.some((match) => match.invoiceId === row.invoiceId) &&
          row.paymentCancelled === 0,
      );
      const days = distinct(linkedRows.map((row) => date(row.dueDate))).sort();
      return {
        sample: `${sample.sheet}-R${sample.row}`,
        markedAsDownpayment: sample.marked,
        dueDate: sample.due,
        workbookOutstandingGBP: sample.outstanding,
        matchedUnitInvoices: distinct(unitRows.map((row) => row.invoiceId))
          .length,
        matchedCustomerInvoices: distinct(
          matchingCustomer.map((row) => row.invoiceId),
        ).length,
        matchedActivePayments: dedup.length,
        currentOutstandingGBP: dedup.length ? remaining : null,
        matchesWorkbookAmount:
          dedup.length > 0 && Math.abs(remaining - sample.outstanding) < 0.02,
        linkedInvoiceHasReturn: dedup.some((row) => row.hasReturnLink === 1),
        linkedSchedulePaymentCount: distinct(
          linkedRows.map((row) => row.paymentId),
        ).length,
        duePosition: days.indexOf(sample.due) + 1,
        scheduleDueCount: days.length,
        earliestDue: days[0] ?? null,
        dueOnInvoiceDate: dedup.map(
          (row) => date(row.invoiceDate) === sample.due,
        ),
        precedingDueRows: linkedRows.filter(
          (row) => date(row.dueDate) < sample.due,
        ).length,
        precedingFullyClosedRows: linkedRows.filter(
          (row) => date(row.dueDate) < sample.due && row.PAID >= row.TOTAL,
        ).length,
        fields: Object.fromEntries(
          numericFields.map((field) => [
            field,
            distinct(dedup.map((row) => row[field])),
          ]),
        ),
        references: Object.fromEntries(
          referenceFields.map((field) => [
            field,
            {
              nonzeroRows: dedup.filter((row) => row[field] > 0).length,
              distinctNonzero: distinct(
                dedup.map((row) => row[field]).filter((value) => value > 0),
              ).length,
            },
          ]),
        ),
        textFields: Object.fromEntries(
          textFields.map((field) => [
            field,
            {
              kinds: distinct(dedup.map((row) => textKind(row[field]))),
              anonymousValues: distinct(
                dedup.map((row) => anonymousValue(row[field])),
              ),
            },
          ]),
        ),
      };
    });
    evidence.samples = results;
    evidence.sampleQuery = {
      checkedAt: new Date().toISOString(),
      inputSamples: samples.length,
      marked: samples.filter((s) => s.marked).length,
      controls: samples.filter((s) => !s.marked).length,
      queryRows: rows.length,
    };
    console.log(
      JSON.stringify({
        stage,
        ...(evidence.sampleQuery as object),
        matchedSamples: results.filter((r) => r.matchedActivePayments > 0)
          .length,
        amountMatches: results.filter((r) => r.matchesWorkbookAmount).length,
      }),
    );
  }
  if (stage === 'profile') {
    const profiles = await database.query<Record<string, string>>(
      `WITH Eligible AS (
      SELECT P.*,I.PAYDEFREF AS invoicePayplan,I.PAYMENTTYPE AS invoicePaymentType,
        CONCAT(I.GENEXP1,' ',I.GENEXP2,' ',I.GENEXP3,' ',I.GENEXP4,' ',I.GENEXP5,' ',I.GENEXP6) AS invoiceDescription
      FROM [LOGO_DND].[dbo].[LG_223_01_PAYTRANS] P
      INNER JOIN [LOGO_DND].[dbo].[LG_223_01_INVOICE] I ON I.LOGICALREF=P.FICHEREF
      WHERE P.MODULENR=4 AND P.TRCODE IN (7,8) AND P.CANCELLED=0 AND I.CANCELLED=0
      AND EXISTS (SELECT 1 FROM [LOGO_DND].[dbo].[LG_223_01_STLINE] ST
        INNER JOIN [LOGO_DND].[dbo].[LG_223_PROJECT] PR ON PR.LOGICALREF=ST.PROJECTREF
        WHERE ST.INVOICEREF=I.LOGICALREF AND ST.LINETYPE=0 AND ST.CANCELLED=0 AND PR.CODE<>'KDV')
    ) SELECT (
      SELECT COUNT(*) AS paymentRows,COUNT(DISTINCT FICHEREF) AS invoices,
        SUM(CASE WHEN invoicePayplan>0 THEN 1 ELSE 0 END) AS rowsWithInvoicePayplan,
        SUM(CASE WHEN REPAYPLANREF>0 THEN 1 ELSE 0 END) AS rowsWithRepayplan,
        SUM(CASE WHEN INSTALREF>0 OR MAININSTALREF>0 THEN 1 ELSE 0 END) AS rowsWithInstalRef,
        SUM(CASE WHEN NULLIF(LTRIM(RTRIM(LINEEXP)),'') IS NOT NULL THEN 1 ELSE 0 END) AS rowsWithPaymentDescription,
        SUM(CASE WHEN NULLIF(LTRIM(RTRIM(SPECODE)),'') IS NOT NULL THEN 1 ELSE 0 END) AS rowsWithPaymentSpecode,
        SUM(CASE WHEN CONCAT(LINEEXP,' ',SPECODE) COLLATE Turkish_CI_AI LIKE @down THEN 1 ELSE 0 END) AS rowsWithPaymentDownpaymentKeyword,
        COUNT(DISTINCT CASE WHEN invoiceDescription COLLATE Turkish_CI_AI LIKE @down THEN FICHEREF END) AS invoicesWithDownpaymentKeyword,
        COUNT(DISTINCT CASE WHEN invoiceDescription COLLATE Turkish_CI_AI LIKE @installment THEN FICHEREF END) AS invoicesWithInstallmentKeyword,
        SUM(CASE WHEN DEVIR<>0 THEN 1 ELSE 0 END) AS transferRows,
        MIN(PAYNO) AS minimumPayno,MAX(PAYNO) AS maximumPayno
      FROM Eligible FOR JSON PATH,WITHOUT_ARRAY_WRAPPER
    ) AS sourceProfile, (
      SELECT PAYMENTTYPE,invoicePaymentType,INSTALTYPE,PAIDINCASH,COUNT(*) AS paymentRows
      FROM Eligible GROUP BY PAYMENTTYPE,invoicePaymentType,INSTALTYPE,PAIDINCASH FOR JSON PATH
    ) AS paymentFlags, (
      SELECT COUNT(*) AS plans,
        SUM(CASE WHEN CONCAT(CODE,' ',DEFINITION_,' ',DEFINITION2,' ',SPECODE) COLLATE Turkish_CI_AI LIKE @down THEN 1 ELSE 0 END) AS plansWithDownpaymentKeyword,
        SUM(CASE WHEN CONCAT(CODE,' ',DEFINITION_,' ',DEFINITION2,' ',SPECODE) COLLATE Turkish_CI_AI LIKE @installment THEN 1 ELSE 0 END) AS plansWithInstallmentKeyword,
        (SELECT COUNT(*) FROM [LOGO_DND].[dbo].[LG_223_PAYLINES]) AS planLines
      FROM [LOGO_DND].[dbo].[LG_223_PAYPLANS] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER
    ) AS planProfile`,
      { down: '%peşin%', installment: '%taksit%' },
    );
    evidence.globalProfile = Object.fromEntries(
      Object.entries(profiles[0]).map(([key, value]) => [
        key,
        JSON.parse(value),
      ]),
    );

    const samples: Sample[] = JSON.parse(
      execFileSync(
        'python3',
        [resolve(__dirname, 'collection-downpayment-samples.py')],
        { encoding: 'utf8' },
      ),
    );
    const sample = samples.find(
      (item) => item.sheet === 'EYLÜL' && item.row === 8,
    )!;
    const followup = await database.query<Record<string, unknown>>(
      `SELECT TOP (101)
      CONVERT(varchar(10),P.DATE_,23) AS dueDate,CONVERT(varchar(10),I.DATE_,23) AS invoiceDate,
      P.TOTAL AS total,P.PAID AS paid,P.PAYNO,P.TRCURR,P.CANCELLED AS paymentCancelled,
      I.CANCELLED AS invoiceCancelled,ST.CANCELLED AS stockCancelled,P.DEVIR AS paymentTransfer,
      P.PAYMENTTYPE,P.INSTALTYPE,I.PAYDEFREF AS invoicePayplan,
      CASE WHEN NULLIF(LTRIM(RTRIM(P.LINEEXP)),'') IS NULL THEN 0 ELSE 1 END AS paymentDescriptionPresent,
      CASE WHEN EXISTS (SELECT 1 FROM [LOGO_DND].[dbo].[LG_223_01_STLINE] R
        INNER JOIN [LOGO_DND].[dbo].[LG_223_01_INVOICE] RI ON RI.LOGICALREF=R.INVOICEREF
        WHERE R.SOURCELINK=ST.LOGICALREF AND R.CANCELLED=0 AND RI.CANCELLED=0 AND RI.TRCODE IN (2,3)
      ) THEN 1 ELSE 0 END AS hasReturnLink
      FROM [LOGO_DND].[dbo].[LG_223_ITEMS] IT
      INNER JOIN [LOGO_DND].[dbo].[LG_223_01_STLINE] ST ON ST.STOCKREF=IT.LOGICALREF AND ST.LINETYPE=0
      INNER JOIN [LOGO_DND].[dbo].[LG_223_01_INVOICE] I ON I.LOGICALREF=ST.INVOICEREF
      INNER JOIN [LOGO_DND].[dbo].[LG_223_CLCARD] C ON C.LOGICALREF=I.CLIENTREF
      INNER JOIN [LOGO_DND].[dbo].[LG_223_01_PAYTRANS] P ON P.FICHEREF=I.LOGICALREF AND P.MODULENR=4
      WHERE IT.CODE=@unit AND LTRIM(RTRIM(C.DEFINITION_))=@customer AND I.GRPCODE=2 AND I.TRCODE IN (7,8)
      ORDER BY P.DATE_,P.LOGICALREF`,
      { unit: sample.unit, customer: sample.customer },
    );
    if (followup.length >= 101) throw new Error('Followup limit exceeded');
    evidence.unmatchedFollowup = {
      sample: 'EYLÜL-R8',
      workbookDueDate: sample.due,
      workbookOutstandingGBP: sample.outstanding,
      rows: followup,
    };
    console.log(
      JSON.stringify({
        stage,
        profile: evidence.globalProfile,
        followupRows: followup.length,
      }),
    );
  }
  if (stage === 'plans') {
    const plans = await database.query<
      Record<string, any>
    >(`SELECT PP.CODE,PP.DEFINITION_,PP.SPECODE,
      PL.LINENO_,PL.FORMULA,PL.CONDITION,PL.DAY_,PL.MOUNTH,PL.YEAR_,PL.PAYMENTTYPE,
      U.invoices,U.paymentRows,U.openRows
      FROM [LOGO_DND].[dbo].[LG_223_PAYPLANS] PP
      LEFT JOIN [LOGO_DND].[dbo].[LG_223_PAYLINES] PL ON PL.PAYPLANREF=PP.LOGICALREF
      OUTER APPLY (
        SELECT COUNT(DISTINCT I.LOGICALREF) AS invoices,COUNT(P.LOGICALREF) AS paymentRows,
          SUM(CASE WHEN P.TOTAL>P.PAID THEN 1 ELSE 0 END) AS openRows
        FROM [LOGO_DND].[dbo].[LG_223_01_INVOICE] I
        INNER JOIN [LOGO_DND].[dbo].[LG_223_01_PAYTRANS] P ON P.FICHEREF=I.LOGICALREF AND P.MODULENR=4
        WHERE I.PAYDEFREF=PP.LOGICALREF AND P.TRCODE IN (7,8) AND P.CANCELLED=0 AND I.CANCELLED=0
        AND EXISTS (SELECT 1 FROM [LOGO_DND].[dbo].[LG_223_01_STLINE] ST
          INNER JOIN [LOGO_DND].[dbo].[LG_223_PROJECT] PR ON PR.LOGICALREF=ST.PROJECTREF
          WHERE ST.INVOICEREF=I.LOGICALREF AND ST.LINETYPE=0 AND ST.CANCELLED=0 AND PR.CODE<>'KDV')
      ) U ORDER BY PP.LOGICALREF,PL.LINENO_`);
    evidence.paymentPlans = plans.map((plan, index) => ({
      plan: index + 1,
      labelCategory: textKind(`${plan.CODE} ${plan.DEFINITION_}`),
      line: plan.LINENO_,
      day: plan.DAY_,
      month: plan.MOUNTH,
      year: plan.YEAR_,
      paymentType: plan.PAYMENTTYPE,
      formulaCategory: /^P[0-9]+$/.test(String(plan.FORMULA).trim())
        ? String(plan.FORMULA).trim()
        : anonymousValue(plan.FORMULA),
      conditionPresent: Boolean(String(plan.CONDITION ?? '').trim()),
      relevantSalesInvoices: plan.invoices,
      relevantPaymentRows: plan.paymentRows,
      openPaymentRows: plan.openRows ?? 0,
    }));
    console.log(JSON.stringify({ stage, plans: evidence.paymentPlans }));
  }
  if (stage === 'finalize') {
    const samples = evidence.samples as Array<Record<string, any>>;
    for (const sample of samples)
      if (!sample.matchedActivePayments) sample.currentOutstandingGBP = null;
    const plans = evidence.paymentPlans as Array<Record<string, any>>;
    for (const plan of plans)
      if (plan.labelCategory === 'EXPLICIT_DOWNPAYMENT')
        plan.labelCategory = 'DOWNPAYMENT_OR_CASH_WORD_ONLY';
    const followup = evidence.unmatchedFollowup as Record<string, any>;
    if (followup.rows) {
      const rows = followup.rows as Array<Record<string, any>>;
      followup.totalScheduleRows = rows.length;
      followup.sameAmountCandidates = rows.filter(
        (row) =>
          row.TRCURR === 17 &&
          Math.abs(row.total - followup.workbookOutstandingGBP) < 0.02,
      );
      followup.invoiceCancelledRows = rows.filter(
        (row) =>
          row.invoiceCancelled || row.stockCancelled || row.paymentCancelled,
      ).length;
      followup.returnLinkedRows = rows.filter(
        (row) => row.hasReturnLink,
      ).length;
      followup.transferRows = rows.filter((row) => row.paymentTransfer).length;
      followup.explanation =
        'Same unit/customer and amount, but current due date differs from Excel and the matching amount is fully closed. This is an amount-based candidate, not proof that a specific historical payment id remained unchanged or cash was received.';
      delete followup.rows;
    }
    evidence.findings = {
      status: 'NO_RELIABLE_AUTOMATIC_DOWNPAYMENT_RULE',
      source:
        'LOGO_DND company 223, active sales invoice PAYTRANS rows excluding KDV; no application or database changes',
      markedExamples: 12,
      exactIdentityDateAndBalanceMatches: 11,
      unmarkedControls: 6,
      exactControlMatches: 6,
      markedExamplesNotFirstDue: samples.filter(
        (s) =>
          s.markedAsDownpayment && s.matchedActivePayments && s.duePosition > 1,
      ).length,
      unmarkedFirstDueCounterexamples: samples.filter(
        (s) =>
          !s.markedAsDownpayment &&
          s.matchedActivePayments &&
          s.duePosition === 1,
      ).length,
      classificationRejected: [
        'PAYNO=1/first due date: ten of eleven exact marked examples are later positions, while an unmarked control is first.',
        'PAYMENTTYPE/INSTALTYPE/PAIDINCASH: zero across all 18,501 source rows; no separating signal.',
        'Payment LINEEXP: empty on every source row. REPAYPLANREF/INSTALREF/MAININSTALREF absent.',
        'Invoice/stock/customer payplan: absent in every exact marked and control example. Only three source payment rows use any invoice payment plan.',
        'Peşin word in one plan is not a validated contract downpayment classification; its three linked rows do not explain the twelve spreadsheet examples.',
        'Invoice SPECODE and stock SPECODE2 overlap between marked examples and unmarked controls.',
        'Large amount, invoice date or first unpaid row: not a validated business rule; partial closures and split payments make these unsafe.',
      ],
      implementationDecision:
        'Do not publish a downpayment/installment chart or filter from a heuristic. Keep unknown classification explicit; the monthly settlement/project/representative analytics can proceed independently.',
      missingEvidence:
        'A controlled installment-level classification tied to a stable Logo payment id, or a documented contract schedule identifying deposits. Existing aggregated view identities alone are insufficient for durable manual tags.',
      proposedFutureContract: {
        classification: ['downpayment', 'installment', 'unknown'],
        provenance:
          'Explicit validated source field or authorized audited annotation, with source payment id and date/version tracking.',
        unknownPolicy:
          'Unclassified is never implicitly installment; partial and split entries must reconcile to the original total.',
        rulesRequireTests: [
          'known downpayment at PAYNO>1',
          'ordinary installment at PAYNO=1',
          'partial close/split row',
          'same due date mixed labels',
          'moved due date',
          'cancelled/returned/transferred invoice',
          'unclassified source',
          'currency separation',
        ],
      },
    };
    evidence.completedAt = new Date().toISOString();
    console.log(
      JSON.stringify({
        stage,
        status: 'COMPLETED',
        finding: evidence.findings,
      }),
    );
  }
}

main()
  .catch((error) => {
    evidence.error = error?.getResponse?.() ?? {
      message: 'Research query failed; no raw connection error retained.',
    };
    process.exitCode = 1;
  })
  .finally(async () => {
    evidence.updatedAt = new Date().toISOString();
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    await database.onModuleDestroy();
  });
