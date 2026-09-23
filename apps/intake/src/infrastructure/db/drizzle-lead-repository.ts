import { and, asc, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { LeadTimeline, RecordedLeadEvent } from '../../application/ports.ts';
import {
  ConcurrencyError,
  type LeadRepository,
  type SaveOptions,
} from '../../domain/lead-repository.ts';
import { Lead, type LeadSnapshot } from '../../domain/lead.ts';
import type { LeadEventType, PrequalDecision } from '../../domain/model.ts';
import * as schema from './schema.ts';

/** Works with both postgres-js (production) and PGlite (tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DrizzleLeadRepository implements LeadRepository, LeadTimeline {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async findById(id: string): Promise<Lead | undefined> {
    if (!isUuid(id)) return undefined;
    const [[lead], [decision], [chase]] = await Promise.all([
      this.#db.select().from(schema.leads).where(eq(schema.leads.id, id)),
      this.#db.select().from(schema.figureDecisions).where(eq(schema.figureDecisions.leadId, id)),
      this.#db.select().from(schema.chases).where(eq(schema.chases.leadId, id)),
    ]);
    if (!lead) return undefined;

    const snapshot: LeadSnapshot = {
      id: lead.id,
      status: lead.status,
      borrower: { name: lead.name, email: lead.email, phone: lead.phone },
      property: {
        state: lead.propertyState,
        estimatedValue: lead.estimatedHomeValue,
        mortgageBalance: lead.mortgageBalance,
      },
      creditProfile: { creditBand: lead.creditBand, incomeBand: lead.incomeBand },
      purpose: lead.purpose,
      decision: decision ? reviveDecision(decision.decision) : undefined,
      chase: chase
        ? {
            id: chase.id,
            status: chase.status,
            subject: chase.subject ?? undefined,
            body: chase.body ?? undefined,
            emailMessageId: chase.emailMessageId ?? undefined,
            sentAt: chase.sentAt ?? undefined,
            lastError: chase.lastError ?? undefined,
          }
        : undefined,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      version: lead.version,
    };
    return Lead.rehydrate(snapshot);
  }

  async save(lead: Lead, options: SaveOptions = {}): Promise<void> {
    const s = lead.snapshot();
    const events = lead.pendingEvents();
    const row = {
      name: s.borrower.name,
      email: s.borrower.email,
      phone: s.borrower.phone,
      propertyState: s.property.state,
      estimatedHomeValue: s.property.estimatedValue,
      mortgageBalance: s.property.mortgageBalance,
      creditBand: s.creditProfile.creditBand,
      incomeBand: s.creditProfile.incomeBand,
      purpose: s.purpose,
      status: s.status,
      updatedAt: s.updatedAt,
    };

    await this.#db.transaction(async (tx) => {
      if (s.version === 0) {
        const inserted = await tx
          .insert(schema.leads)
          .values({ ...row, id: s.id, version: 1, createdAt: s.createdAt })
          .onConflictDoNothing()
          .returning({ id: schema.leads.id });
        if (inserted.length === 0) throw new ConcurrencyError(s.id);
      } else {
        const updated = await tx
          .update(schema.leads)
          .set({ ...row, version: s.version + 1 })
          .where(and(eq(schema.leads.id, s.id), eq(schema.leads.version, s.version)))
          .returning({ id: schema.leads.id });
        if (updated.length === 0) throw new ConcurrencyError(s.id);
      }

      if (s.decision) {
        await tx
          .insert(schema.figureDecisions)
          .values({
            leadId: s.id,
            status: s.decision.outcome,
            decision: s.decision,
            rawResponse: options.rawPrequalResponse ?? null,
          })
          .onConflictDoNothing({ target: schema.figureDecisions.leadId });
      }

      if (s.chase) {
        const chase = {
          status: s.chase.status,
          subject: s.chase.subject ?? null,
          body: s.chase.body ?? null,
          emailMessageId: s.chase.emailMessageId ?? null,
          lastError: s.chase.lastError ?? null,
          sentAt: s.chase.sentAt ?? null,
        };
        await tx
          .insert(schema.chases)
          .values({ ...chase, id: s.chase.id, leadId: s.id })
          .onConflictDoUpdate({ target: schema.chases.id, set: chase });
      }

      if (events.length > 0) {
        await tx.insert(schema.leadEvents).values(
          events.map((e) => ({
            leadId: e.leadId,
            type: e.type,
            payload: e.payload,
            createdAt: e.occurredAt,
          })),
        );
      }
    });

    lead.markPersisted();
  }

  async eventsFor(leadId: string): Promise<RecordedLeadEvent[]> {
    if (!isUuid(leadId)) return [];
    const rows = await this.#db
      .select()
      .from(schema.leadEvents)
      .where(eq(schema.leadEvents.leadId, leadId))
      .orderBy(asc(schema.leadEvents.sequence));
    return rows.map((r) => ({
      id: r.id,
      leadId: r.leadId,
      type: r.type as LeadEventType,
      payload: r.payload as Record<string, unknown>,
      occurredAt: r.createdAt,
    }));
  }
}

/** JSONB turns the Offer's Date into a string; restore it. */
function reviveDecision(stored: unknown): PrequalDecision {
  const decision = stored as PrequalDecision;
  if (decision.outcome === 'approved') {
    return {
      ...decision,
      offer: { ...decision.offer, expiresAt: new Date(decision.offer.expiresAt) },
    };
  }
  return decision;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string) => UUID.test(id);
