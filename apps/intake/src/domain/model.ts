/**
 * Lead Intake value objects and events. Names follow ../../CONTEXT.md.
 * Pure TypeScript — no framework imports (enforced by ESLint).
 */

export type LeadStatus =
  | 'submitted'
  | 'processing'
  | 'approved'
  | 'rejected'
  | 'need_more_documents'
  | 'chase_sent'
  | 'failed';

export interface Borrower {
  name: string;
  email: string;
  phone: string;
}

export interface Property {
  state: string;
  estimatedValue: number;
  mortgageBalance: number;
}

export interface CreditProfile {
  creditBand: string;
  incomeBand: string;
}

export interface Offer {
  lender: string;
  amount: number;
  aprMin: number;
  aprMax: number;
  termMonths: number;
  estimatedMonthlyPayment: number;
  expiresAt: Date;
}

export interface MissingDocument {
  type: string;
  reason: string;
}

export type PrequalDecision =
  | { outcome: 'approved'; offer: Offer }
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'need_more_documents'; missingDocuments: MissingDocument[] };

export type ChaseStatus = 'pending' | 'sent' | 'failed';

export interface Chase {
  id: string;
  status: ChaseStatus;
  subject?: string | undefined;
  body?: string | undefined;
  emailMessageId?: string | undefined;
  sentAt?: Date | undefined;
  lastError?: string | undefined;
}

/** What the Chase recipient saw, as reported back by Borrower Outreach. */
export interface ChaseDelivery {
  subject: string;
  body: string;
  emailMessageId: string;
  sentAt: Date;
}

/** The step a Lead needs next; derived from its decision and Chase, not from its status. */
export type NextStep = 'prequalify' | 'chase' | 'done';

export type LeadEventType =
  | 'lead.created'
  | 'lead.replayed'
  | 'lead.failed'
  | 'figure.requested'
  | 'figure.approved'
  | 'figure.rejected'
  | 'figure.need_more_documents'
  | 'chase.created'
  | 'email.sent'
  | 'email.failed';

/** Payloads carry ids and outcomes only — never borrower PII. */
export interface LeadEvent {
  leadId: string;
  type: LeadEventType;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
