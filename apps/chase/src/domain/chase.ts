/**
 * Borrower Outreach domain (see ../../CONTEXT.md): turns a Chase into a Chase Message.
 * Stateless — the Chase's lifecycle belongs to Lead Intake.
 */

export interface Borrower {
  name: string;
  email: string;
}

/** One line of the letter: a document the borrower recognises, and why it is needed. */
export interface DocumentRequest {
  label: string;
  reason: string;
}

export interface Chase {
  chaseId: string;
  leadId: string;
  borrower: Borrower;
  requests: DocumentRequest[];
  /** Where the borrower replies with the documents. */
  replyAddress: string;
}

export interface ChaseMessage {
  subject: string;
  text: string;
  html: string;
}

const LABELS: Record<string, string> = {
  income_verification: 'Proof of income',
  employment_verification: 'Proof of employment',
  mortgage_statement: 'Your most recent mortgage statement',
  property_valuation: 'A recent home appraisal or valuation',
  identity_verification: 'A government-issued photo ID',
};

/** `some_new_type` → "Some new type", so an unknown document type still reads sensibly. */
const humanize = (type: string) => type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function documentRequest(missing: { type: string; reason: string }): DocumentRequest {
  return { label: LABELS[missing.type] ?? humanize(missing.type), reason: missing.reason };
}

/** The Reply Address for a Chase: `reply@x` + id → `reply+<id>@x` (RFC 5233 subaddress). */
export function replyAddressFor(baseAddress: string, chaseId: string): string {
  const at = baseAddress.lastIndexOf('@');
  return `${baseAddress.slice(0, at)}+${chaseId}${baseAddress.slice(at)}`;
}

/** Idempotency key for delivering this Chase: resending the same Chase never sends twice. */
export const deliveryKey = (chase: Pick<Chase, 'chaseId'>) => `chase:${chase.chaseId}`;

export const firstName = (borrower: Borrower) => borrower.name.trim().split(/\s+/)[0] ?? '';

// Outcome Notice: the result of the Document Review, told to the borrower.

export interface NoticeOffer {
  lender: string;
  amount: number;
  aprMin: number;
  aprMax: number;
  termMonths: number;
  estimatedMonthlyPayment: number;
  expiresAt: Date;
}

export type RejectionReason = 'insufficient_home_equity' | 'credit_below_minimum';

export interface OutcomeNotice {
  noticeId: string;
  leadId: string;
  borrower: Borrower;
  outcome:
    { status: 'approved'; offer: NoticeOffer } | { status: 'rejected'; reason: RejectionReason };
  resultUrl: string;
}

export const noticeDeliveryKey = (notice: Pick<OutcomeNotice, 'noticeId'>) =>
  `notice:${notice.noticeId}`;

/** Borrower-facing explanation for each rejection reason. */
export const REJECTION_EXPLANATIONS: Record<RejectionReason, string> = {
  insufficient_home_equity:
    'the equity available in your home is below the minimum line we can offer',
  credit_below_minimum: 'the credit score range you shared is below our current minimum',
};
