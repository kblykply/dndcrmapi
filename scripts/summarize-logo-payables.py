"""Offline, aggregate-only synthesis of the SELECT evidence; no DB access."""
from pathlib import Path
import json

base = Path(__file__).resolve().parents[2] / 'output/logo-management-research-2026-10-02'
stages = {name: json.loads((base / f'payables-{name}.json').read_text())
          for name in ['profile', 'obligations', 'instruments']}
evidence = {r['name']: r for stage in stages.values() for r in stage['results']}


def rows(name):
    return evidence[name]['rows']


def aggregate(items, keys, fields):
    result = {}
    for row in items:
        key = tuple(row[k] for k in keys)
        value = result.setdefault(key, {k: row[k] for k in keys} | {f: 0 for f in fields})
        for field in fields:
            value[field] += row[field]
    return list(result.values())


currencies = {0: 'TL', 1: 'USD', 11: 'CHF', 17: 'GBP', 20: 'EUR', 51: 'RUB'}
for name in ['purchase_due_months', 'checks_due_months', 'other_firms_purchase_schedules',
             'supplier_cari_balances', 'supplier_net_vs_open']:
    for row in rows(name):
        row['currency'] = currencies.get(row['TRCURR'], f"CODE_{row['TRCURR']}")

quality_fields = ['rows', 'noAllocationRows', 'partialRows', 'fullyAllocatedRows',
                  'linkedRows', 'incompleteRows', 'dueEqualsInvoiceDateRows']
quality = {field: sum(r[field] for r in rows('purchase_closing_quality')) for field in quality_fields}
quality['noAllocationPercent'] = 100 * quality['noAllocationRows'] / quality['rows']
profile = rows('paytrans_profile')
payment_quality = {field: sum(row[field] for row in profile)
                   for field in ['rows', 'incompleteRows', 'overpaidRows', 'negativeRows']}
payment_quality['cancelledRows'] = sum(row['rows'] for row in profile if row['CANCELLED'] != 0)
comparisons = []
for row in rows('supplier_net_vs_open'):
    cari = next(c for c in rows('supplier_cari_balances') if c['TRCURR'] == row['TRCURR'])
    comparisons.append({
        'currency': row['currency'],
        'rawUnallocatedPurchaseInvoiceAmount': row['openPurchase'],
        'positiveNetCreditCari': cari['positiveNetCredit'],
        'positiveNetCreditPaytrans': row['positiveNetCredit'],
        'bothDebitAndCreditOpenGroups': row['bothSidesOpenGroups'],
        'openPurchaseButNoNetDebtGroups': row['openPurchaseButNoNetDebtGroups'],
        'purchaseAmountWithoutNetDebt': row['purchaseAmountWithoutNetDebt'],
        'signedNetCreditCari': cari['signedNetCredit'],
        'signedNetCreditPaytrans': row['signedNetCredit'],
    })

result = {
    'status': 'READ_ONLY_RESEARCH_COMPLETE_NOT_CONFIRMED_PAYABLE_TOTALS',
    'readStartedAt': min(s['startedAt'] for s in stages.values()),
    'readFinishedAt': max(s['finishedAt'] for s in stages.values()),
    'asOf': stages['profile']['asOf'],
    'scope': {
        'database': 'LOGO_DND', 'mainFirm': 223, 'period': '01',
        'dateScope': 'All currently recorded rows in period01, not just2026.',
        'otherConfiguredFirms': [326, 426], 'excludedDemoFirm': 99,
        'firmNamesAndPeriodRangeEvidence': 'metadata.json (root live metadata)',
    },
    'execution': {
        'retainedQueryCount': sum(len(s['results']) for s in stages.values()),
        'allRetainedQueriesSucceeded': all('error' not in r for r in evidence.values()),
        'selectOnly': True, 'noNoLock': True, 'noDatabaseWrites': True,
        'isolation': rows('read_context')[0],
        'consistencyCaveat': 'Separate sequential SELECT statements, not one transaction snapshot. Concurrent edits may affect comparisons. sys.partitions row counts are approximate; grouped COUNT values are actual reads.',
        'privacy': 'No client names, full client codes, document numbers, bank accounts, raw source identities or credentials retained.',
    },
    'mainConclusionTr': 'Şirket ödeme vadeleri PAYTRANS.DATE_ ve çek/senet DUEDATE alanlarında bulunuyor. Ancak alış faturalarının kapama kaydı büyük ölçüde işlenmemiş: ham TOTAL-PAID şirketin kesin borcu veya kesin nakit çıkış takvimi değildir. Fatura kapaması, cari net bakiye ve çek durumu ayrı mutabakat gerektirir.',
    'tableSources': [
        {
            'table': 'LG_223_01_PAYTRANS',
            'purpose': 'Original due date, allocation/closure and source identity',
            'fields': ['LOGICALREF', 'CARDREF', 'DATE_', 'PROCDATE', 'MODULENR', 'TRCODE', 'SIGN', 'FICHEREF', 'TOTAL', 'PAID', 'CROSSREF', 'CANCELLED', 'TRCURR', 'MATCHDATE'],
            'limitations': 'No CLOSED column. PAID/CROSSREF express allocation; SIGN=1 alone also contains customer collections, returns and other transactions. Not actual bank-payment history.',
        },
        {
            'table': 'LG_223_01_INVOICE',
            'purpose': 'Purchase/service invoice classification and source documents',
            'validatedJoin': 'PAYTRANS.MODULENR=4 AND PAYTRANS.FICHEREF=INVOICE.LOGICALREF',
            'purchaseFilter': 'Both CANCELLED=0, PAYTRANS.SIGN=1, INVOICE.GRPCODE=1 AND INVOICE.TRCODE IN (1,4)',
            'date': 'INVOICE.DATE_ is document date; PAYTRANS.DATE_ is due date.',
        },
        {
            'table': 'LG_223_01_CLFLINE + LG_223_CLCARD',
            'purpose': 'Counterparty/currency net-balance reconciliation',
            'netControl': 'Sum SIGN1 credit minus SIGN0 debit separately per CLIENTREF+TRCURR; then positive account-level credit balances. Does not assign a due month.',
            'supplierScope': 'Cards with at least one noncancelled GRPCODE1/TRCODE1,4 purchase/service invoice, not a complete independently verified supplier register.',
            'observedOpenCreditCardTypes': sorted({r['CARDTYPE'] for r in rows('open_credit_card_types')}),
        },
        {
            'table': 'LG_223_01_CSCARD + CSTRANS + CSROLL',
            'purpose': 'Cheque/promissory-note DUEDATE, DOC and current status',
            'limitations': 'Actual CSCARD has no SIGN field. DOC3 only was observed. Source lifecycle/status must be verified, not inferred from overdue date alone.',
        },
        {
            'table': 'LG_223_01_BNFLINE',
            'purpose': 'Actual recorded bank movement and settlement control',
            'limitations': 'DATE_ is bank movement date, not supplier due date. Tested BNFLINE.CSTRANSREF to CSTRANS.LOGICALREF had no matches. Do not add bank paid amounts to obligations.',
        },
        {
            'table': 'LG_223_BNCREDITCARD + LG_223_BNCREPAYTR',
            'purpose': 'Possible bank-loan repayment calendar through CREDITREF/DUEDATE/TOTAL/interest/taxes',
            'limitations': 'Empty for firm223. This is not proof that the company has no loans.',
        },
    ],
    'currencySemantics': {
        'localCurrencyType': 160, 'label': 'TL',
        'paytransCurrency0': 'Firm local currency from L_CAPIFIRM.LOCALCTYP; all3 configured firms use160/TL.',
        'foreign': 'PAYTRANS.TOTAL matches linked INVOICE.TRNET in foreign-currency groups within0.02 per invoice. Do not divide by TRRATE again.',
        'noMixedTotals': 'Keep currencies and legal firms separate; any conversion requires an explicit dated rate policy.',
        'exception': 'One purchase invoice has invoiceCurrency20 but paymentCurrency0 and invoiceTRNET0; amountTL7772.16. Preserve source currency and flag for reconciliation.',
    },
    'quality': {'allPaytrans': payment_quality, 'purchaseInvoiceAllocations': quality,
                'purchaseTermMinimumDays': min(r['minimumTermDays'] for r in rows('purchase_closing_quality')),
                'purchaseTermMaximumDays': max(r['maximumTermDays'] for r in rows('purchase_closing_quality'))},
    'purchaseVsAccountControl': comparisons,
    'comparisonCaveat': 'Raw invoice-open and positive net-credit totals have different financial scopes. Their difference is NOT proof of cash paid: advances, returns, transfers, other invoices and currency/data effects can contribute.',
    'rawPurchaseInvoiceOpenByMonth': rows('purchase_due_months'),
    'rawPurchaseInvoiceOpenTotals': aggregate(rows('purchase_due_months'), ['currency'], ['rows', 'total', 'paid', 'openAmount', 'pastDueAmount']),
    'futureInvoiceCoverage': 'No firm223 open purchase/service invoice due months after2026-10 observed. This does not imply no future operating outflow: future invoices, wages, taxes, contracts and other commitments may not be present.',
    'cheques': {
        'status8': {'checks': 394, 'checksWithStatus8FromBankMovement': 394,
                    'control': 'Totals per currency equal L_223_BANKA_HAREKET label BANKA ÇEK ÖDEME.',
                    'linkLimit': 'Direct CSTRANSREF bank-document join returned no matches; lifecycle and aggregate evidence is not full document reconciliation.'},
        'status9': {'checks': 19, 'checksWithStatus9IssueMovement': 18,
                    'labelTr': 'Ödemesi beklenen çek adayı; son durum muhasebece teyit edilmeli.',
                    'missingHistoryLimit': 'Current aggregate evidence cannot identify the month/currency of the1 missing issue movement. It cannot prove future months are unaffected.',
                    'oldOutlier': {'dueMonth': '2025-04', 'currency': 'EUR', 'amount': 2163220, 'requiresReview': True}},
        'status6': {'checks': 1, 'currency': 'GBP', 'amount': 145000, 'dueMonth': '2025-03', 'requiresSeparateReview': True},
        'nonSettledStateDueMonths': rows('checks_due_months'),
        'doubleCountCaveat': 'A handed-over cheque can already offset the supplier balance but leave the bank later. Do not blindly add cheques to invoice open totals or supplier net balances.',
    },
    'bankCreditInventory': rows('bank_credit_inventory'),
    'otherFirmsRawPurchaseInvoiceOpenTotals': aggregate(rows('other_firms_purchase_schedules'), ['firm', 'currency'], ['rows', 'openAmount']),
    'views': {
        'L_223_ODEME_PLANI': 'Customer collection source; does not cover all supplier/company payables.',
        'L_223_SATINALMA_FAT': 'Procurement line analytics; ODEME_PLANI is a plan descriptor, not actual due/paid/open closure identity.',
        'L_223_CARI_HAREKET': 'Useful ledger presentation with SIGN/MODULENR/TRCODE/SOURCEFREF/IPTAL.',
        'L_223_CARI_DOKUM_2': 'Debit/credit due-date presentation lacks source row/document/closure identity; cannot independently establish true company payables.',
        'viewDefinitionAccess': 'Root live metadata confirms SELECT allowed, VIEW DEFINITION denied; exact hidden WHERE/JOIN definitions remain unverified.',
    },
    'dashboardProposalTr': {
        'firstStage': 'Salt okunur kontrol ekranı: alış/hizmet faturalarının vadesi, cari net bakiyeler, ödemesi beklenen çek adayları ve kapama uyuşmazlıkları ayrı; döviz/firma bazında.',
        'confirmedStage': 'Muhasebe örnekleriyle kapama ve çek yaşam döngüsü doğrulandıktan sonra mükerrerlikten arındırılmış aylık ödeme yükümlülüğü.',
        'usefulMetrics': ['Gelecek30/60/90gün teyitli ödeme yükümlülüğü', 'Açık fatura ile cari bakiye uyuşmazlığı', 'Gelecek ay çekleri ve eski statü anomalileri', 'Aynı dövizde tahsilat/ödeme takvimi farkı', 'Doğrulanmış tedarikçi yoğunlaşması'],
        'requiredValidation': ['Firma223/326/426 ve konsolidasyon sınırı', 'PAYTRANS kapama alışkanlığı ve kaynak belge bağlantıları', 'CARDTYPE3 dışında gerçek tedarikçi kapsamı', 'Fatura günüyle aynı yazılmış vadelerin ticari doğruluğu', '19çek/18çıkış ve eskiEUR2163220 anomalisi', 'Kur/avans/iade/virman etkileri ve banka/çek mükerrerliği', 'Boş kredi tablosundan borç yok sonucu çıkarmama', 'Logo cari ekstre ve çek portföyüyle muhasebe mutabakatı'],
    },
    'evidenceFiles': ['payables-profile.json', 'payables-obligations.json', 'payables-instruments.json', 'metadata.json'],
    'replayScript': 'api/scripts/research-logo-payables.ts',
    'offlineSynthesisScript': 'api/scripts/summarize-logo-payables.py',
    'productCodeChanged': False,
}
(base / 'payables-findings.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps({'status': result['status'], 'quality': quality, 'allPaytrans': payment_quality,
                  'retainedQueries': result['execution']['retainedQueryCount'],
                  'readStartedAt': result['readStartedAt'], 'readFinishedAt': result['readFinishedAt']}))
