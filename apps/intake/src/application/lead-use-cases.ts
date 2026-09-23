import { Lead, type SubmitLeadInput } from '../domain/lead.ts';
import type { LeadRepository, SaveOptions } from '../domain/lead-repository.ts';
import type { MissingDocument } from '../domain/model.ts';
import type {
  AppLogger,
  ChaseGateway,
  Clock,
  IdGenerator,
  LeadTimeline,
  PrequalGateway,
  RecordedLeadEvent,
  RequestContext,
} from './ports.ts';

export interface LeadUseCaseDeps {
  leads: LeadRepository;
  timeline: LeadTimeline;
  prequal: PrequalGateway;
  chases: ChaseGateway;
  clock: Clock;
  ids: IdGenerator;
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

export type LeadUseCases = ReturnType<typeof createLeadUseCases>;

export function createLeadUseCases({
  leads,
  timeline,
  prequal,
  chases,
  clock,
  ids,
}: LeadUseCaseDeps) {
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

  /**
   * Drives a Lead through whatever steps it still needs (ADR-0002). Saves after every
   * step, so a failure leaves the Lead at a known point that Replay can resume from.
   */
  async function advance(lead: Lead, context: RequestContext, log: AppLogger): Promise<Lead> {
    for (;;) {
      const step = lead.nextStep();
      if (step === 'done') return lead;

      if (step === 'prequalify') {
        lead.startPrequalification(clock.now());
        await save(lead, log);
        const snapshot = lead.snapshot();
        let result;
        try {
          result = await prequal.softPull(
            {
              leadId: lead.id,
              propertyState: snapshot.property.state,
              estimatedValue: snapshot.property.estimatedValue,
              mortgageBalance: snapshot.property.mortgageBalance,
              creditBand: snapshot.creditProfile.creditBand,
              incomeBand: snapshot.creditProfile.incomeBand,
            },
            context,
          );
        } catch (err) {
          lead.fail('prequalify', reasonOf(err), clock.now());
          await save(lead, log);
          return lead;
        }
        lead.recordDecision(result.decision, clock.now());
        await save(lead, log, { rawPrequalResponse: result.rawResponse });
        continue;
      }

      // step === 'chase'
      if (!lead.chase) {
        lead.openChase(ids.newId(), clock.now());
        await save(lead, log);
      }
      const chase = lead.chase!;
      try {
        const delivery = await chases.send(
          {
            chaseId: chase.id,
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
    }
  }

  const view = async (lead: Lead): Promise<LeadView> => ({
    lead,
    events: await timeline.eventsFor(lead.id),
  });

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
      const lead = await leads.findById(leadId);
      if (!lead) throw new LeadNotFoundError(leadId);
      lead.replay(clock.now());
      await save(lead, log);
      return view(await advance(lead, context, log));
    },

    async getLead(leadId: string): Promise<LeadView> {
      const lead = await leads.findById(leadId);
      if (!lead) throw new LeadNotFoundError(leadId);
      return view(lead);
    },
  };
}

function missingDocumentsOf(lead: Lead): MissingDocument[] {
  const { decision } = lead;
  return decision?.outcome === 'need_more_documents' ? decision.missingDocuments : [];
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
