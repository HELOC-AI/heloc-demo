import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '../../domain/lead-repository.ts';
import { Lead } from '../../domain/lead.ts';
import type { PrequalDecision } from '../../domain/model.ts';
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

const newLead = () =>
  Lead.submit(
    {
      id: LEAD_ID,
      borrower: { name: 'John Doe', email: 'john@example.com', phone: '+14155551234' },
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
      rawPrequalResponse: { status: 'approved', offer: { amount: 150000 } },
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
      { subject: 'Docs needed', body: 'Hi John', emailMessageId: 'email_1', sentAt: t0 },
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
      sentAt: t0,
      lastError: undefined,
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
