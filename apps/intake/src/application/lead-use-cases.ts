import { Lead, type SubmitLeadInput } from '../domain/lead.ts';
import {
  DuplicateSubmissionError,
  OpenLeadExistsError,
  type LeadRepository,
  type SaveOptions,
} from '../domain/lead-repository.ts';
import type { IncomingReply, MissingDocument, ReplyOutcome } from '../domain/model.ts';
import type {
  AppLogger,
  ChaseGateway,
  Clock,
  IdGenerator,
  LeadTimeline,
  NoticeGateway,
  PrequalGateway,
  PrequalRequest,
  RecordedLeadEvent,
  RequestContext,
} from './ports.ts';

export interface LeadUseCaseDeps {
  leads: LeadRepository;
  timeline: LeadTimeline;
  prequal: PrequalGateway;
  chases: ChaseGateway;
  notices: NoticeGateway;
  clock: Clock;
  ids: IdGenerator;
  /** The borrower's result page (offer details) for a Lead, linked from the Outcome Notice. */
  resultUrl: (leadId: string) => string;
}

export class LeadNotFoundError extends Error {
  constructor(leadId: string) {
    super(`Lead ${leadId} not found`);
    this.name = 'LeadNotFoundError';
  }
}

/** The same idempotency key came back with different quiz answers. */
export class IdempotencyKeyReusedError extends Error {
  readonly code = 'idempotency_key_reused';
  constructor() {
    super('This idempotency key was already used for a different submission');
    this.name = 'IdempotencyKeyReusedError';
  }
}

export interface LeadView {
  lead: Lead;
  events: RecordedLeadEvent[];
}

export interface SubmitResult extends LeadView {
  /** The submission repeated an earlier one; that Lead is returned and nothing new ran. */
  duplicate: boolean;
}

export interface SubmitOptions {
  /** Retries of one submission share it (Idempotency-Key header). */
  idempotencyKey?: string | undefined;
}

export type ReplyResult =
  | { outcome: ReplyOutcome; leadId: string }
  | { outcome: { accepted: false; reason: 'unknown_chase' }; leadId?: undefined };

export type LeadUseCases = ReturnType<typeof createLeadUseCases>;

/** A step still running after this long is considered stuck (the pipeline takes seconds). */
const STUCK_AFTER_MS = 2 * 60 * 1000;

/** Identical quiz answers within this window return the earlier Lead instead of a new one. */
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function createLeadUseCases(deps: LeadUseCaseDeps) {
  const { leads, timeline, prequal, chases, notices, clock, ids } = deps;

  /** Persist, then log each committed event so logs mirror lead_events. */
  async function save(lead: Lead, log: AppLogger, options?: SaveOptions) {
    const events = lead.pendingEvents();
    await leads.save(lead, options);
    for (const event of events) {
      // Failures log at error level so Better Stack alerts can fire on them.
      const level = event.type.endsWith('.failed') ? 'error' : 'info';
      log[level]({ lead_id: lead.id, event: event.type, ...event.payload }, event.type);
    }
  }

  const prequalRequest = (lead: Lead): PrequalRequest => {
    const s = lead.snapshot();
    return {
      leadId: lead.id,
      propertyState: s.property.state,
      estimatedValue: s.property.estimatedValue,
      mortgageBalance: s.property.mortgageBalance,
      creditBand: s.creditProfile.creditBand,
      incomeBand: s.creditProfile.incomeBand,
    };
  };

  /**
   * Drives a Lead through whatever steps it still needs (ADR-0002, ADR-0004). Saves after
   * every step, so a failure leaves the Lead at a known point that Replay can resume from.
   */
  async function advance(lead: Lead, context: RequestContext, log: AppLogger): Promise<Lead> {
    for (;;) {
      const step = lead.nextStep();
      if (step === 'done') return lead;

      if (step === 'prequalify') {
        lead.startPrequalification(clock.now());
        await save(lead, log);
        let result;
        try {
          result = await prequal.softPull(prequalRequest(lead), context);
        } catch (err) {
          lead.fail('prequalify', reasonOf(err), clock.now());
          await save(lead, log);
          return lead;
        }
        lead.recordDecision(result.decision, clock.now());
        await save(lead, log, { rawFigureResponse: result.rawResponse });
        continue;
      }

      if (step === 'chase') {
        if (!lead.chase) {
          lead.openChase(ids.newId(), clock.now());
          await save(lead, log);
        }
        try {
          const delivery = await chases.send(
            {
              chaseId: lead.chase!.id,
              leadId: lead.id,
              borrowerName: lead.borrower.name,
              borrowerEmail: lead.borrower.email,
              missingDocuments: missingDocumentsOf(lead),
            },
            context,
          );
          lead.markChaseSent(delivery, clock.now());
        } catch (err) {
          lead.markChaseFailed(reasonOf(err), clock.now());
        }
        await save(lead, log);
        if (lead.status === 'failed') return lead;
        continue;
      }

      if (step === 'review') {
        lead.startReview(clock.now());
        await save(lead, log);
        let result;
        try {
          result = await prequal.reviewDocuments(
            {
              ...prequalRequest(lead),
              documents: missingDocumentsOf(lead),
              attachments: lead.chase!.reply!.attachments.map(({ sha256: _, ...a }) => a),
            },
            context,
          );
        } catch (err) {
          lead.fail('review', reasonOf(err), clock.now());
          await save(lead, log);
          return lead;
        }
        lead.recordReview(result.decision, clock.now());
        await save(lead, log, { rawFigureResponse: result.rawResponse });
        continue;
      }

      // step === 'notify'
      if (!lead.notice) {
        lead.openNotice(ids.newId(), clock.now());
        await save(lead, log);
      }
      try {
        const delivery = await notices.sendNotice(
          {
            noticeId: lead.notice!.id,
            leadId: lead.id,
            borrowerName: lead.borrower.name,
            borrowerEmail: lead.borrower.email,
            outcome: lead.finalOutcome!,
            basis: lead.review ? 'document_review' : 'prequalification',
            resultUrl: deps.resultUrl(lead.id),
          },
          context,
        );
        lead.markNoticeSent(delivery, clock.now());
      } catch (err) {
        lead.markNoticeFailed(reasonOf(err), clock.now());
      }
      await save(lead, log);
      if (lead.status === 'failed') return lead;
    }
  }

  const view = async (lead: Lead): Promise<LeadView> => ({
    lead,
    events: await timeline.eventsFor(lead.id),
  });

  const load = async (leadId: string) => {
    const lead = await leads.findById(leadId);
    if (!lead) throw new LeadNotFoundError(leadId);
    return lead;
  };

  /** The Lead an earlier request with this idempotency key created, if any. */
  async function submittedWithKey(key: string, input: Omit<SubmitLeadInput, 'id'>) {
    const earlier = await leads.findByIdempotencyKey(key);
    if (earlier && !earlier.matchesSubmission(input)) throw new IdempotencyKeyReusedError();
    return earlier;
  }

  const duplicateOf = async (lead: Lead, log: AppLogger, why: string): Promise<SubmitResult> => {
    log.info({ event: 'lead.duplicate_submission', lead_id: lead.id, why }, 'duplicate submission');
    return { ...(await view(lead)), duplicate: true };
  };

  return {
    /**
     * A borrower submits the quiz (ADR-0007). A retry of the same request (same idempotency
     * key) or the same answers again within 24 hours of a decision return the earlier Lead
     * and send nothing. Otherwise a new Lead is created — unless the email already has an
     * Open Lead (OpenLeadExistsError) — and advanced.
     */
    async submitLead(
      input: Omit<SubmitLeadInput, 'id'>,
      context: RequestContext,
      log: AppLogger,
      { idempotencyKey }: SubmitOptions = {},
    ): Promise<SubmitResult> {
      if (idempotencyKey) {
        const earlier = await submittedWithKey(idempotencyKey, input);
        if (earlier) return duplicateOf(earlier, log, 'idempotency_key');
      }
      const since = new Date(clock.now().getTime() - DUPLICATE_WINDOW_MS);
      const recent = await leads.recentForEmail(input.borrower.email, since);
      const repeated = recent.find((l) => !l.isOpen && l.matchesSubmission(input));
      if (repeated) return duplicateOf(repeated, log, 'same_answers');

      const lead = Lead.submit({ ...input, id: ids.newId() }, clock.now());
      try {
        await save(lead, log, { idempotencyKey });
      } catch (err) {
        // A concurrent retry of this same request won the race: answer with its Lead.
        const raced =
          (err instanceof OpenLeadExistsError || err instanceof DuplicateSubmissionError) &&
          idempotencyKey &&
          (await submittedWithKey(idempotencyKey, input));
        if (raced) return duplicateOf(raced, log, 'idempotency_key');
        if (err instanceof OpenLeadExistsError) {
          log.info({ event: 'lead.refused', reason: err.code }, 'email has an open application');
        }
        throw err;
      }
      return { ...(await view(await advance(lead, context, log))), duplicate: false };
    },

    async replayLead(leadId: string, context: RequestContext, log: AppLogger): Promise<LeadView> {
      const lead = await load(leadId);
      lead.replay(clock.now());
      await save(lead, log);
      return view(await advance(lead, context, log));
    },

    /**
     * The borrower answered a Chase. Records whether the reply is accepted; the Lead's
     * next steps (review, notice) run separately via `continueLead`, so the mail adapter
     * gets a fast answer.
     */
    async receiveChaseReply(
      chaseId: string,
      reply: IncomingReply,
      log: AppLogger,
    ): Promise<ReplyResult> {
      const lead = await leads.findByChaseId(chaseId);
      if (!lead) return { outcome: { accepted: false, reason: 'unknown_chase' } };
      const outcome = lead.receiveReply(reply, clock.now());
      if (lead.pendingEvents().length > 0) await save(lead, log);
      return { outcome, leadId: lead.id };
    },

    /** Runs whatever steps a Lead still needs, without recording a Replay. */
    async continueLead(leadId: string, context: RequestContext, log: AppLogger): Promise<LeadView> {
      return view(await advance(await load(leadId), context, log));
    },

    async getLead(leadId: string): Promise<LeadView> {
      return view(await load(leadId));
    },

    /** Operator view: failed or stuck Leads, each with its timeline (for failed_step / error). */
    async leadsNeedingAttention(limit = 50): Promise<LeadView[]> {
      const stuckBefore = new Date(clock.now().getTime() - STUCK_AFTER_MS);
      const ids = await timeline.needingAttention(stuckBefore, limit);
      const leadsFound = await Promise.all(ids.map((id) => leads.findById(id)));
      return Promise.all(leadsFound.filter((l): l is Lead => !!l).map(view));
    },
  };
}

function missingDocumentsOf(lead: Lead): MissingDocument[] {
  const { decision } = lead;
  return decision?.outcome === 'need_more_documents' ? decision.missingDocuments : [];
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
