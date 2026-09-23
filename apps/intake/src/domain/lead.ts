import {
  DomainError,
  type Borrower,
  type Chase,
  type ChaseDelivery,
  type CreditProfile,
  type IncomingReply,
  type LeadEvent,
  type LeadEventType,
  type LeadStatus,
  type NextStep,
  type NoticeDelivery,
  type OutcomeNotice,
  type PrequalDecision,
  type Property,
  type ReplyOutcome,
  type ReviewDecision,
  type Step,
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
  /** Figure's Document Review, once the borrower's documents are in. */
  review?: ReviewDecision | undefined;
  notice?: OutcomeNotice | undefined;
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
 * Aggregate root of Lead Intake. Owns its single Prequal Decision, its single Chase, and —
 * after the borrower replies with documents — its single Document Review and Outcome
 * Notice (ADR-0003, ADR-0004). Every state change goes through a command that checks its
 * precondition and records a Lead Event.
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
  get review() {
    return this.#state.review;
  }
  get notice() {
    return this.#state.notice;
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
    const { decision, chase, review, notice } = this.#state;
    if (!decision) return 'prequalify';
    if (decision.outcome !== 'need_more_documents') return 'done';
    if (chase?.status !== 'sent') return 'chase';
    if (!chase.reply) return 'done'; // waiting for the borrower's documents
    if (!review) return 'review';
    if (notice?.status !== 'sent') return 'notify';
    return 'done';
  }

  /**
   * An email arrived at this Lead's Chase Reply Address. Accepted only if the Chase was
   * sent, the receiving server verified the sender (DMARC pass), the sender is the
   * borrower, and documents are attached. A redelivery of the accepted email is a no-op.
   */
  receiveReply(reply: IncomingReply, now: Date): ReplyOutcome {
    const { chase } = this.#state;
    const reject = (reason: Exclude<ReplyOutcome, { accepted: true }>['reason']) => {
      this.#record(
        'documents.rejected',
        {
          chase_id: chase?.id,
          reason,
          from_domain: reply.from.split('@')[1] ?? '',
          attachments: reply.attachments.length,
        },
        now,
      );
      return { accepted: false, reason } as const;
    };

    if (!chase || chase.status !== 'sent') return reject('chase_not_sent');
    if (chase.reply) {
      if (chase.reply.messageId === reply.messageId) return { accepted: true, duplicate: true };
      return reject('already_received');
    }
    if (reply.dmarc !== 'pass') return reject('not_authenticated');
    if (reply.from.trim().toLowerCase() !== this.#state.borrower.email.trim().toLowerCase()) {
      return reject('sender_mismatch');
    }
    if (reply.attachments.length === 0) return reject('no_attachments');

    chase.reply = {
      messageId: reply.messageId,
      receivedAt: reply.receivedAt,
      from: reply.from,
      attachments: reply.attachments,
    };
    this.#transition('documents_received', now);
    this.#record(
      'documents.received',
      {
        chase_id: chase.id,
        attachments: reply.attachments.length,
        content_types: [...new Set(reply.attachments.map((a) => a.contentType))],
      },
      now,
    );
    return { accepted: true, duplicate: false };
  }

  startReview(now: Date): void {
    if (this.nextStep() !== 'review') {
      throw new DomainError('review_not_due', 'A Document Review needs accepted documents');
    }
    this.#transition('documents_received', now);
    this.#record('figure.review_requested', {}, now);
  }

  recordReview(review: ReviewDecision, now: Date): void {
    if (this.nextStep() !== 'review') {
      throw new DomainError('review_not_due', 'A Document Review is recorded once');
    }
    this.#state.review = review;
    this.#transition(review.outcome, now);
    this.#record(
      review.outcome === 'approved' ? 'figure.review_approved' : 'figure.review_rejected',
      review.outcome === 'approved'
        ? { amount: review.offer.amount, apr_min: review.offer.aprMin }
        : { reason: review.reason },
      now,
    );
  }

  openNotice(noticeId: string, now: Date): void {
    if (this.nextStep() !== 'notify') {
      throw new DomainError('notice_not_due', 'An Outcome Notice follows a Document Review');
    }
    if (this.#state.notice) throw new DomainError('notice_exists', 'A Lead has one Outcome Notice');
    this.#state.notice = { id: noticeId, status: 'pending' };
    this.#state.updatedAt = now;
    this.#record('notice.created', { notice_id: noticeId }, now);
  }

  markNoticeSent(delivery: NoticeDelivery, now: Date): void {
    const notice = this.#requireUnsentNotice();
    Object.assign(notice, { ...delivery, status: 'sent', lastError: undefined });
    // Back to the review's outcome if an earlier attempt had failed the Lead.
    this.#transition(this.#state.review!.outcome, now);
    this.#record(
      'notice.sent',
      { notice_id: notice.id, email_message_id: delivery.emailMessageId },
      now,
    );
  }

  markNoticeFailed(reason: string, now: Date): void {
    const notice = this.#requireUnsentNotice();
    notice.status = 'failed';
    notice.lastError = reason;
    this.#record('notice.failed', { notice_id: notice.id, reason }, now);
    this.#fail('notify', reason, now);
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
  fail(step: Step, reason: string, now: Date): void {
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

  #requireUnsentNotice(): OutcomeNotice {
    const { notice } = this.#state;
    if (!notice) throw new DomainError('no_notice', 'Lead has no Outcome Notice');
    if (notice.status === 'sent') throw new DomainError('notice_sent', 'Notice was already sent');
    return notice;
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
