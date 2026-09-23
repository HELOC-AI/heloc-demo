import type { Lead } from './lead.ts';
import { DomainError } from './model.ts';

export interface SaveOptions {
  /** Figure's verbatim response, kept for audit next to the decision or review it produced. */
  rawFigureResponse?: unknown;
}

export interface LeadRepository {
  findById(id: string): Promise<Lead | undefined>;
  /** The Lead owning the Chase a borrower replied to. */
  findByChaseId(chaseId: string): Promise<Lead | undefined>;
  /**
   * Persists the Lead and its pending events in one transaction, then marks it persisted.
   * Throws ConcurrencyError if someone else saved the Lead since it was loaded.
   */
  save(lead: Lead, options?: SaveOptions): Promise<void>;
}

export class ConcurrencyError extends DomainError {
  constructor(leadId: string) {
    super('concurrent_update', `Lead ${leadId} was modified concurrently; reload and retry`);
    this.name = 'ConcurrencyError';
  }
}
