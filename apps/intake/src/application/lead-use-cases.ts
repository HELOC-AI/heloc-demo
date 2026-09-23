import { Lead, type SubmitLeadInput } from '../domain/lead.ts';
import type { LeadRepository, SaveOptions } from '../domain/lead-repository.ts';
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
  /** The borrower's result page for a Lead, linked from the Outcome Notice. */
  resultUrl: (leadId: string) => string;
}

export class LeadNotFoundError extends Error {
  constructor(leadId: string) {
    super(`Lead ${leadId} not found`);
    this.name = 'LeadNotFoundError';
  }
}

export interface LeadView {
  lead: Lead;
  events: RecordedLeadEvent[];
}

export type ReplyResult =
  | { outcome: ReplyOutcome; leadId: string }
  | { outcome: { accepted: false; reason: 'unknown_chase' }; leadId?: undefined };

export type LeadUseCases = ReturnType<typeof createLeadUseCases>;

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
            outcome: lead.review!,
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

  return {
    async submitLead(
      input: Omit<SubmitLeadInput, 'id'>,
      context: RequestContext,
      log: AppLogger,
    ): Promise<LeadView> {
      const lead = Lead.submit({ ...input, id: ids.newId() }, clock.now());
      await save(lead, log);
      return view(await advance(lead, context, log));
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
  };
}

function missingDocumentsOf(lead: Lead): MissingDocument[] {
  const { decision } = lead;
  return decision?.outcome === 'need_more_documents' ? decision.missingDocuments : [];
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
