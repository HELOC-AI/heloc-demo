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

/** Idempotency key for delivering this Chase: resending the same Chase never sends twice. */
export const deliveryKey = (chase: Pick<Chase, 'chaseId'>) => `chase:${chase.chaseId}`;

export const firstName = (borrower: Borrower) => borrower.name.trim().split(/\s+/)[0] ?? '';
