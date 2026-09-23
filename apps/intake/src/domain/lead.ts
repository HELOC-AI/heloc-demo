import {
  DomainError,
  type Borrower,
  type Chase,
  type ChaseDelivery,
  type CreditProfile,
  type LeadEvent,
  type LeadEventType,
  type LeadStatus,
  type NextStep,
  type PrequalDecision,
  type Property,
} from './model.ts';

export interface LeadSnapshot {
  id: string;
  status: LeadStatus;
  borrower: Borrower;
  property: Property;
  creditProfile: CreditProfile;
  purpose: string;
  decision?: PrequalDecision | undefined;
  chase?: Chase | undefined;
  createdAt: Date;
  updatedAt: Date;
  /** Optimistic-concurrency version; 0 until first persisted. */
  version: number;
}

export interface SubmitLeadInput {
  id: string;
  borrower: Borrower;
  property: Property;
  creditProfile: CreditProfile;
  purpose: string;
}

/**
 * Aggregate root of Lead Intake. Owns its single Prequal Decision and its single Chase
 * (ADR-0003); every state change goes through a command that checks its precondition
 * and records a Lead Event.
 */
export class Lead {
  #state: LeadSnapshot;
  #pending: LeadEvent[] = [];

  private constructor(state: LeadSnapshot) {
    this.#state = state;
  }

  static submit(input: SubmitLeadInput, now: Date): Lead {
    assertValidSubmission(input);
    const lead = new Lead({
      ...input,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
      version: 0,
    });
    lead.#record('lead.created', {}, now);
    return lead;
  }

  static rehydrate(snapshot: LeadSnapshot): Lead {
    return new Lead(structuredClone(snapshot));
  }

  get id() {
    return this.#state.id;
  }
  get status() {
    return this.#state.status;
  }
  get decision() {
    return this.#state.decision;
  }
  get chase() {
    return this.#state.chase;
  }
  get borrower() {
    return this.#state.borrower;
  }
  get version() {
    return this.#state.version;
  }

  snapshot(): LeadSnapshot {
    return structuredClone(this.#state);
  }

  /** Events recorded since the Lead was loaded or last persisted. */
  pendingEvents(): readonly LeadEvent[] {
    return [...this.#pending];
  }

  /** Called by the repository once state and events are committed. */
  markPersisted(): void {
    this.#state.version += 1;
    this.#pending = [];
  }

  nextStep(): NextStep {
    const { decision, chase } = this.#state;
    if (!decision) return 'prequalify';
    if (decision.outcome === 'need_more_documents' && chase?.status !== 'sent') return 'chase';
    return 'done';
  }

  startPrequalification(now: Date): void {
    if (this.#state.decision) {
      throw new DomainError('decision_exists', 'Lead already has a Prequal Decision');
    }
    this.#transition('processing', now);
    this.#record('figure.requested', {}, now);
  }

  recordDecision(decision: PrequalDecision, now: Date): void {
    if (this.#state.decision) {
      throw new DomainError('decision_exists', 'A Prequal Decision never changes once recorded');
    }
    if (this.#state.status !== 'processing') {
      throw new DomainError('not_processing', 'Prequalification was not started');
    }
    this.#state.decision = decision;
    this.#transition(decision.outcome, now);
    this.#record(`figure.${decision.outcome}`, decisionSummary(decision), now);
  }

  openChase(chaseId: string, now: Date): void {
    if (this.#state.decision?.outcome !== 'need_more_documents') {
      throw new DomainError('chase_not_needed', 'Only a Need More Documents Lead is chased');
    }
    if (this.#state.chase) {
      throw new DomainError('chase_exists', 'A Lead has at most one Chase');
    }
    this.#state.chase = { id: chaseId, status: 'pending' };
    this.#state.updatedAt = now;
    this.#record('chase.created', { chase_id: chaseId }, now);
  }

  markChaseSent(delivery: ChaseDelivery, now: Date): void {
    const chase = this.#requireUnsentChase();
    Object.assign(chase, { ...delivery, status: 'sent', lastError: undefined });
    this.#transition('chase_sent', now);
    this.#record(
      'email.sent',
      { chase_id: chase.id, email_message_id: delivery.emailMessageId },
      now,
    );
  }

  markChaseFailed(reason: string, now: Date): void {
    const chase = this.#requireUnsentChase();
    chase.status = 'failed';
    chase.lastError = reason;
    this.#record('email.failed', { chase_id: chase.id, reason }, now);
    this.#fail('chase', reason, now);
  }

  /** A step could not complete (dependency down, timeout); Replay resumes from it. */
  fail(step: Exclude<NextStep, 'done'>, reason: string, now: Date): void {
    if (this.nextStep() === 'done') {
      throw new DomainError('already_complete', 'A completed Lead cannot fail');
    }
    this.#fail(step, reason, now);
  }

  replay(now: Date): void {
    this.#record(
      'lead.replayed',
      { from_status: this.#state.status, next_step: this.nextStep() },
      now,
    );
  }

  #fail(step: string, reason: string, now: Date) {
    this.#transition('failed', now);
    this.#record('lead.failed', { step, reason }, now);
  }

  #requireUnsentChase(): Chase {
    const { chase } = this.#state;
    if (!chase) throw new DomainError('no_chase', 'Lead has no Chase');
    if (chase.status === 'sent') throw new DomainError('chase_sent', 'Chase was already sent');
    return chase;
  }

  #transition(to: LeadStatus, now: Date) {
    this.#state.status = to;
    this.#state.updatedAt = now;
  }

  #record(type: LeadEventType, payload: Record<string, unknown>, now: Date) {
    this.#pending.push({ leadId: this.#state.id, type, payload, occurredAt: now });
  }
}

function decisionSummary(decision: PrequalDecision): Record<string, unknown> {
  switch (decision.outcome) {
    case 'approved':
      return { amount: decision.offer.amount, apr_min: decision.offer.aprMin };
    case 'rejected':
      return { reason: decision.reason };
    case 'need_more_documents':
      return { documents: decision.missingDocuments.map((d) => d.type) };
  }
}

function assertValidSubmission({ borrower, property, purpose }: SubmitLeadInput) {
  const invalid = (field: string, message: string) => {
    throw new DomainError('invalid_lead', `${field}: ${message}`);
  };
  if (!borrower.name.trim()) invalid('name', 'is required');
  if (!borrower.email.includes('@')) invalid('email', 'is not an email address');
  if (!Number.isFinite(property.estimatedValue) || property.estimatedValue <= 0) {
    invalid('estimated_home_value', 'must be greater than 0');
  }
  if (!Number.isFinite(property.mortgageBalance) || property.mortgageBalance < 0) {
    invalid('mortgage_balance', 'must not be negative');
  }
  if (!purpose) invalid('purpose', 'is required');
}
