import type { Lead } from './lead.ts';
import { DomainError } from './model.ts';

export interface SaveOptions {
  /** Figure's verbatim response, kept for audit next to the decision or review it produced. */
  rawFigureResponse?: unknown;
  /** The submitting request's idempotency key, stored with a new Lead. */
  idempotencyKey?: string | undefined;
}

export interface LeadRepository {
  findById(id: string): Promise<Lead | undefined>;
  /** The Lead owning the Chase a borrower replied to. */
  findByChaseId(chaseId: string): Promise<Lead | undefined>;
  /** The Lead first submitted with this idempotency key. */
  findByIdempotencyKey(key: string): Promise<Lead | undefined>;
  /** Leads submitted for this borrower email (case-insensitive) since `since`, newest first. */
  recentForEmail(email: string, since: Date): Promise<Lead[]>;
  /**
   * Persists the Lead and its pending events in one transaction, then marks it persisted.
   * Throws ConcurrencyError if someone else saved the Lead since it was loaded.
   * Inserting a new Lead throws OpenLeadExistsError if its borrower email already has an
   * Open Lead, and DuplicateSubmissionError if its idempotency key was already used; both
   * checks are atomic with the insert, so concurrent submissions cannot slip past them.
   */
  save(lead: Lead, options?: SaveOptions): Promise<void>;
}

export class ConcurrencyError extends DomainError {
  constructor(leadId: string) {
    super('concurrent_update', `Lead ${leadId} was modified concurrently; reload and retry`);
    this.name = 'ConcurrencyError';
  }
}

/** A borrower email has at most one Open Lead (ADR-0007). */
export class OpenLeadExistsError extends DomainError {
  constructor() {
    super('application_in_progress', 'An application for this email is already in progress');
    this.name = 'OpenLeadExistsError';
  }
}

/** Another Lead was already submitted with this idempotency key. */
export class DuplicateSubmissionError extends DomainError {
  constructor() {
    super('duplicate_submission', 'A Lead was already submitted with this idempotency key');
    this.name = 'DuplicateSubmissionError';
  }
}
