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
  | 'documents_received'
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

export interface SubmittedAttachment {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
}

/** The borrower's accepted reply to a Chase, carrying the requested documents. */
export interface ChaseReply {
  messageId: string;
  receivedAt: Date;
  from: string;
  attachments: SubmittedAttachment[];
}

export interface Chase {
  id: string;
  status: ChaseStatus;
  subject?: string | undefined;
  body?: string | undefined;
  emailMessageId?: string | undefined;
  /** The Reply Address Borrower Outreach gave this Chase. */
  replyTo?: string | undefined;
  sentAt?: Date | undefined;
  lastError?: string | undefined;
  reply?: ChaseReply | undefined;
}

/** What the Chase recipient saw, as reported back by Borrower Outreach. */
export interface ChaseDelivery {
  subject: string;
  body: string;
  emailMessageId: string;
  replyTo: string;
  sentAt: Date;
}

/** An email claiming to be a Chase Reply, before the Lead decides to accept it. */
export interface IncomingReply {
  messageId: string;
  receivedAt: Date;
  from: string;
  /** The receiving mail server's DMARC verdict for the From domain. */
  dmarc: 'pass' | 'fail' | 'none' | 'unknown';
  attachments: SubmittedAttachment[];
}

export type ReplyRejection =
  | 'chase_not_sent'
  | 'already_received'
  | 'not_authenticated'
  | 'sender_mismatch'
  | 'no_attachments';

export type ReplyOutcome =
  { accepted: true; duplicate: boolean } | { accepted: false; reason: ReplyRejection };

/** An outcome that settles a Lead: Approved or Rejected. */
export type FinalOutcome =
  { outcome: 'approved'; offer: Offer } | { outcome: 'rejected'; reason: string };

/** Figure's final call on the submitted documents (resolves Need More Documents). */
export type ReviewDecision = FinalOutcome;

export type NoticeStatus = 'pending' | 'sent' | 'failed';

/** The email telling the borrower the final outcome: the soft pull's, or the Document Review's. */
export interface OutcomeNotice {
  id: string;
  status: NoticeStatus;
  subject?: string | undefined;
  body?: string | undefined;
  emailMessageId?: string | undefined;
  sentAt?: Date | undefined;
  lastError?: string | undefined;
}

export interface NoticeDelivery {
  subject: string;
  body: string;
  emailMessageId: string;
  sentAt: Date;
}

/**
 * The step a Lead needs next; derived from its decision, Chase, review and notice —
 * not from its status — so a `failed` Lead knows where Replay resumes.
 */
export type NextStep = 'prequalify' | 'chase' | 'review' | 'notify' | 'done';
export type Step = Exclude<NextStep, 'done'>;

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
  | 'email.failed'
  | 'documents.received'
  | 'documents.rejected'
  | 'figure.review_requested'
  | 'figure.review_approved'
  | 'figure.review_rejected'
  | 'notice.created'
  | 'notice.sent'
  | 'notice.failed';

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
