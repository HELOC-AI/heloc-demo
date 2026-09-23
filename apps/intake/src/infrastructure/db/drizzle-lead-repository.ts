import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { LeadTimeline, RecordedLeadEvent } from '../../application/ports.ts';
import {
  ConcurrencyError,
  type LeadRepository,
  type SaveOptions,
} from '../../domain/lead-repository.ts';
import { Lead, type LeadSnapshot } from '../../domain/lead.ts';
import type {
  ChaseReply,
  LeadEventType,
  PrequalDecision,
  ReviewDecision,
} from '../../domain/model.ts';
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
    const [[lead], figure, [chase], [notice]] = await Promise.all([
      this.#db.select().from(schema.leads).where(eq(schema.leads.id, id)),
      this.#db.select().from(schema.figureDecisions).where(eq(schema.figureDecisions.leadId, id)),
      this.#db.select().from(schema.chases).where(eq(schema.chases.leadId, id)),
      this.#db.select().from(schema.outcomeNotices).where(eq(schema.outcomeNotices.leadId, id)),
    ]);
    if (!lead) return undefined;
    const decision = figure.find((f) => f.kind === 'soft_pull');
    const review = figure.find((f) => f.kind === 'document_review');

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
      decision: decision ? (reviveOffer(decision.decision) as PrequalDecision) : undefined,
      chase: chase
        ? {
            id: chase.id,
            status: chase.status,
            subject: chase.subject ?? undefined,
            body: chase.body ?? undefined,
            emailMessageId: chase.emailMessageId ?? undefined,
            replyTo: chase.replyTo ?? undefined,
            sentAt: chase.sentAt ?? undefined,
            lastError: chase.lastError ?? undefined,
            reply: chase.reply ? reviveReply(chase.reply) : undefined,
          }
        : undefined,
      review: review ? (reviveOffer(review.decision) as ReviewDecision) : undefined,
      notice: notice
        ? {
            id: notice.id,
            status: notice.status,
            subject: notice.subject ?? undefined,
            body: notice.body ?? undefined,
            emailMessageId: notice.emailMessageId ?? undefined,
            sentAt: notice.sentAt ?? undefined,
            lastError: notice.lastError ?? undefined,
          }
        : undefined,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      version: lead.version,
    };
    return Lead.rehydrate(snapshot);
  }

  async findByChaseId(chaseId: string): Promise<Lead | undefined> {
    if (!isUuid(chaseId)) return undefined;
    const [row] = await this.#db
      .select({ leadId: schema.chases.leadId })
      .from(schema.chases)
      .where(eq(schema.chases.id, chaseId));
    return row && this.findById(row.leadId);
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

      // Decisions never change: insert once per kind. Only the newly recorded one
      // actually inserts, so the raw Figure response lands on the right row.
      const figureRows = [
        s.decision && { kind: 'soft_pull', outcome: s.decision.outcome, decision: s.decision },
        s.review && { kind: 'document_review', outcome: s.review.outcome, decision: s.review },
      ].filter((row) => !!row);
      for (const row of figureRows) {
        await tx
          .insert(schema.figureDecisions)
          .values({
            leadId: s.id,
            kind: row.kind,
            status: row.outcome,
            decision: row.decision,
            rawResponse: options.rawFigureResponse ?? null,
          })
          .onConflictDoNothing({
            target: [schema.figureDecisions.leadId, schema.figureDecisions.kind],
          });
      }

      if (s.chase) {
        const chase = {
          status: s.chase.status,
          subject: s.chase.subject ?? null,
          body: s.chase.body ?? null,
          emailMessageId: s.chase.emailMessageId ?? null,
          replyTo: s.chase.replyTo ?? null,
          lastError: s.chase.lastError ?? null,
          reply: s.chase.reply ?? null,
          sentAt: s.chase.sentAt ?? null,
        };
        await tx
          .insert(schema.chases)
          .values({ ...chase, id: s.chase.id, leadId: s.id })
          .onConflictDoUpdate({ target: schema.chases.id, set: chase });
      }

      if (s.notice) {
        const notice = {
          status: s.notice.status,
          subject: s.notice.subject ?? null,
          body: s.notice.body ?? null,
          emailMessageId: s.notice.emailMessageId ?? null,
          lastError: s.notice.lastError ?? null,
          sentAt: s.notice.sentAt ?? null,
        };
        await tx
          .insert(schema.outcomeNotices)
          .values({ ...notice, id: s.notice.id, leadId: s.id })
          .onConflictDoUpdate({ target: schema.outcomeNotices.id, set: notice });
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

  async needingAttention(stuckBefore: Date, limit: number): Promise<string[]> {
    const rows = await this.#db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(
        or(
          eq(schema.leads.status, 'failed'),
          and(
            inArray(schema.leads.status, ['submitted', 'processing', 'documents_received']),
            lt(schema.leads.updatedAt, stuckBefore),
          ),
        ),
      )
      .orderBy(desc(schema.leads.updatedAt))
      .limit(limit);
    return rows.map((r) => r.id);
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

/** JSONB turns the Offer's Date into a string; restore it (decision or review). */
function reviveOffer(stored: unknown): PrequalDecision | ReviewDecision {
  const decision = stored as PrequalDecision | ReviewDecision;
  if (decision.outcome === 'approved') {
    return {
      ...decision,
      offer: { ...decision.offer, expiresAt: new Date(decision.offer.expiresAt) },
    };
  }
  return decision;
}

function reviveReply(stored: unknown): ChaseReply {
  const reply = stored as ChaseReply;
  return { ...reply, receivedAt: new Date(reply.receivedAt) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string) => UUID.test(id);
