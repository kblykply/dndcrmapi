import type { ProjectType } from '../common/projects';

export type PaymentProjectGroup = ProjectType | 'UNKNOWN';
export type PaymentProjectGroupFilter = PaymentProjectGroup | '';

export interface PaymentIdentity {
  customerCode: string | null;
  unitCode: string | null;
  currency: string | null;
}
export type PaymentKind =
  | 'sale'
  | 'land'
  | 'vat'
  | 'transformer'
  | 'furniture'
  | 'deposit'
  | 'other';
export type PaymentKindFilter = PaymentKind | 'all';
export type PaymentStatus =
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'paid'
  | 'unknown';
export interface PaymentInstallment {
  sequence: number;
  projectCode: string | null;
  paymentKind: PaymentKind;
  dueDate: string | null;
  amount: number | null;
  /** Current Logo allocation/closure amount, not cash received on the due date. */
  paid: number | null;
  outstanding: number | null;
  overdueDays: number;
  status: PaymentStatus;
}
export interface PaymentSourceReview {
  status: 'review_required';
  /** Excluded source candidates only; never add these amounts to receivable totals. */
  vat: Array<{
    currency: string | null;
    excludedRows: number;
    excludedOutstanding: number | null;
    hasReturnLink: boolean | null;
    hasCustomerChange: boolean | null;
  }>;
}
export interface PaymentSourceAudit {
  status: 'verified' | 'review_required';
  checkedAt: string;
  financialChecks: 'passed';
  reviewCaseCount: number;
  excludedVatRows: number;
}
/** Invoice special codes from LOGO_DND.L_223_FATURA_VADE.FAT_OK.
 * A case can cover multiple invoices; a mixed set is never a single-code amount.
 */
export interface PaymentInvoiceOk {
  status: 'matched' | 'unmatched' | 'unavailable';
  values: string[];
  hasBlank: boolean;
}
export interface PaymentSourceCase {
  key: string;
  identity: PaymentIdentity;
  customerName: string;
  unitName: string;
  customerNames: string[];
  unitNames: string[];
  projects: Array<{ code: string; name: string }>;
  representatives: string[];
  brokers: string[];
  invoiceDates: string[];
  invoiceOk?: PaymentInvoiceOk;
  authorization: {
    codes: string[];
    status: 'matched' | 'unmatched' | 'unavailable';
    hasBlank: boolean;
  };
  sourceReview?: PaymentSourceReview | null;
  installmentCount: number;
  incompleteRows: number;
  amount: number | null;
  paid: number | null;
  outstanding: number | null;
  overdueAmount: number | null;
  overdueCount: number;
  dueTodayAmount: number | null;
  oldestDueDate: string | null;
  nextDueDate: string | null;
  overdueDays: number;
  canTrack: boolean;
  trackingIssue: string | null;
  installments: PaymentInstallment[];
}
export interface PaymentSourceSnapshot {
  database: 'LOGO_DND';
  view: 'L_223_ODEME_PLANI';
  generatedAt: string;
  importedAt?: string | null;
  asOf: string;
  recordCount: number;
  cases: PaymentSourceCase[];
  audit?: PaymentSourceAudit;
  freshness?: {
    status: 'fresh' | 'refreshing' | 'stale';
    retryAfterMs: number | null;
    maxAgeSeconds: number;
  };
  authorizationSource: {
    view: 'L_223_FATURA_VADE';
    status: 'available' | 'unavailable';
    matchedCases: number;
    unmatchedCases: number;
    multipleCodeCases: number;
    message: string | null;
  };
}
export interface PaymentActor {
  id: string;
  name?: string;
  role: string;
}
export interface PaymentAssignee {
  id: string;
  name: string;
  role: string;
}
export interface PaymentTrackingState {
  key: string;
  sourceIdentity: PaymentIdentity;
  trackingDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  priority: 'normal' | 'high';
  version: number;
  updatedAt: string;
  updatedByName: string;
}
export interface PaymentTrackingEventDto {
  id: string;
  type: 'defer' | 'reset' | 'note' | 'assign' | 'priority' | 'contact';
  body: string;
  previousDate: string | null;
  nextDate: string | null;
  actorName: string;
  channel: 'email' | 'whatsapp' | 'phone' | null;
  createdAt: string;
}
export interface PaymentTrackingAction {
  type: PaymentTrackingEventDto['type'];
  expectedVersion: number;
  body: string;
  trackingDate?: string;
  assigneeId?: string | null;
  priority?: 'normal' | 'high';
  channel?: 'email' | 'whatsapp' | 'phone';
}
export interface PaymentTrackingRow extends Omit<
  PaymentSourceCase,
  'installments'
> {
  projectGroup: PaymentProjectGroup;
  fullyPaid: boolean;
  tracking: PaymentTrackingState | null;
  effectiveDueDate: string | null;
  trackingStatus:
    | 'overdue'
    | 'deferred'
    | 'today'
    | 'upcoming'
    | 'paid'
    | 'unknown';
  trackingOverdueDays: number;
}
export interface PaymentTrackingList {
  source: Omit<PaymentSourceSnapshot, 'cases'>;
  selectedCurrency: string | null;
  currencyMode: 'single' | 'all';
  currencyBreakdown: Array<{
    currency: string | null;
    total: number;
    summary: PaymentTrackingSummary;
    filteredSummary: PaymentTrackingSummary;
  }>;
  selectedPaymentKind: PaymentKindFilter;
  selectedProjectGroup: PaymentProjectGroupFilter;
  selectedInvoiceOk: string;
  invoiceOkOptions: PaymentFilterOption[];
  projectGroups: PaymentFilterOption[];
  currencies: Array<{
    value: string | null;
    label: string;
    recordCount: number;
  }>;
  projects: Array<{ code: string; name: string }>;
  assignees: PaymentAssignee[];
  filterOptions: {
    authorizationCodes: PaymentFilterOption[];
    representatives: PaymentFilterOption[];
    brokers: PaymentFilterOption[];
    customers: PaymentFilterOption[];
    units: PaymentFilterOption[];
  };
  summary: PaymentTrackingSummary;
  filteredSummary: PaymentTrackingSummary;
  orphanedTrackingCount: number;
  rows: PaymentTrackingRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface PaymentTrackingSummary {
  closedCount: number;
  openCount: number;
  outstanding: number | null;
  overdueCount: number;
  overdueAmount: number | null;
  actionableCount: number;
  actionableAmount: number | null;
  deferredCount: number;
  todayCount: number;
  unassignedCount: number;
  incompleteRows: number;
}
export interface PaymentFilterOption {
  value: string;
  label: string;
  caseCount: number;
}
export interface PaymentContact {
  email: string | null;
  phone: string | null;
  source: string | null;
  status: 'matched' | 'missing' | 'ambiguous' | 'unavailable';
}
export interface PaymentTrackingDetail {
  source: Omit<PaymentSourceSnapshot, 'cases'>;
  item: PaymentTrackingRow;
  installments: PaymentInstallment[];
  portfolio: {
    fullyPaid: boolean;
    cases: PaymentTrackingRow[];
    installments: Array<
      PaymentInstallment & { caseKey: string; currency: string | null }
    >;
  };
  contact: PaymentContact;
  history: PaymentTrackingEventDto[];
  historyHasMore: boolean;
  assignees: PaymentAssignee[];
}
