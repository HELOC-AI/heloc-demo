import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConcurrencyError,
  DuplicateSubmissionError,
  OpenLeadExistsError,
} from '../../domain/lead-repository.ts';
import { Lead } from '../../domain/lead.ts';
import type { PrequalDecision, ReviewDecision } from '../../domain/model.ts';
import { DrizzleLeadRepository, type Database } from './drizzle-lead-repository.ts';
import * as schema from './schema.ts';

const t0 = new Date('2026-09-23T00:00:00.000Z');
const LEAD_ID = '11111111-1111-4111-8111-111111111111';
const CHASE_ID = '22222222-2222-4222-8222-222222222222';

const approved: PrequalDecision = {
  outcome: 'approved',
  offer: {
    lender: 'Figure mock',
    amount: 150_000,
    aprMin: 7.5,
    aprMax: 9.5,
    termMonths: 120,
    estimatedMonthlyPayment: 1_780,
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
  },
};
const needDocs: PrequalDecision = {
  outcome: 'need_more_documents',
  missingDocuments: [{ type: 'income_verification', reason: 'Income requires verification' }],
};

let db: Database;
let repo: DrizzleLeadRepository;

beforeEach(async () => {
  const pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Database;
  await migrate(drizzle(pg), {
    migrationsFolder: new URL('../../../drizzle', import.meta.url).pathname,
  });
  repo = new DrizzleLeadRepository(db);
});

const newLead = (id = LEAD_ID, email = 'john@example.com') =>
  Lead.submit(
    {
      id,
      borrower: { name: 'John Doe', email, phone: '+14155551234' },
      property: { state: 'CA', estimatedValue: 800_000.5, mortgageBalance: 0 },
      creditProfile: { creditBand: '700-739', incomeBand: '150k-200k' },
      purpose: 'home_improvement',
    },
    t0,
  );

describe('DrizzleLeadRepository', () => {
  it('round-trips a new Lead exactly', async () => {
    const lead = newLead();
    await repo.save(lead);
    expect(lead.version).toBe(1);
    const loaded = await repo.findById(LEAD_ID);
    expect(loaded?.snapshot()).toEqual(lead.snapshot());
  });

  it('round-trips a decision (with its Offer date) and the raw Figure response', async () => {
    const lead = newLead();
    lead.startPrequalification(t0);
    lead.recordDecision(approved, t0);
    await repo.save(lead, {
      rawFigureResponse: { status: 'approved', offer: { amount: 150000 } },
    });

    const loaded = await repo.findById(LEAD_ID);
    expect(loaded?.decision).toEqual(approved);
    const [row] = await db.select().from(schema.figureDecisions);
    expect(row).toMatchObject({ status: 'approved', rawResponse: { status: 'approved' } });
  });

  it('persists the Chase through its lifecycle', async () => {
    const lead = newLead();
    lead.startPrequalification(t0);
    lead.recordDecision(needDocs, t0);
    lead.openChase(CHASE_ID, t0);
    await repo.save(lead);
    lead.markChaseFailed('email service unavailable', t0);
    await repo.save(lead);
    lead.markChaseSent(
      {
        subject: 'Docs needed',
        body: 'Hi John',
        emailMessageId: 'email_1',
        replyTo: `reply+${CHASE_ID}@linkerclaw.ai`,
        sentAt: t0,
      },
      t0,
    );
    await repo.save(lead);

    const loaded = await repo.findById(LEAD_ID);
    expect(loaded?.status).toBe('chase_sent');
    expect(loaded?.chase).toEqual({
      id: CHASE_ID,
      status: 'sent',
      subject: 'Docs needed',
      body: 'Hi John',
      emailMessageId: 'email_1',
      replyTo: `reply+${CHASE_ID}@linkerclaw.ai`,
      sentAt: t0,
      lastError: undefined,
      reply: undefined,
    });
    expect(await db.select().from(schema.chases)).toHaveLength(1);
    expect(await db.select().from(schema.figureDecisions)).toHaveLength(1);
  });

  it('records events in order, including those saved in the same instant', async () => {
    const lead = newLead();
    lead.startPrequalification(t0);
    lead.recordDecision(needDocs, t0);
    await repo.save(lead);
    const events = await repo.eventsFor(LEAD_ID);
    expect(events.map((e) => e.type)).toEqual([
      'lead.created',
      'figure.requested',
      'figure.need_more_documents',
    ]);
    expect(events[2]?.payload).toEqual({ documents: ['income_verification'] });
  });

  it('rejects a stale copy (optimistic concurrency)', async () => {
    const lead = newLead();
    await repo.save(lead);
    const a = (await repo.findById(LEAD_ID))!;
    const b = (await repo.findById(LEAD_ID))!;
    a.replay(t0);
    await repo.save(a);
    b.replay(t0);
    await expect(repo.save(b)).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await repo.eventsFor(LEAD_ID)).filter((e) => e.type === 'lead.replayed')).toHaveLength(
      1,
    );
  });

  it('rejects creating the same Lead twice', async () => {
    await repo.save(newLead());
    await expect(repo.save(newLead())).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('returns nothing for unknown or malformed ids', async () => {
    expect(await repo.findById('33333333-3333-4333-8333-333333333333')).toBeUndefined();
    expect(await repo.findById('not-a-uuid')).toBeUndefined();
    expect(await repo.eventsFor('not-a-uuid')).toEqual([]);
  });

  it('enables row level security on every table', async () => {
    const result = await db.execute<{ relname: string; relrowsecurity: boolean }>(
      sql`select relname, relrowsecurity from pg_class
          where relname in ('leads', 'figure_decisions', 'chases', 'lead_events')`,
    );
    const rows = (result as unknown as { rows: { relname: string; relrowsecurity: boolean }[] })
      .rows;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});

describe('DrizzleLeadRepository: replies, reviews and notices', () => {
  const NOTICE_ID = '44444444-4444-4444-8444-444444444444';
  const review: ReviewDecision =
    approved.outcome === 'approved'
      ? { outcome: 'approved', offer: { ...approved.offer, amount: 250_000 } }
      : { outcome: 'rejected', reason: 'x' };

  async function repliedLead() {
    const lead = newLead();
    lead.startPrequalification(t0);
    lead.recordDecision(needDocs, t0);
    lead.openChase(CHASE_ID, t0);
    lead.markChaseSent(
      {
        subject: 'Docs needed',
        body: 'Hi John',
        emailMessageId: 'email_1',
        replyTo: `reply+${CHASE_ID}@linkerclaw.ai`,
        sentAt: t0,
      },
      t0,
    );
    lead.receiveReply(
      {
        messageId: '<m1@x>',
        receivedAt: new Date('2026-09-23T01:00:00.000Z'),
        from: 'john@example.com',
        dmarc: 'pass',
        attachments: [
          {
            filename: 'paystub.pdf',
            contentType: 'application/pdf',
            size: 99,
            sha256: 'b'.repeat(64),
          },
        ],
      },
      t0,
    );
    await repo.save(lead);
    return lead;
  }

  it('round-trips the reply and finds the Lead by chase id', async () => {
    const lead = await repliedLead();
    const loaded = await repo.findByChaseId(CHASE_ID);
    expect(loaded?.id).toBe(LEAD_ID);
    expect(loaded?.snapshot()).toEqual(lead.snapshot());
    expect(loaded?.status).toBe('documents_received');
    expect(await repo.findByChaseId('55555555-5555-4555-8555-555555555555')).toBeUndefined();
  });

  it('stores the review as a second, separate Figure decision and the notice', async () => {
    const lead = await repliedLead();
    lead.startReview(t0);
    lead.recordReview(review, t0);
    await repo.save(lead, { rawFigureResponse: { status: 'approved', review: true } });
    lead.openNotice(NOTICE_ID, t0);
    lead.markNoticeSent(
      { subject: 'Your HELOC offer is ready', body: 'Hi', emailMessageId: 'email_2', sentAt: t0 },
      t0,
    );
    await repo.save(lead);

    const loaded = await repo.findById(LEAD_ID);
    expect(loaded?.review).toEqual(review);
    expect(loaded?.decision).toEqual(needDocs);
    expect(loaded?.notice).toMatchObject({
      id: NOTICE_ID,
      status: 'sent',
      emailMessageId: 'email_2',
    });
    expect(loaded?.nextStep()).toBe('done');

    const rows = await db.select().from(schema.figureDecisions);
    expect(rows.map((r) => [r.kind, r.status]).sort()).toEqual([
      ['document_review', 'approved'],
      ['soft_pull', 'need_more_documents'],
    ]);
    expect(rows.find((r) => r.kind === 'document_review')?.rawResponse).toEqual({
      status: 'approved',
      review: true,
    });
    expect(rows.find((r) => r.kind === 'soft_pull')?.rawResponse).toBeNull();
    expect(await db.select().from(schema.outcomeNotices)).toHaveLength(1);
  });
});

describe('DrizzleLeadRepository: needingAttention', () => {
  const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-000000000000`;
  const later = new Date('2026-09-23T00:10:00.000Z');
  const stuckBefore = new Date('2026-09-23T00:05:00.000Z');

  async function decidedLead(n: number, at = t0) {
    const lead = newLead(id(n), `borrower${n}@example.com`);
    lead.startPrequalification(at);
    lead.recordDecision(approved, at);
    await repo.save(lead);
    return lead;
  }

  it('finds failed Leads, stuck steps and unsent Outcome Notices, but not healthy Leads', async () => {
    const failed = newLead(id(1), 'borrower1@example.com');
    failed.startPrequalification(t0);
    failed.fail('prequalify', 'figure down', t0);
    await repo.save(failed);

    const stuck = newLead(id(2), 'borrower2@example.com');
    stuck.startPrequalification(t0);
    await repo.save(stuck);

    const noticeStuck = await decidedLead(3);
    noticeStuck.openNotice('33333333-3333-4333-8333-333333333333', t0);
    await repo.save(noticeStuck);

    const noticeInFlight = await decidedLead(4, later);
    noticeInFlight.openNotice('44444444-4444-4444-8444-444444444444', later);
    await repo.save(noticeInFlight);

    const done = await decidedLead(5);
    done.openNotice('55555555-5555-4555-8555-555555555555', t0);
    done.markNoticeSent(
      { subject: 'Your HELOC offer is ready', body: 'Hi', emailMessageId: 'email_5', sentAt: t0 },
      t0,
    );
    await repo.save(done);

    expect((await repo.needingAttention(stuckBefore, 10)).sort()).toEqual([id(1), id(2), id(3)]);
  });
});

describe('DrizzleLeadRepository: one Open Lead per email, idempotency keys (ADR-0007)', () => {
  const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-000000000000`;
  const settle = (lead: Lead) => {
    lead.startPrequalification(t0);
    lead.recordDecision(approved, t0);
    return lead;
  };

  it('refuses a new Lead while the email (any case) has an Open Lead', async () => {
    await repo.save(newLead(id(1), 'john@example.com'));
    await expect(repo.save(newLead(id(2), 'John@Example.COM'))).rejects.toBeInstanceOf(
      OpenLeadExistsError,
    );
    await repo.save(newLead(id(3), 'jane@example.com'));
    expect(await db.select().from(schema.leads)).toHaveLength(2);
  });

  it('allows a new Lead once the earlier ones are settled, and still updates Open ones', async () => {
    const first = newLead(id(1));
    await repo.save(settle(first));
    const second = newLead(id(2));
    await repo.save(second);
    second.startPrequalification(t0);
    await repo.save(second); // updating the Open Lead itself is not a new submission
    expect(await db.select().from(schema.leads)).toHaveLength(2);
  });

  it('lets exactly one of two concurrent submissions for an email through', async () => {
    const results = await Promise.allSettled([
      repo.save(newLead(id(1))),
      repo.save(newLead(id(2))),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.any(OpenLeadExistsError),
    });
  });

  it('stores the idempotency key, finds the Lead by it and refuses it twice', async () => {
    await repo.save(settle(newLead(id(1), 'a@example.com')), { idempotencyKey: 'key-00000001' });
    expect((await repo.findByIdempotencyKey('key-00000001'))?.id).toBe(id(1));
    expect(await repo.findByIdempotencyKey('key-unknown')).toBeUndefined();
    await expect(
      repo.save(newLead(id(2), 'b@example.com'), { idempotencyKey: 'key-00000001' }),
    ).rejects.toBeInstanceOf(DuplicateSubmissionError);
    expect(await db.select().from(schema.leads)).toHaveLength(1);
  });

  it('lists recent Leads for an email, case-insensitively and newest first', async () => {
    const at = (iso: string) => {
      const lead = Lead.submit(
        {
          id: id(Number(iso.slice(12, 13))),
          borrower: { name: 'John Doe', email: 'John@Example.com', phone: '+14155551234' },
          property: { state: 'CA', estimatedValue: 800_000, mortgageBalance: 0 },
          creditProfile: { creditBand: '780+', incomeBand: '150k-200k' },
          purpose: 'home_improvement',
        },
        new Date(iso),
      );
      return settle(lead);
    };
    await repo.save(at('2026-09-22T01:00:00.000Z'));
    await repo.save(at('2026-09-23T02:00:00.000Z'));
    await repo.save(at('2026-09-23T03:00:00.000Z'));
    await repo.save(settle(newLead(id(9), 'someone@else.com')));

    const recent = await repo.recentForEmail('john@example.com', new Date('2026-09-23T00:00:00Z'));
    expect(recent.map((l) => l.id)).toEqual([id(3), id(2)]);
  });
});
