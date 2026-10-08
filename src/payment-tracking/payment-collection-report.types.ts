import type {
  PaymentFilterOption,
  PaymentInvoiceOk,
  PaymentKindFilter,
  PaymentProjectGroup,
  PaymentProjectGroupFilter,
  PaymentSourceSnapshot,
} from './payment-tracking.types';

/** Current allocations to the due dates currently recorded in LOGO, not dated cash receipts. */
export interface CollectionTotals {
  scheduled: number | null;
  paidToDate: number | null;
  outstanding: number | null;
  overdue: number | null;
  caseCount: number;
  installmentCount: number;
  incompleteRows: number;
}

/** Paid/settled allocations divided by scheduled value; never a cash receipt rate. */
export interface CollectionPerformanceTotals extends CollectionTotals {
  completionPercent: number | null;
}

export type CollectionRepresentativeState = '' | 'unassigned' | 'multiple';
export type CollectionAgingKey = '1_30' | '31_60' | '61_90' | '90_plus';
export type CollectionDetailScope = 'month' | 'overdue' | 'period' | 'undated';

/** A case may have installments in several buckets; caseCount is distinct within each bucket. */
export interface CollectionAgingBucket extends CollectionTotals {
  key: CollectionAgingKey;
}

export interface CollectionBreakdown {
  period: CollectionPerformanceTotals;
  overdue: CollectionTotals;
  nextMonth: CollectionTotals;
  monthly: Array<CollectionPerformanceTotals & { month: string }>;
}

export interface CollectionProjectBreakdown extends CollectionBreakdown {
  projectGroup: PaymentProjectGroup;
}

/** Every case belongs to exactly one bucket, even when it names several representatives. */
export interface CollectionRepresentativeBreakdown extends CollectionBreakdown {
  key: string;
  representative: string | null;
  representativeState: 'single' | 'multiple' | 'unassigned';
}

export interface CollectionCaseMonth {
  key: string;
  customerCode: string | null;
  customerName: string;
  unitCode: string | null;
  unitName: string;
  currency: string | null;
  projectGroup: PaymentProjectGroup;
  representatives: string[];
  invoiceOk?: PaymentInvoiceOk;
  earliestDueDate: string | null;
  lastDueDate: string | null;
  totals: CollectionTotals;
}

/** Exact source customer-code groups, not a count of unique people. */
export interface CollectionOverdueConcentration {
  complete: boolean;
  customerGroupCount: number | null;
  top20GroupCount: number | null;
  top20Outstanding: number | null;
  top20SharePercent: number | null;
}

export interface CollectionProjectInsight {
  projectGroup: PaymentProjectGroup;
  overdueOutstanding: number | null;
  nextMonthOutstanding: number | null;
  overdueSharePercent: number | null;
  nextMonthSharePercent: number | null;
}

export interface PaymentCollectionReport {
  analyticsVersion: 1;
  source: Omit<PaymentSourceSnapshot, 'cases'>;
  /** Legacy token: current LOGO due dates, excluding local follow-up deferrals. */
  basis: 'original';
  selectedCurrency: string | null;
  currencyMode: 'single' | 'all';
  selectedPaymentKind: PaymentKindFilter;
  selectedProjectGroup: PaymentProjectGroupFilter;
  selectedRepresentative: string;
  selectedRepresentativeState: CollectionRepresentativeState;
  selectedAuthorizationState: string;
  selectedInvoiceOk: string;
  invoiceOkOptions: PaymentFilterOption[];
  startMonth: string;
  months: number;
  nextMonth: string;
  periods: string[];
  historicalPeriods: string[];
  currencies: Array<{
    value: string | null;
    label: string;
    recordCount: number;
  }>;
  projectGroups: PaymentFilterOption[];
  representatives: PaymentFilterOption[];
  byCurrency: Array<{
    currency: string | null;
    summary: CollectionTotals;
    period: CollectionPerformanceTotals;
    overdue: CollectionTotals;
    aging: CollectionAgingBucket[];
    currentMonthRemaining: CollectionTotals;
    nextMonth: CollectionTotals;
    overdueConcentration: CollectionOverdueConcentration;
    projectInsights: CollectionProjectInsight[];
    projectBreakdown: CollectionProjectBreakdown[];
    representativeBreakdown: CollectionRepresentativeBreakdown[];
    undated: CollectionTotals;
    beforeWindow: CollectionTotals;
    afterWindow: CollectionTotals;
    monthly: Array<CollectionPerformanceTotals & { month: string }>;
    historical: Array<CollectionPerformanceTotals & { month: string }>;
  }>;
  detail: {
    scope: CollectionDetailScope;
    agingBucket: CollectionAgingKey | '';
    month: string;
    rows: CollectionCaseMonth[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
