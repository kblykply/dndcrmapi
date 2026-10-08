import { ServiceUnavailableException } from '@nestjs/common';
import type { LogoDatabaseService } from '../logo-database/logo-database.service';
import type {
  PaymentIdentity,
  PaymentSourceAudit,
  PaymentSourceReview,
} from './payment-tracking.types';

// The finance VIEW remains authoritative. This bounded aggregate checks the
// known join/cancellation assumptions without copying its rows to the client.
// It preserves the VIEW's maximum KDV payment id per unit, including transfers.
export const PAYMENT_SOURCE_AUDIT_QUERY = `WITH PaymentAuditEligible AS (
  SELECT PT.LOGICALREF AS paymentId, PT.FICHEREF AS invoiceId,
    CK.CODE AS customerCode, STK.CODE AS unitCode,
    PRJ.CODE AS projectCode, PT.TRCURR AS currencyCode,
    CASE PT.TRCURR WHEN 0 THEN 'TL' WHEN 1 THEN 'USD' WHEN 17 THEN 'GBP'
      WHEN 20 THEN 'EUR' ELSE 'TANIMSIZ' END AS currency,
    PT.TOTAL AS amount, PT.PAID AS paid, PT.SIGN AS paymentSign,
    FT.CANCELLED AS invoiceCancelled, STL.CANCELLED AS lineCancelled,
    CASE WHEN FT.GRPCODE = 2 AND FT.TRCODE IN (7,8)
      AND FT.TRCODE = PT.TRCODE AND PT.CARDREF = FT.CLIENTREF
      THEN 0 ELSE 1 END AS invalidInvoiceLink,
    COUNT_BIG(*) OVER (PARTITION BY PT.LOGICALREF) AS stockMatches,
    MAX(CASE WHEN PRJ.CODE = 'KDV' THEN PT.LOGICALREF END)
      OVER (PARTITION BY STK.CODE) AS selectedVatId
  FROM [LOGO_DND].[dbo].[LG_223_01_INVOICE] AS FT
  INNER JOIN [LOGO_DND].[dbo].[LG_223_01_STLINE] AS STL ON STL.INVOICEREF = FT.LOGICALREF
  INNER JOIN [LOGO_DND].[dbo].[LG_223_ITEMS] AS STK ON STK.LOGICALREF = STL.STOCKREF
  INNER JOIN [LOGO_DND].[dbo].[LG_223_01_PAYTRANS] AS PT ON PT.FICHEREF = FT.LOGICALREF
  INNER JOIN [LOGO_DND].[dbo].[LG_223_CLCARD] AS CK ON FT.CLIENTREF = CK.LOGICALREF
  LEFT JOIN [LOGO_DND].[dbo].[LG_223_PROJECT] AS PRJ ON STL.PROJECTREF = PRJ.LOGICALREF
  WHERE PT.CANCELLED = 0 AND PT.MODULENR = 4 AND PT.TRCODE IN (7,8)
    AND STL.LINETYPE = 0
    AND (PRJ.CODE <> 'KDV' OR (PRJ.CODE = 'KDV' AND PT.TRCODE = 8))
), PaymentAuditSelected AS (
  SELECT * FROM PaymentAuditEligible
  WHERE projectCode <> 'KDV' OR (unitCode IS NOT NULL AND paymentId = selectedVatId)
), PaymentAuditReceipts AS (
  SELECT A.CROSSREF AS paymentId, COUNT_BIG(*) AS receiptMatches
  FROM [LOGO_DND].[dbo].[L_223_5A_PT_ALACAK] AS A
  WHERE EXISTS (SELECT 1 FROM PaymentAuditSelected AS S WHERE S.paymentId = A.CROSSREF)
  GROUP BY A.CROSSREF
), PaymentAuditOmitted AS (
  SELECT * FROM PaymentAuditEligible
  WHERE projectCode = 'KDV' AND unitCode IS NOT NULL
    AND paymentId <> selectedVatId AND ROUND(amount, 2) > ROUND(paid, 2)
), PaymentAuditReviews AS (
  SELECT O.customerCode, O.unitCode, O.currency,
    S.customerCode AS selectedCustomerCode, S.unitCode AS selectedUnitCode,
    S.currency AS selectedCurrency,
    ROUND(O.amount, 2) - ROUND(O.paid, 2) AS excludedOutstanding,
    CASE WHEN CONVERT(varbinary(max), O.customerCode) = CONVERT(varbinary(max), S.customerCode)
      THEN 0 ELSE 1 END AS hasCustomerChange,
    CASE WHEN EXISTS (
      SELECT 1 FROM [LOGO_DND].[dbo].[LG_223_01_STLINE] AS OriginalLine
      INNER JOIN [LOGO_DND].[dbo].[LG_223_01_STLINE] AS ReturnLine
        ON ReturnLine.SOURCELINK = OriginalLine.LOGICALREF
      INNER JOIN [LOGO_DND].[dbo].[LG_223_01_INVOICE] AS ReturnInvoice
        ON ReturnInvoice.LOGICALREF = ReturnLine.INVOICEREF
      WHERE OriginalLine.INVOICEREF = O.invoiceId AND OriginalLine.LINETYPE = 0
        AND ReturnLine.CANCELLED = 0 AND ReturnInvoice.CANCELLED = 0
        AND ReturnInvoice.TRCODE IN (2,3)
    ) THEN 1 ELSE 0 END AS hasReturnLink
  FROM PaymentAuditOmitted AS O
  INNER JOIN PaymentAuditEligible AS S
    ON S.unitCode = O.unitCode AND S.paymentId = O.selectedVatId
)
SELECT (
  SELECT COUNT_BIG(*) AS paymentRows,
    COALESCE(SUM(CASE WHEN S.stockMatches > 1 THEN 1 ELSE 0 END), 0) AS multipleStockLines,
    COALESCE(SUM(CASE WHEN R.receiptMatches > 1 THEN 1 ELSE 0 END), 0) AS multipleReceiptMatches,
    COALESCE(SUM(CASE WHEN S.invoiceCancelled <> 0 OR S.invoiceCancelled IS NULL THEN 1 ELSE 0 END), 0) AS cancelledInvoices,
    COALESCE(SUM(CASE WHEN S.lineCancelled <> 0 OR S.lineCancelled IS NULL THEN 1 ELSE 0 END), 0) AS cancelledStockLines,
    COALESCE(SUM(CASE WHEN S.paymentSign <> 0 OR S.paymentSign IS NULL THEN 1 ELSE 0 END), 0) AS invalidSigns,
    COALESCE(SUM(S.invalidInvoiceLink), 0) AS invalidInvoiceLinks,
    COALESCE(SUM(CASE WHEN S.currencyCode NOT IN (0,1,17,20) OR S.currencyCode IS NULL THEN 1 ELSE 0 END), 0) AS unknownCurrencies,
    COALESCE(SUM(CASE WHEN S.amount IS NULL OR S.paid IS NULL THEN 1 ELSE 0 END), 0) AS nullAmounts,
    COALESCE(SUM(CASE WHEN NULLIF(LTRIM(RTRIM(S.customerCode)), '') IS NULL
      OR NULLIF(LTRIM(RTRIM(S.unitCode)), '') IS NULL THEN 1 ELSE 0 END), 0) AS missingIdentities,
    (SELECT COUNT_BIG(*) FROM PaymentAuditOmitted) AS excludedVatRows
  FROM PaymentAuditSelected AS S
  LEFT JOIN PaymentAuditReceipts AS R ON R.paymentId = S.paymentId
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS summary, (
  SELECT TOP (25001) customerCode, unitCode, currency,
    selectedCustomerCode, selectedUnitCode, selectedCurrency,
    excludedOutstanding, hasCustomerChange, hasReturnLink
  FROM PaymentAuditReviews
  FOR JSON PATH, INCLUDE_NULL_VALUES
) AS reviews`;

type AuditSummary = {
  paymentRows: number;
  excludedVatRows: number;
};
export type PaymentSourceAuditRead = {
  summary: PaymentSourceAudit;
  paymentRows: number;
  reviews: Map<string, PaymentSourceReview>;
};

export function sourceAuditIdentity(identity: PaymentIdentity): string {
  return JSON.stringify([
    identity.customerCode,
    identity.unitCode,
    identity.currency,
  ]);
}

function invalidAudit(): never {
  throw new ServiceUnavailableException({
    code: 'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID',
    message:
      'Logo ödeme kaynağının çoğalma, iptal veya veri bütünlüğü denetimi geçilemedi. Tutarlar gösterilmedi.',
  });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidAudit();
  return value as Record<string, unknown>;
}
function parse(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > 8_000_000) invalidAudit();
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalidAudit();
  }
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    invalidAudit();
  return value;
}
function code(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalidAudit();
  return value;
}
function flag(value: unknown): boolean {
  if (value !== 0 && value !== 1) invalidAudit();
  return value === 1;
}
function checkedSummary(value: unknown): AuditSummary {
  const summary = record(value);
  for (const field of [
    'multipleStockLines',
    'multipleReceiptMatches',
    'cancelledInvoices',
    'cancelledStockLines',
    'invalidSigns',
    'invalidInvoiceLinks',
    'unknownCurrencies',
    'nullAmounts',
    'missingIdentities',
  ]) {
    if (count(summary[field]) !== 0) invalidAudit();
  }
  const excludedVatRows = count(summary.excludedVatRows);
  if (excludedVatRows > 25_000) invalidAudit();
  return { paymentRows: count(summary.paymentRows), excludedVatRows };
}

/** Unknown/unreadable audits never claim success. Review balances remain outside financial totals. */
export async function readPaymentSourceAudit(
  database: Pick<LogoDatabaseService, 'query'>,
): Promise<PaymentSourceAuditRead> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await database.query(PAYMENT_SOURCE_AUDIT_QUERY);
  } catch {
    throw new ServiceUnavailableException({
      code: 'PAYMENT_TRACKING_SOURCE_AUDIT_UNAVAILABLE',
      message:
        'Logo ödeme kaynağının güvenlik denetimi şu anda okunamıyor. Yeni tutarlar doğrulanamadı.',
    });
  }
  if (!Array.isArray(rows) || rows.length !== 1) invalidAudit();
  const result = record(rows[0]);
  const summary = checkedSummary(parse(result.summary));
  const candidates = parse(result.reviews);
  if (
    !Array.isArray(candidates) ||
    candidates.length !== summary.excludedVatRows ||
    candidates.length > 25_000
  )
    invalidAudit();
  const reviews = new Map<string, PaymentSourceReview>();
  for (const candidate of candidates) {
    const row = record(candidate);
    const original: PaymentIdentity = {
      customerCode: code(row.customerCode),
      unitCode: code(row.unitCode),
      currency: code(row.currency),
    };
    const selected: PaymentIdentity = {
      customerCode: code(row.selectedCustomerCode),
      unitCode: code(row.selectedUnitCode),
      currency: code(row.selectedCurrency),
    };
    if (
      !['TL', 'USD', 'GBP', 'EUR'].includes(original.currency!) ||
      !['TL', 'USD', 'GBP', 'EUR'].includes(selected.currency!) ||
      typeof row.excludedOutstanding !== 'number' ||
      !Number.isFinite(row.excludedOutstanding) ||
      row.excludedOutstanding <= 0
    )
      invalidAudit();
    const hasReturnLink = flag(row.hasReturnLink);
    const hasCustomerChange = flag(row.hasCustomerChange);
    if (hasCustomerChange !== (original.customerCode !== selected.customerCode))
      invalidAudit();
    for (const key of new Set([
      sourceAuditIdentity(original),
      sourceAuditIdentity(selected),
    ])) {
      const review = reviews.get(key) ?? {
        status: 'review_required' as const,
        vat: [],
      };
      const existing = review.vat.find(
        (item) =>
          item.currency === original.currency &&
          item.hasReturnLink === hasReturnLink &&
          item.hasCustomerChange === hasCustomerChange,
      );
      if (existing) {
        existing.excludedRows += 1;
        existing.excludedOutstanding =
          (existing.excludedOutstanding ?? 0) + row.excludedOutstanding;
        if (!Number.isFinite(existing.excludedOutstanding)) invalidAudit();
      } else {
        review.vat.push({
          currency: original.currency,
          excludedRows: 1,
          excludedOutstanding: row.excludedOutstanding,
          hasReturnLink,
          hasCustomerChange,
        });
      }
      reviews.set(key, review);
    }
  }
  return {
    paymentRows: summary.paymentRows,
    summary: {
      status: candidates.length ? 'review_required' : 'verified',
      checkedAt: new Date().toISOString(),
      financialChecks: 'passed',
      reviewCaseCount: 0,
      excludedVatRows: summary.excludedVatRows,
    },
    reviews,
  };
}
