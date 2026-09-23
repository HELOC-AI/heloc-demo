import type {
  ChaseDelivery,
  LeadEvent,
  MissingDocument,
  NoticeDelivery,
  PrequalDecision,
  ReviewDecision,
  SubmittedAttachment,
} from '../domain/model.ts';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  newId(): string;
}

/** Structural subset of the service logger, so application code stays framework-free. */
export interface AppLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Demo-only knobs for Prequalification; never interpreted by the domain. */
export interface PrequalScenario {
  forcedOutcome?: 'approved' | 'rejected' | 'need_more_documents' | undefined;
  fault?: 'timeout' | 'error' | 'exception' | undefined;
}

export interface RequestContext {
  requestId?: string | undefined;
  scenario?: PrequalScenario | undefined;
}

export interface PrequalRequest {
  leadId: string;
  propertyState: string;
  estimatedValue: number;
  mortgageBalance: number;
  creditBand: string;
  incomeBand: string;
}

export interface PrequalResult {
  decision: PrequalDecision;
  /** Figure's verbatim response, stored for audit. */
  rawResponse: unknown;
}

export interface ReviewRequest extends PrequalRequest {
  documents: MissingDocument[];
  attachments: Omit<SubmittedAttachment, 'sha256'>[];
}

export interface ReviewResult {
  decision: ReviewDecision;
  rawResponse: unknown;
}

/** Anti-corruption boundary to Prequalification (Figure). */
export interface PrequalGateway {
  softPull(request: PrequalRequest, context: RequestContext): Promise<PrequalResult>;
  reviewDocuments(request: ReviewRequest, context: RequestContext): Promise<ReviewResult>;
}

export interface ChaseRequest {
  chaseId: string;
  leadId: string;
  borrowerName: string;
  borrowerEmail: string;
  missingDocuments: MissingDocument[];
}

export interface ChaseGateway {
  send(request: ChaseRequest, context: RequestContext): Promise<ChaseDelivery>;
}

export interface NoticeRequest {
  noticeId: string;
  leadId: string;
  borrowerName: string;
  borrowerEmail: string;
  outcome: ReviewDecision;
  /** Link to the borrower's result page. */
  resultUrl: string;
}

/** Borrower Outreach, for the Outcome Notice. */
export interface NoticeGateway {
  sendNotice(request: NoticeRequest, context: RequestContext): Promise<NoticeDelivery>;
}

export interface RecordedLeadEvent extends LeadEvent {
  id: string;
}

export interface LeadTimeline {
  eventsFor(leadId: string): Promise<RecordedLeadEvent[]>;
  /**
   * Leads an operator should look at: `failed`, or stuck mid-pipeline (not updated since
   * `stuckBefore` while a step is still running). Newest first.
   */
  needingAttention(stuckBefore: Date, limit: number): Promise<string[]>;
}
